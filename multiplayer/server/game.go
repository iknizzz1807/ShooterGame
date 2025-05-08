package main

import (
	"log"
	"math"
	"math/rand"
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	PlayerMaxHP         = 10
	PlayerWidth         = 50.0
	PlayerHeight        = 50.0
	PlayerMaxVelocity   = 400.0
	PlayerAcceleration  = 1000.0
	PlayerFriction      = 0.95
	PlayerShootCooldown = 2.0
	BulletRadius        = 5.0
	BulletSpeed         = 1000.0
	CanvasWidth         = 1300.0
	CanvasHeight        = 650.0
	GameTickRate        = time.Second / 60
)

var playerColors = []string{"blue", "red", "yellow", "purple", "orange", "cyan"}

type Player struct {
	ID               string  `json:"id"`
	X                float64 `json:"x"`
	Y                float64 `json:"y"`
	Width            float64 `json:"width"`
	Height           float64 `json:"height"`
	Color            string  `json:"color"`
	CurrentHP        int     `json:"currentHP"`
	MaxHP            int     `json:"maxHP"`
	VelX             float64 `json:"-"`
	VelY             float64 `json:"-"`
	InputX           float64 `json:"-"`
	InputY           float64 `json:"-"`
	ShootingCooldown float64 `json:"shootingCooldown"`
	conn             *ClientConn
}

type Bullet struct {
	ID                string  `json:"id"`
	OwnerID           string  `json:"ownerId"`
	X                 float64 `json:"x"`
	Y                 float64 `json:"y"`
	DirX              float64 `json:"dirX"`
	DirY              float64 `json:"dirY"`
	Radius            float64 `json:"radius"`
	TimesCollidedWall int     `json:"timesCollidedWall"`
	toBeRemoved       bool
}

type GameState struct {
	Players map[string]*Player `json:"players"`
	Bullets map[string]*Bullet `json:"bullets"`
}

type GameManager struct {
	sync.RWMutex
	players         map[string]*Player
	bullets         map[string]*Bullet
	clients         map[*ClientConn]bool
	register        chan *ClientConn
	unregister      chan *ClientConn
	playerInputChan chan PlayerInputAction
	playerShootChan chan PlayerShootAction
}

type PlayerInputAction struct {
	PlayerID string
	Input    Vector2D
}

type PlayerShootAction struct {
	PlayerID  string
	TargetPos Vector2D
}

func NewGameManager() *GameManager {
	return &GameManager{
		players:         make(map[string]*Player),
		bullets:         make(map[string]*Bullet),
		clients:         make(map[*ClientConn]bool),
		register:        make(chan *ClientConn),
		unregister:      make(chan *ClientConn),
		playerInputChan: make(chan PlayerInputAction),
		playerShootChan: make(chan PlayerShootAction),
	}
}

func (gm *GameManager) Run() {
	ticker := time.NewTicker(GameTickRate)
	defer ticker.Stop()

	for {
		select {
		case client := <-gm.register:
			gm.Lock()
			gm.clients[client] = true
			playerID := client.id
			newPlayer := &Player{
				ID:               playerID,
				X:                rand.Float64() * (CanvasWidth - PlayerWidth),
				Y:                rand.Float64() * (CanvasHeight - PlayerHeight),
				Width:            PlayerWidth,
				Height:           PlayerHeight,
				Color:            playerColors[rand.Intn(len(playerColors))],
				CurrentHP:        PlayerMaxHP,
				MaxHP:            PlayerMaxHP,
				ShootingCooldown: 0,
				conn:             client,
			}
			gm.players[playerID] = newPlayer
			client.player = newPlayer
			log.Printf("Player %s registered and added to game.", playerID)
			gm.Unlock()

		case client := <-gm.unregister:
			gm.Lock()
			if _, ok := gm.clients[client]; ok {
				delete(gm.clients, client)
				if client.player != nil {
					log.Printf("Player %s (%s) unregistered and removed from game.", client.player.Color, client.id)
					delete(gm.players, client.player.ID)
				}
				close(client.send)
			}
			gm.Unlock()

		case inputAction := <-gm.playerInputChan:
			gm.Lock()
			if player, ok := gm.players[inputAction.PlayerID]; ok {
				player.InputX = inputAction.Input.X
				player.InputY = inputAction.Input.Y
			}
			gm.Unlock()

		case shootAction := <-gm.playerShootChan:
			gm.Lock()
			if player, ok := gm.players[shootAction.PlayerID]; ok {
				if player.ShootingCooldown <= 0 {
					playerCenterX := player.X + player.Width/2
					playerCenterY := player.Y + player.Height/2

					direction := NewVector2D(shootAction.TargetPos.X-playerCenterX, shootAction.TargetPos.Y-playerCenterY).Normalize()

					bulletID := uuid.NewString()
					newBullet := &Bullet{
						ID:                bulletID,
						OwnerID:           player.ID,
						X:                 playerCenterX,
						Y:                 playerCenterY,
						DirX:              direction.X,
						DirY:              direction.Y,
						Radius:            BulletRadius,
						TimesCollidedWall: 0,
					}
					gm.bullets[bulletID] = newBullet
					player.ShootingCooldown = PlayerShootCooldown
					log.Printf("Player %s shot. Bullet %s created.", player.ID, bulletID)
				}
			}
			gm.Unlock()

		case <-ticker.C:
			deltaTime := GameTickRate.Seconds()
			gm.Lock()
			// Update Players
			for _, player := range gm.players {
				if player.InputX != 0 || player.InputY != 0 {
					accelX := player.InputX * PlayerAcceleration * deltaTime
					accelY := player.InputY * PlayerAcceleration * deltaTime
					player.VelX += accelX
					player.VelY += accelY

					// Limit to max velocity
					currentSpeed := math.Sqrt(player.VelX*player.VelX + player.VelY*player.VelY)
					if currentSpeed > PlayerMaxVelocity {
						player.VelX = (player.VelX / currentSpeed) * PlayerMaxVelocity
						player.VelY = (player.VelY / currentSpeed) * PlayerMaxVelocity
					}
				} else {
					// Apply friction
					player.VelX *= (1.0 - (1.0-PlayerFriction)*deltaTime*60) // Adjust friction application for deltaTime
					player.VelY *= (1.0 - (1.0-PlayerFriction)*deltaTime*60)
					if math.Abs(player.VelX) < 0.1 {
						player.VelX = 0
					}
					if math.Abs(player.VelY) < 0.1 {
						player.VelY = 0
					}
				}

				// Update position
				player.X += player.VelX * deltaTime
				player.Y += player.VelY * deltaTime

				// Boundary check
				if player.X < 0 {
					player.X = 0
					player.VelX = 0
				}
				if player.Y < 0 {
					player.Y = 0
					player.VelY = 0
				}
				if player.X+player.Width > CanvasWidth {
					player.X = CanvasWidth - player.Width
					player.VelX = 0
				}
				if player.Y+player.Height > CanvasHeight {
					player.Y = CanvasHeight - player.Height
					player.VelY = 0
				}

				// Update shooting cooldown
				if player.ShootingCooldown > 0 {
					player.ShootingCooldown -= deltaTime
					if player.ShootingCooldown < 0 {
						player.ShootingCooldown = 0
					}
				}
			}

			// Update Bullets
			activeBullets := make(map[string]*Bullet)
			for id, bullet := range gm.bullets {
				bullet.X += BulletSpeed * bullet.DirX * deltaTime
				bullet.Y += BulletSpeed * bullet.DirY * deltaTime

				// Boundary check and reflection for bullets
				collidedThisFrame := false
				if bullet.X-bullet.Radius < 0 {
					bullet.X = bullet.Radius
					bullet.DirX *= -1
					collidedThisFrame = true
				} else if bullet.X+bullet.Radius > CanvasWidth {
					bullet.X = CanvasWidth - bullet.Radius
					bullet.DirX *= -1
					collidedThisFrame = true
				}
				if bullet.Y-bullet.Radius < 0 {
					bullet.Y = bullet.Radius
					bullet.DirY *= -1
					collidedThisFrame = true
				} else if bullet.Y+bullet.Radius > CanvasHeight {
					bullet.Y = CanvasHeight - bullet.Radius
					bullet.DirY *= -1
					collidedThisFrame = true
				}
				if collidedThisFrame {
					bullet.TimesCollidedWall++
				}

				// Check bullet-player collisions
				for _, player := range gm.players {
					closestX := math.Max(player.X, math.Min(bullet.X, player.X+player.Width))
					closestY := math.Max(player.Y, math.Min(bullet.Y, player.Y+player.Height))

					distanceX := bullet.X - closestX
					distanceY := bullet.Y - closestY
					distanceSquared := (distanceX * distanceX) + (distanceY * distanceY)

					if distanceSquared < (bullet.Radius * bullet.Radius) {
						canDamageBasedOnBounce := bullet.TimesCollidedWall >= 1

						if canDamageBasedOnBounce {
							log.Printf("Bullet %s hit player %s. Wall bounces: %d", bullet.ID, player.ID, bullet.TimesCollidedWall)
							player.CurrentHP -= 2 // Example damage
							if player.CurrentHP <= 0 {
								log.Printf("Player %s (%s) died. Respawning.", player.Color, player.ID)
								player.CurrentHP = player.MaxHP
								player.X = rand.Float64() * (CanvasWidth - PlayerWidth)
								player.Y = rand.Float64() * (CanvasHeight - PlayerHeight)
								player.VelX = 0
								player.VelY = 0
							}
							bullet.toBeRemoved = true
						}
						break
					}
				}

				if bullet.TimesCollidedWall > 5 || bullet.toBeRemoved {
					// log.Printf("Bullet %s removed. Bounces: %d, ToBeRemoved: %v", id, bullet.TimesCollidedWall, bullet.toBeRemoved)
				} else {
					activeBullets[id] = bullet
				}
			}
			gm.bullets = activeBullets

			currentGameState := GameState{
				Players: make(map[string]*Player),
				Bullets: make(map[string]*Bullet),
			}

			for id, p := range gm.players {
				playerCopy := *p
				playerCopy.conn = nil
				currentGameState.Players[id] = &playerCopy
			}
			for id, b := range gm.bullets {
				bulletCopy := *b // Create a copy
				currentGameState.Bullets[id] = &bulletCopy
			}

			gm.Unlock()

			message := Message{Type: "gameState", Payload: currentGameState}
			for client := range gm.clients {
				select {
				case client.send <- message:
				default:
					log.Printf("Client %s send channel full, potential disconnect.", client.id)
				}
			}
		}
	}
}
