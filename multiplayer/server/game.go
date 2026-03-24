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
	GameTickRate        = time.Second / 60   // physics tick: 60fps during in_progress
	IdleTickRate        = time.Second / 5    // heartbeat: 5fps during waiting/game_over
	RoundDuration       = 180.0             // seconds
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
	Players             map[string]*Player `json:"players"`
	Bullets             map[string]*Bullet `json:"bullets"`
	State               string             `json:"state"`
	WinnerID            string             `json:"winnerId"`
	ReadyPlayers        map[string]bool    `json:"readyPlayers"`
	TimeRemaining       float64            `json:"timeRemaining"`
	ShootCooldownMax    float64            `json:"shootCooldownMax"`
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

	State         string `json:"state"`
	WinnerID      string `json:"winnerId"`
	readyPlayers  map[string]bool
	timeRemaining float64 // seconds remaining in current round
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
		register:          make(chan *ClientConn, 4),
		unregister:        make(chan *ClientConn, 4),
		playerInputChan:   make(chan PlayerInputAction, 16),
		playerShootChan:   make(chan PlayerShootAction, 16),
		playerReadyChan:   make(chan string, 4),
		playerRestartChan: make(chan string, 4),
		State:             StateWaitingForPlayers,
		readyPlayers:      make(map[string]bool),
	}
}

// getCreatorName returns a short player ID for display.
// Caller must hold at least a read lock on gr.
func (gr *GameRoom) getCreatorName() string {
	for _, p := range gr.players {
		return p.ID[:6]
	}
	return "Empty"
}

func (gr *GameRoom) Run() {
	// gameTicker drives physics at 60fps — only active during in_progress
	gameTicker := time.NewTicker(GameTickRate)
	defer gameTicker.Stop()

	// idleTicker sends periodic state updates at 5fps when waiting/game_over,
	// so clients stay in sync without burning CPU on 60 goroutine wakeups/s.
	idleTicker := time.NewTicker(IdleTickRate)
	defer idleTicker.Stop()

	for {
		select {
		case client := <-gr.register:
			gr.Lock()
			gr.clients[client] = true
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
			client.roomMu.Lock()
			client.room = gr
			client.player = newPlayer
			client.roomMu.Unlock()
			log.Printf("Player %s registered and added to game room %s.", playerID, gr.ID)
			gr.Unlock()
			// Immediately push current state to the new client
			gr.broadcastGameState()

		case client := <-gr.unregister:
			gr.Lock()

			log.Printf("Processing unregister for client %s in room %s", client.id, gr.ID)

			if _, ok := gr.clients[client]; !ok {
				log.Printf("Client %s was not in room %s, skipping unregister", client.id, gr.ID)
				gr.Unlock()
				continue
			}

			wasInProgress := gr.State == StateInProgress || gr.State == StateGameOver

			delete(gr.clients, client)
			if client.player != nil {
				log.Printf("Player %s (%s) unregistered from room %s", client.player.Color, client.id, gr.ID)
				delete(gr.players, client.player.ID)
				delete(gr.readyPlayers, client.player.ID)
			}

			client.roomMu.Lock()
			client.room = nil
			client.player = nil
			client.roomMu.Unlock()

			if wasInProgress && len(gr.players) < 2 {
				log.Printf("Player left mid-game. Resetting room %s to waiting state.", gr.ID)
				gr.resetGame()
			}

			if len(gr.clients) == 0 {
				log.Printf("Room %s is now empty. Signalling hub for removal.", gr.ID)
				gr.Unlock()
				go func() {
					gr.hub.unregisterRoom <- gr
				}()
				return
			}

			gr.Unlock()
			gr.broadcastGameState()

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
			// Push ready/game-start state immediately — no need to wait for idle tick
			gr.broadcastGameState()

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
			gr.broadcastGameState()

		case inputAction := <-gr.playerInputChan:
			gr.Lock()
			if gr.State == StateInProgress {
				if player, ok := gr.players[inputAction.PlayerID]; ok {
					player.InputX = inputAction.Input.X
					player.InputY = inputAction.Input.Y
				}
			}
			gr.Unlock()

		case shootAction := <-gr.playerShootChan:
			gr.Lock()
			if gr.State == StateInProgress {
				if player, ok := gr.players[shootAction.PlayerID]; ok {
					if player.ShootingCooldown <= 0 {
						playerCenterX := player.X + player.Width/2
						playerCenterY := player.Y + player.Height/2

						rawDir := NewVector2D(shootAction.TargetPos.X-playerCenterX, shootAction.TargetPos.Y-playerCenterY)
						if rawDir.Magnitude() >= 0.001 {
							direction := rawDir.Normalize()
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
				}
			}
			gr.Unlock()

		case <-idleTicker.C:
			// Low-frequency heartbeat for waiting/game_over — skip during in_progress
			// (gameTicker handles that path instead)
			gr.RLock()
			notInProgress := gr.State != StateInProgress
			gr.RUnlock()
			if notInProgress {
				gr.broadcastGameState()
			}

		case <-gameTicker.C:
			// Physics tick — skip entirely when not in_progress
			gr.RLock()
			notInProgress := gr.State != StateInProgress
			gr.RUnlock()
			if notInProgress {
				continue
			}

			deltaTime := GameTickRate.Seconds()
			gr.Lock()

			// Update round timer
			gr.timeRemaining -= deltaTime
			if gr.timeRemaining <= 0 {
				gr.timeRemaining = 0
				// Determine winner by HP
				var highestHP int = -1
				var winnerId string
				var tie bool
				for _, p := range gr.players {
					if p.CurrentHP > highestHP {
						highestHP = p.CurrentHP
						winnerId = p.ID
						tie = false
					} else if p.CurrentHP == highestHP {
						tie = true
					}
				}
				if !tie {
					gr.WinnerID = winnerId
				} else {
					gr.WinnerID = "" // draw
				}
				gr.State = StateGameOver
				log.Printf("Round time expired in room %s. WinnerID: %s (tie=%v)", gr.ID, gr.WinnerID, tie)
				gr.Unlock()
				gr.broadcastGameState()
				continue
			}

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
	// Hold lock only long enough to copy state — never while sending
	gr.RLock()
	currentGameState := GameState{
		Players:          make(map[string]*Player, len(gr.players)),
		Bullets:          make(map[string]*Bullet),
		State:            gr.State,
		WinnerID:         gr.WinnerID,
		ReadyPlayers:     make(map[string]bool, len(gr.readyPlayers)),
		TimeRemaining:    gr.timeRemaining,
		ShootCooldownMax: PlayerShootCooldown,
	}
	for id, ready := range gr.readyPlayers {
		currentGameState.ReadyPlayers[id] = ready
	}
	for id, p := range gr.players {
		playerCopy := *p
		playerCopy.conn = nil
		currentGameState.Players[id] = &playerCopy
	}
	if gr.State == StateInProgress {
		currentGameState.Bullets = make(map[string]*Bullet, len(gr.bullets))
		for id, b := range gr.bullets {
			bulletCopy := *b
			currentGameState.Bullets[id] = &bulletCopy
		}
	}
	clients := make([]*ClientConn, 0, len(gr.clients))
	for client := range gr.clients {
		clients = append(clients, client)
	}
	gr.RUnlock() // unlock before any sending

	message := Message{Type: "gameState", Payload: currentGameState}

	for _, client := range clients {
		select {
		case client.send <- message:
		default:
			// Client send buffer full — drop this frame for that client
		}
	}
}

func (gr *GameRoom) startGame() {
	gr.State = StateInProgress
	gr.WinnerID = ""
	gr.timeRemaining = RoundDuration
	gr.bullets = make(map[string]*Bullet)

	// Fixed spawn points: left side and right side, vertically centered
	spawnPoints := []Vector2D{
		{X: CanvasWidth * 0.15, Y: (CanvasHeight - PlayerHeight) / 2},
		{X: CanvasWidth * 0.80, Y: (CanvasHeight - PlayerHeight) / 2},
	}
	i := 0
	for _, p := range gr.players {
		p.CurrentHP = PlayerMaxHP
		p.X = spawnPoints[i%2].X
		p.Y = spawnPoints[i%2].Y
		p.VelX = 0
		p.VelY = 0
		p.ShootingCooldown = 0
		i++
	}
}

func (gr *GameRoom) resetGame() {
	gr.State = StateWaitingForPlayers
	gr.WinnerID = ""
	gr.readyPlayers = make(map[string]bool)
	gr.bullets = make(map[string]*Bullet)
	gr.timeRemaining = 0
	spawnPoints := []Vector2D{
		{X: CanvasWidth * 0.15, Y: (CanvasHeight - PlayerHeight) / 2},
		{X: CanvasWidth * 0.80, Y: (CanvasHeight - PlayerHeight) / 2},
	}
	i := 0
	for _, p := range gr.players {
		p.CurrentHP = PlayerMaxHP
		p.X = spawnPoints[i%2].X
		p.Y = spawnPoints[i%2].Y
		i++
	}
}
