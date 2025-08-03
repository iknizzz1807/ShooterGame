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

// Game Room constants
const (
	StateWaitingForPlayers = "waiting"
	StateInProgress        = "in_progress"
	StateGameOver          = "game_over"
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
	Players      map[string]*Player `json:"players"`
	Bullets      map[string]*Bullet `json:"bullets"`
	State        string             `json:"state"`
	WinnerID     string             `json:"winnerId"`
	ReadyPlayers map[string]bool    `json:"readyPlayers"`
}

type GameRoom struct {
	ID  string
	hub *Hub

	sync.RWMutex
	players           map[string]*Player
	bullets           map[string]*Bullet
	clients           map[*ClientConn]bool
	register          chan *ClientConn
	unregister        chan *ClientConn
	playerInputChan   chan PlayerInputAction
	playerShootChan   chan PlayerShootAction
	playerReadyChan   chan string
	playerRestartChan chan string

	State        string `json:"state"`
	WinnerID     string `json:"winnerId"`
	readyPlayers map[string]bool
}

type PlayerInputAction struct {
	PlayerID string
	Input    Vector2D
}

type PlayerShootAction struct {
	PlayerID  string
	TargetPos Vector2D
}

type PlayerReadyAction struct {
	PlayerID string
}

type PlayerRestartAction struct {
	PlayerID string
}

func NewGameRoom(id string, hub *Hub) *GameRoom {
	return &GameRoom{
		ID:                id,
		hub:               hub,
		players:           make(map[string]*Player),
		bullets:           make(map[string]*Bullet),
		clients:           make(map[*ClientConn]bool),
		register:          make(chan *ClientConn),
		unregister:        make(chan *ClientConn),
		playerInputChan:   make(chan PlayerInputAction),
		playerShootChan:   make(chan PlayerShootAction),
		playerReadyChan:   make(chan string),
		playerRestartChan: make(chan string),
		State:             StateWaitingForPlayers,
		readyPlayers:      make(map[string]bool),
	}
}

func (gr *GameRoom) getCreatorName() string {
	gr.RLock()
	defer gr.RUnlock()
	for _, p := range gr.players {
		return p.ID[:6]
	}
	return "Empty"
}

func (gr *GameRoom) Run() {
	ticker := time.NewTicker(GameTickRate)
	defer ticker.Stop()

	for {
		select {
		case client := <-gr.register:
			gr.Lock()
			gr.clients[client] = true
			client.room = gr
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
			gr.players[playerID] = newPlayer
			client.player = newPlayer
			log.Printf("Player %s registered and added to game room %s.", playerID, gr.ID)

			// --- MODIFIED: REMOVED a block of code that automatically started the game. ---
			// The game now ONLY starts when both players are ready.

			gr.Unlock()

		case client := <-gr.unregister:
			gr.Lock()

			// Log the unregister event
			log.Printf("Processing unregister for client %s in room %s", client.id, gr.ID)

			// Check if client was actually in this room
			if _, ok := gr.clients[client]; !ok {
				log.Printf("Client %s was not in room %s, skipping unregister", client.id, gr.ID)
				gr.Unlock()
				continue
			}

			// Store game state before removal
			wasInProgress := gr.State == StateInProgress || gr.State == StateGameOver

			// Remove client from room
			delete(gr.clients, client)
			if client.player != nil {
				log.Printf("Player %s (%s) unregistered from room %s", client.player.Color, client.id, gr.ID)
				delete(gr.players, client.player.ID)
				delete(gr.readyPlayers, client.player.ID)
			}

			// Clear client's room reference
			client.room = nil
			client.player = nil

			// Reset game if player left mid-game
			if wasInProgress && len(gr.players) < 2 {
				log.Printf("Player left mid-game. Resetting room %s to waiting state.", gr.ID)
				gr.resetGame()
			}

			// Check if room is now empty
			if len(gr.clients) == 0 {
				log.Printf("Room %s is now empty. Signalling hub for removal.", gr.ID)
				gr.Unlock()

				// Signal hub for removal in separate goroutine to avoid blocking
				go func() {
					gr.hub.unregisterRoom <- gr
				}()
				return // Stop this room's goroutine
			}

			gr.Unlock()

			// Broadcast updated game state to remaining players (non-blocking)
			go gr.broadcastGameState()

		case playerID := <-gr.playerReadyChan:
			gr.Lock()
			if gr.State == StateWaitingForPlayers || gr.State == StateGameOver {
				if _, ok := gr.players[playerID]; ok {
					gr.readyPlayers[playerID] = true
					log.Printf("Player %s is ready.", playerID)

					if len(gr.players) >= 2 && len(gr.readyPlayers) == len(gr.players) {
						log.Println("Both players are ready. Starting game!")
						gr.startGame()
					}
				}
			}
			gr.Unlock()

		case playerID := <-gr.playerRestartChan:
			gr.Lock()
			if gr.State == StateGameOver {
				gr.readyPlayers[playerID] = true
				log.Printf("Player %s wants to restart.", playerID)

				if len(gr.readyPlayers) == len(gr.players) && len(gr.players) > 0 {
					log.Println("All players agreed to restart. Resetting game.")
					gr.resetGame()
				}
			}
			gr.Unlock()

		case inputAction := <-gr.playerInputChan:
			if gr.State == StateInProgress {
				gr.Lock()
				if player, ok := gr.players[inputAction.PlayerID]; ok {
					player.InputX = inputAction.Input.X
					player.InputY = inputAction.Input.Y
				}
				gr.Unlock()
			}

		case shootAction := <-gr.playerShootChan:
			if gr.State == StateInProgress {
				gr.Lock()
				if player, ok := gr.players[shootAction.PlayerID]; ok {
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
						gr.bullets[bulletID] = newBullet
						player.ShootingCooldown = PlayerShootCooldown
						log.Printf("Player %s shot. Bullet %s created.", player.ID, bulletID)
					}
				}
				gr.Unlock()
			}

		case <-ticker.C:
			if gr.State != StateInProgress {
				gr.broadcastGameState()
				continue
			}

			deltaTime := GameTickRate.Seconds()
			gr.Lock()
			// Update Players
			for _, player := range gr.players {
				if player.InputX != 0 || player.InputY != 0 {
					accelX := player.InputX * PlayerAcceleration * deltaTime
					accelY := player.InputY * PlayerAcceleration * deltaTime
					player.VelX += accelX
					player.VelY += accelY

					currentSpeed := math.Sqrt(player.VelX*player.VelX + player.VelY*player.VelY)
					if currentSpeed > PlayerMaxVelocity {
						player.VelX = (player.VelX / currentSpeed) * PlayerMaxVelocity
						player.VelY = (player.VelY / currentSpeed) * PlayerMaxVelocity
					}
				} else {
					player.VelX *= (1.0 - (1.0-PlayerFriction)*deltaTime*60)
					player.VelY *= (1.0 - (1.0-PlayerFriction)*deltaTime*60)
					if math.Abs(player.VelX) < 0.1 {
						player.VelX = 0
					}
					if math.Abs(player.VelY) < 0.1 {
						player.VelY = 0
					}
				}

				player.X += player.VelX * deltaTime
				player.Y += player.VelY * deltaTime

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

				if player.ShootingCooldown > 0 {
					player.ShootingCooldown -= deltaTime
					if player.ShootingCooldown < 0 {
						player.ShootingCooldown = 0
					}
				}
			}

			// Update Bullets
			activeBullets := make(map[string]*Bullet)
			for id, bullet := range gr.bullets {
				bullet.X += BulletSpeed * bullet.DirX * deltaTime
				bullet.Y += BulletSpeed * bullet.DirY * deltaTime

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

				for _, player := range gr.players {
					closestX := math.Max(player.X, math.Min(bullet.X, player.X+player.Width))
					closestY := math.Max(player.Y, math.Min(bullet.Y, player.Y+player.Height))

					distanceX := bullet.X - closestX
					distanceY := bullet.Y - closestY
					distanceSquared := (distanceX * distanceX) + (distanceY * distanceY)

					if distanceSquared < (bullet.Radius * bullet.Radius) {
						canDamageBasedOnBounce := bullet.TimesCollidedWall >= 1

						if canDamageBasedOnBounce {
							log.Printf("Bullet %s hit player %s. Wall bounces: %d", bullet.ID, player.ID, bullet.TimesCollidedWall)
							player.CurrentHP -= 2
							if player.CurrentHP <= 0 {
								log.Printf("Player %s died. Game Over.", player.ID)
								gr.State = StateGameOver
								for _, p := range gr.players {
									if p.ID != player.ID {
										gr.WinnerID = p.ID
										log.Printf("Player %s is the winner!", p.ID)
										break
									}
								}
							}
							bullet.toBeRemoved = true
						}
						break
					}
				}

				if bullet.TimesCollidedWall > 5 || bullet.toBeRemoved {
				} else {
					activeBullets[id] = bullet
				}
			}
			gr.bullets = activeBullets

			gr.Unlock()
			gr.broadcastGameState()
		}
	}
}

func (gr *GameRoom) broadcastGameState() {
	gr.RLock()
	defer gr.RUnlock()

	currentGameState := GameState{
		Players:      make(map[string]*Player),
		Bullets:      make(map[string]*Bullet),
		State:        gr.State,
		WinnerID:     gr.WinnerID,
		ReadyPlayers: make(map[string]bool),
	}

	// Deep copy ready players to avoid race conditions
	for id, ready := range gr.readyPlayers {
		currentGameState.ReadyPlayers[id] = ready
	}

	for id, p := range gr.players {
		playerCopy := *p
		playerCopy.conn = nil
		currentGameState.Players[id] = &playerCopy
	}
	if gr.State == StateInProgress {
		for id, b := range gr.bullets {
			bulletCopy := *b
			currentGameState.Bullets[id] = &bulletCopy
		}
	}

	message := Message{Type: "gameState", Payload: currentGameState}

	// Create slice of clients to avoid holding lock while sending
	clients := make([]*ClientConn, 0, len(gr.clients))
	for client := range gr.clients {
		clients = append(clients, client)
	}

	// Send to clients without holding the room lock
	successCount := 0
	for _, client := range clients {
		select {
		case client.send <- message:
			successCount++
		case <-time.After(50 * time.Millisecond):
			// Client is slow, skip it to prevent blocking
			log.Printf("Skipping slow client %s in room %s during game state broadcast", client.id, gr.ID)
		}
	}

	if successCount < len(clients) {
		log.Printf("Game state broadcast: %d/%d clients reached in room %s", successCount, len(clients), gr.ID)
	}
}

func (gr *GameRoom) startGame() {
	gr.State = StateInProgress
	gr.WinnerID = ""
	gr.bullets = make(map[string]*Bullet)
	for _, p := range gr.players {
		p.CurrentHP = PlayerMaxHP
		p.X = rand.Float64() * (CanvasWidth - PlayerWidth)
		p.Y = rand.Float64() * (CanvasHeight - PlayerHeight)
		p.VelX = 0
		p.VelY = 0
		p.ShootingCooldown = 0
	}
}

func (gr *GameRoom) resetGame() {
	gr.State = StateWaitingForPlayers
	gr.WinnerID = ""
	gr.readyPlayers = make(map[string]bool)
	gr.bullets = make(map[string]*Bullet)
	for _, p := range gr.players {
		p.CurrentHP = PlayerMaxHP
		p.X = rand.Float64() * (CanvasWidth - PlayerWidth)
		p.Y = rand.Float64() * (CanvasHeight - PlayerHeight)
	}
}
