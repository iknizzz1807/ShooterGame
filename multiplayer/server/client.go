package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true },
	// Add write timeout to prevent hanging connections
	HandshakeTimeout: 45 * time.Second,
}

// ClientConn represents a connected client
type ClientConn struct {
	id     string
	hub    *Hub
	conn   *websocket.Conn
	send   chan Message
	player *Player
	room   *GameRoom
	// Add close channel to coordinate goroutine shutdown
	done chan struct{}
}

// Message defines the structure for WebSocket communication
type Message struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

func newClientConn(conn *websocket.Conn, hub *Hub) *ClientConn {
	return &ClientConn{
		id:   uuid.NewString(),
		hub:  hub,
		conn: conn,
		send: make(chan Message, 256), // Keep buffer size reasonable
		room: nil,
		done: make(chan struct{}),
	}
}

func (c *ClientConn) readPump() {
	defer func() {
		log.Printf("Client %s readPump is closing", c.id)

		// Signal writePump to stop
		close(c.done)

		// Cleanup based on current state
		if c.room != nil {
			// If client is in a room, notify the room about disconnection
			c.room.unregister <- c
		} else {
			// If client is in lobby, notify the hub
			c.hub.unregister <- c
		}
		c.conn.Close()
	}()

	// Set read deadline and pong handler for connection health
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, messageBytes, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("Unexpected close error for client %s: %v", c.id, err)
			} else {
				log.Printf("Client %s disconnected normally", c.id)
			}
			break
		}

		var msg Message
		if err := json.Unmarshal(messageBytes, &msg); err != nil {
			log.Printf("Error unmarshalling message from client %s: %v", c.id, err)
			continue
		}

		// Process message based on client's current context
		if c.room != nil {
			// Client is in a room, route game actions to the room
			c.handleRoomMessage(msg)
		} else {
			// Client is in lobby, handle lobby actions
			c.handleLobbyMessage(msg)
		}
	}
}

func (c *ClientConn) handleRoomMessage(msg Message) {
	switch msg.Type {
	case "input":
		payloadMap, ok := msg.Payload.(map[string]interface{})
		if !ok {
			log.Printf("Invalid input payload format for player %s", c.id)
			return
		}
		inputX, xOk := payloadMap["x"].(float64)
		inputY, yOk := payloadMap["y"].(float64)
		if !xOk || !yOk {
			log.Printf("Invalid input coordinate types for player %s", c.id)
			return
		}
		select {
		case c.room.playerInputChan <- PlayerInputAction{
			PlayerID: c.id,
			Input:    NewVector2D(inputX, inputY),
		}:
		default:
			log.Printf("Player input channel full for room %s", c.room.ID)
		}

	case "shoot":
		payloadMap, ok := msg.Payload.(map[string]interface{})
		if !ok {
			log.Printf("Invalid shoot payload format for player %s", c.id)
			return
		}
		targetX, xOk := payloadMap["x"].(float64)
		targetY, yOk := payloadMap["y"].(float64)
		if !xOk || !yOk {
			log.Printf("Invalid shoot coordinate types for player %s", c.id)
			return
		}
		select {
		case c.room.playerShootChan <- PlayerShootAction{
			PlayerID:  c.id,
			TargetPos: NewVector2D(targetX, targetY),
		}:
		default:
			log.Printf("Player shoot channel full for room %s", c.room.ID)
		}

	case "ready":
		select {
		case c.room.playerReadyChan <- c.id:
		default:
			log.Printf("Player ready channel full for room %s", c.room.ID)
		}

	case "restart":
		select {
		case c.room.playerRestartChan <- c.id:
		default:
			log.Printf("Player restart channel full for room %s", c.room.ID)
		}

	case "leave_room":
		log.Printf("Client %s requested to leave room %s", c.id, c.room.ID)
		// Use hub's leaveRoom method for proper cleanup
		c.hub.leaveRoom(c)

	default:
		log.Printf("Unknown room message type from player %s: %s", c.id, msg.Type)
	}
}

func (c *ClientConn) handleLobbyMessage(msg Message) {
	switch msg.Type {
	case "create_room":
		log.Printf("Client %s requested to create a room", c.id)
		c.hub.createRoom(c)

	case "join_room":
		payloadMap, ok := msg.Payload.(map[string]interface{})
		if !ok {
			log.Printf("Invalid join_room payload from %s", c.id)
			return
		}
		roomID, ok := payloadMap["roomId"].(string)
		if !ok {
			log.Printf("Invalid roomID in join_room payload from %s", c.id)
			return
		}
		log.Printf("Client %s requested to join room %s", c.id, roomID)
		c.hub.joinRoom(c, roomID)

	default:
		log.Printf("Unknown lobby message type from player %s: %s", c.id, msg.Type)
	}
}

// writePump pumps messages from the hub/room to the WebSocket connection.
func (c *ClientConn) writePump() {
	// Send ping messages periodically
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				// The hub/room closed the channel.
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			msgBytes, err := json.Marshal(message)
			if err != nil {
				log.Printf("Error marshalling message for client %s: %v", c.id, err)
				return
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, msgBytes); err != nil {
				log.Printf("Error writing message to client %s: %v", c.id, err)
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}

		case <-c.done:
			// readPump signaled us to stop
			return
		}
	}
}

func serveWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	client := newClientConn(conn, hub)

	// Start goroutines first
	go client.writePump()
	go client.readPump()

	// Then register with hub
	hub.register <- client

	// Send welcome message
	welcomeMsg := Message{
		Type:    "welcome",
		Payload: map[string]string{"playerId": client.id},
	}

	// Use non-blocking send for welcome message
	select {
	case client.send <- welcomeMsg:
		log.Printf("Client %s connected and registered with hub.", client.id)
	default:
		log.Printf("Failed to send welcome message to client %s", client.id)
		conn.Close()
	}
}
