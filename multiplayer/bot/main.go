package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// --- Config ---
var (
	serverAddr = flag.String("addr", "localhost:8080", "server address")
	numRooms   = flag.Int("rooms", 10, "number of rooms to simulate")
	duration   = flag.Duration("duration", 30*time.Second, "test duration")
	verbose    = flag.Bool("v", false, "verbose logging per bot")
)

// --- Message types (mirrors server) ---
type Message struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

type RoomInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	PlayerCount int    `json:"playerCount"`
	MaxPlayers  int    `json:"maxPlayers"`
}

// --- Metrics ---
type Metrics struct {
	connected      atomic.Int64
	disconnected   atomic.Int64
	msgSent        atomic.Int64
	msgReceived    atomic.Int64
	msgDropped     atomic.Int64
	errors         atomic.Int64
	gamesStarted   atomic.Int64
	gamesCompleted atomic.Int64
	latencySum     atomic.Int64 // microseconds
	latencyCount   atomic.Int64
	latencyMax     atomic.Int64
}

var m = &Metrics{}

// --- Bot ---
type BotState string

const (
	StateConnecting BotState = "connecting"
	StateLobby      BotState = "lobby"
	StateInRoom     BotState = "in_room"
	StatePlaying    BotState = "playing"
)

type Bot struct {
	id       int
	role     string // "creator" or "joiner"
	conn     *websocket.Conn
	state    BotState
	playerID string

	sendCh      chan Message
	recvCh      chan Message
	doneCh      chan struct{}
	readySent   bool
	restartSent bool

	lastShotTime time.Time
	lastPingSent time.Time
}

func newBot(id int, role string) *Bot {
	return &Bot{
		id:     id,
		role:   role,
		state:  StateConnecting,
		sendCh: make(chan Message, 128),
		recvCh: make(chan Message, 256),
		doneCh: make(chan struct{}),
	}
}

func (b *Bot) logf(format string, args ...interface{}) {
	if *verbose {
		log.Printf("[Bot %d/%s] "+format, append([]interface{}{b.id, b.role}, args...)...)
	}
}

func (b *Bot) connect() error {
	url := fmt.Sprintf("ws://%s/ws", *serverAddr)
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		return err
	}
	b.conn = conn
	m.connected.Add(1)
	b.logf("Connected")
	return nil
}

func (b *Bot) send(msgType string, payload interface{}) {
	msg := Message{Type: msgType, Payload: payload}
	select {
	case b.sendCh <- msg:
		m.msgSent.Add(1)
	default:
		m.msgDropped.Add(1)
		b.logf("WARN: send buffer full, dropped %s", msgType)
	}
}

func (b *Bot) writePump() {
	defer b.conn.Close()
	for {
		select {
		case msg := <-b.sendCh:
			data, err := json.Marshal(msg)
			if err != nil {
				m.errors.Add(1)
				continue
			}
			b.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := b.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				b.logf("Write error: %v", err)
				return
			}
		case <-b.doneCh:
			return
		}
	}
}

func (b *Bot) readPump() {
	defer func() {
		close(b.recvCh)
	}()
	b.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	for {
		_, data, err := b.conn.ReadMessage()
		if err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				b.logf("Read error: %v", err)
				m.errors.Add(1)
			}
			return
		}
		b.conn.SetReadDeadline(time.Now().Add(60 * time.Second))

		var msg Message
		if err := json.Unmarshal(data, &msg); err != nil {
			m.errors.Add(1)
			continue
		}
		m.msgReceived.Add(1)

		select {
		case b.recvCh <- msg:
		default:
			m.msgDropped.Add(1)
		}
	}
}

// run executes the full bot lifecycle
func (b *Bot) run(wg *sync.WaitGroup, stopCh <-chan struct{}) {
	defer wg.Done()
	defer func() {
		close(b.doneCh)
		if b.conn != nil {
			b.conn.Close()
			m.disconnected.Add(1)
		}
	}()

	if err := b.connect(); err != nil {
		b.logf("Connect failed: %v", err)
		m.errors.Add(1)
		return
	}

	go b.writePump()
	go b.readPump()

	// Timeout per bot
	timeout := time.NewTimer(*duration + 5*time.Second)
	defer timeout.Stop()

	// Input ticker: send movement every 100ms (10fps is enough for a stress-test bot)
	inputTicker := time.NewTicker(100 * time.Millisecond)
	defer inputTicker.Stop()

	for {
		select {
		case <-stopCh:
			b.logf("Stop signal received")
			return

		case <-timeout.C:
			b.logf("Timed out")
			return

		case msg, ok := <-b.recvCh:
			if !ok {
				b.logf("Connection closed")
				return
			}
			if err := b.handleMessage(msg); err != nil {
				b.logf("Handle error: %v", err)
				return
			}

		case <-inputTicker.C:
			if b.state == StatePlaying {
				b.sendInput()
				b.maybeSendShoot()
			}
		}
	}
}

func (b *Bot) handleMessage(msg Message) error {
	switch msg.Type {
	case "welcome":
		payload, ok := msg.Payload.(map[string]interface{})
		if !ok {
			return nil
		}
		b.playerID, _ = payload["playerId"].(string)
		b.logf("Got playerID: %s", b.playerID[:8])
		b.state = StateLobby

	case "room_list":
		if b.state != StateLobby {
			return nil
		}
		// Parse rooms
		data, _ := json.Marshal(msg.Payload)
		var rooms []RoomInfo
		json.Unmarshal(data, &rooms)
		b.logf("Room list: %d rooms", len(rooms))

		if b.role == "creator" {
			b.actOnLobby()
		} else {
			// Joiner: find a room with exactly 1 player
			joined := false
			for _, r := range rooms {
				if r.PlayerCount == 1 {
					b.logf("Joining room with 1 player: %s", r.ID[:8])
					b.send("join_room", map[string]interface{}{"roomId": r.ID})
					b.state = StateInRoom
					joined = true
					break
				}
			}
			if !joined {
				b.logf("No suitable room yet, waiting for next room_list...")
			}
		}

	case "gameState":
		payload, ok := msg.Payload.(map[string]interface{})
		if !ok {
			return nil
		}

		state, _ := payload["state"].(string)
		switch state {
		case "waiting":
			if b.state == StateInRoom && !b.readySent {
				b.readySent = true
				b.send("ready", map[string]interface{}{})
				b.logf("Sent ready")
			}

		case "in_progress":
			if b.state != StatePlaying {
				b.state = StatePlaying
				b.readySent = false
				b.restartSent = false
				m.gamesStarted.Add(1)
				b.logf("Game started!")
			}
			// Measure latency
			now := time.Now().UnixMicro()
			if !b.lastPingSent.IsZero() {
				latency := now - b.lastPingSent.UnixMicro()
				m.latencySum.Add(latency)
				m.latencyCount.Add(1)
				for {
					old := m.latencyMax.Load()
					if latency <= old || m.latencyMax.CompareAndSwap(old, latency) {
						break
					}
				}
			}
			b.lastPingSent = time.Now()

		case "game_over":
			if b.state == StatePlaying && !b.restartSent {
				b.restartSent = true
				m.gamesCompleted.Add(1)
				b.logf("Game over!")
				b.state = StateInRoom
				b.readySent = false
				b.send("restart", map[string]interface{}{})
				b.logf("Sent restart")
			}
		}

	case "error":
		payload, _ := msg.Payload.(string)
		b.logf("Server error: %s", payload)
		// If room was full or not found, go back to lobby state to retry
		if b.role == "joiner" && b.state == StateInRoom {
			b.state = StateLobby
		}
		m.errors.Add(1)
	}
	return nil
}

func (b *Bot) actOnLobby() {
	if b.state != StateLobby {
		return
	}
	b.logf("Creating room")
	b.send("create_room", map[string]interface{}{})
	b.state = StateInRoom
}

func (b *Bot) sendInput() {
	// Random movement
	inputs := [][]float64{{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {-1, -1}, {0, 0}}
	inp := inputs[rand.Intn(len(inputs))]
	b.send("input", map[string]interface{}{"x": inp[0], "y": inp[1]})
}

func (b *Bot) maybeSendShoot() {
	if time.Since(b.lastShotTime) < 2100*time.Millisecond {
		return
	}
	// Shoot at random position
	b.send("shoot", map[string]interface{}{
		"x": rand.Float64() * 1300,
		"y": rand.Float64() * 650,
	})
	b.lastShotTime = time.Now()
}

// --- Main ---
func main() {
	flag.Parse()

	fmt.Printf("╔════════════════════════════════════════╗\n")
	fmt.Printf("║     SHOOTER GAME - STRESS TEST BOT     ║\n")
	fmt.Printf("╚════════════════════════════════════════╝\n")
	fmt.Printf("Server  : %s\n", *serverAddr)
	fmt.Printf("Rooms   : %d (= %d players)\n", *numRooms, *numRooms*2)
	fmt.Printf("Duration: %s\n\n", *duration)

	stopCh := make(chan struct{})
	var wg sync.WaitGroup

	// Spawn bots in pairs (1 creator + 1 joiner per room)
	// Creators connect first, then joiners — so rooms exist when joiners look
	creators := make([]*Bot, *numRooms)
	for i := 0; i < *numRooms; i++ {
		creators[i] = newBot(i*2, "creator")
		wg.Add(1)
		go creators[i].run(&wg, stopCh)
		time.Sleep(20 * time.Millisecond)
	}

	// Wait a short time so first creators have rooms ready before joiners flood in.
	// Joiners will keep retrying on each room_list update anyway.
	time.Sleep(300 * time.Millisecond)

	for i := 0; i < *numRooms; i++ {
		joiner := newBot(i*2+1, "joiner")
		wg.Add(1)
		go joiner.run(&wg, stopCh)
		time.Sleep(20 * time.Millisecond)
	}

	// Print metrics periodically
	metricsTicker := time.NewTicker(5 * time.Second)
	testTimer := time.NewTimer(*duration)

	fmt.Printf("%-8s %-10s %-10s %-10s %-12s %-12s %-10s %-10s %-8s\n",
		"Time", "Connected", "Sent", "Received", "Dropped", "Errors", "Games▶", "Games✓", "Latency")
	fmt.Println("─────────────────────────────────────────────────────────────────────────────────────────")

	start := time.Now()
	for {
		select {
		case <-metricsTicker.C:
			printMetrics(start)

		case <-testTimer.C:
			fmt.Println("\n⏱  Test duration reached. Stopping bots...")
			close(stopCh)
			wg.Wait()
			fmt.Println("\n══════════════════════ FINAL RESULTS ══════════════════════")
			printMetrics(start)
			printSummary()
			return
		}
	}
}

func printMetrics(start time.Time) {
	elapsed := time.Since(start).Round(time.Second)

	var avgLatency int64
	count := m.latencyCount.Load()
	if count > 0 {
		avgLatency = m.latencySum.Load() / count / 1000 // convert to ms
	}
	maxLatency := m.latencyMax.Load() / 1000

	goroutines := runtime.NumGoroutine()

	fmt.Printf("%-8s %-10d %-10d %-10d %-12d %-12d %-10d %-10d %dms/max%dms [goroutines:%d]\n",
		elapsed,
		m.connected.Load(),
		m.msgSent.Load(),
		m.msgReceived.Load(),
		m.msgDropped.Load(),
		m.errors.Load(),
		m.gamesStarted.Load(),
		m.gamesCompleted.Load(),
		avgLatency,
		maxLatency,
		goroutines,
	)
}

func printSummary() {
	count := m.latencyCount.Load()
	var avgLatency int64
	if count > 0 {
		avgLatency = m.latencySum.Load() / count / 1000
	}

	totalPlayers := *numRooms * 2
	dropRate := float64(0)
	if sent := m.msgSent.Load(); sent > 0 {
		dropRate = float64(m.msgDropped.Load()) / float64(sent) * 100
	}

	fmt.Printf("\n")
	fmt.Printf("  Players simulated : %d (%d rooms)\n", totalPlayers, *numRooms)
	fmt.Printf("  Connected         : %d\n", m.connected.Load())
	fmt.Printf("  Disconnected      : %d\n", m.disconnected.Load())
	fmt.Printf("  Messages sent     : %d\n", m.msgSent.Load())
	fmt.Printf("  Messages received : %d\n", m.msgReceived.Load())
	fmt.Printf("  Dropped (full buf): %d (%.2f%%)\n", m.msgDropped.Load(), dropRate)
	fmt.Printf("  Errors            : %d\n", m.errors.Load())
	fmt.Printf("  Games started     : %d\n", m.gamesStarted.Load())
	fmt.Printf("  Games completed   : %d\n", m.gamesCompleted.Load())
	fmt.Printf("  Avg state latency : %dms\n", avgLatency)
	fmt.Printf("  Max state latency : %dms\n", m.latencyMax.Load()/1000)
	fmt.Printf("\n")

	// Verdict
	// Note: disconnect errors on stop are expected (1 per bot), subtract them
	realErrors := m.errors.Load() - int64(*numRooms*2)
	if realErrors < 0 {
		realErrors = 0
	}
	if realErrors == 0 && m.msgDropped.Load() == 0 {
		fmt.Println("  ✅ PASS — No real errors, no drops")
	} else if realErrors < int64(*numRooms) && dropRate < 1.0 {
		fmt.Printf("  ⚠️  WARN — %d unexpected errors\n", realErrors)
	} else {
		fmt.Printf("  ❌ FAIL — %d errors, %.2f%% drop rate\n", realErrors, dropRate)
	}
	fmt.Println("═══════════════════════════════════════════════════════════")
}
