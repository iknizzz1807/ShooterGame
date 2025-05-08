package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true }, // Allow all origins for simplicity
}

// ClientConn represents a connected client
type ClientConn struct {
	id          string
	conn        *websocket.Conn
	gameManager *GameManager
	send        chan Message // Buffered channel of outbound messages
	player      *Player      // Reference to the player object this client controls
}

// Message defines the structure for WebSocket communication
type Message struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

func newClientConn(conn *websocket.Conn, gm *GameManager) *ClientConn {
	return &ClientConn{
		id:          uuid.NewString(),
		conn:        conn,
		gameManager: gm,
		send:        make(chan Message, 256), // Buffer size
	}
}

// readPump pumps messages from the WebSocket connection to the gameManager.
func (c *ClientConn) readPump() {
	defer func() {
		c.gameManager.unregister <- c
		c.conn.Close()
	}()
	// c.conn.SetReadLimit(maxMessageSize) // Optional: Set max message size
	// c.conn.SetReadDeadline(time.Now().Add(pongWait)) // Optional: For pings/pongs
	// c.conn.SetPongHandler(func(string) error { c.conn.SetReadDeadline(time.Now().Add(pongWait)); return nil })

	for {
		_, messageBytes, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error: %v", err)
			}
			break
		}

		var msg Message
		if err := json.Unmarshal(messageBytes, &msg); err != nil {
			log.Printf("Error unmarshalling message: %v", err)
			continue
		}

		// Process message based on type
		switch msg.Type {
		case "input":
			// Assuming payload is map[string]interface{} that can be cast to Vector2D-like struct
			payloadMap, ok := msg.Payload.(map[string]interface{})
			if !ok {
				log.Printf("Invalid input payload format for player %s", c.id)
				continue
			}
			inputX, xOk := payloadMap["x"].(float64)
			inputY, yOk := payloadMap["y"].(float64)
			if !xOk || !yOk {
				log.Printf("Invalid input coordinate types for player %s", c.id)
				continue
			}
			c.gameManager.playerInputChan <- PlayerInputAction{
				PlayerID: c.id,
				Input:    NewVector2D(inputX, inputY),
			}
		case "shoot":
			payloadMap, ok := msg.Payload.(map[string]interface{})
			if !ok {
				log.Printf("Invalid shoot payload format for player %s", c.id)
				continue
			}
			targetX, xOk := payloadMap["x"].(float64)
			targetY, yOk := payloadMap["y"].(float64)
			if !xOk || !yOk {
				log.Printf("Invalid shoot coordinate types for player %s", c.id)
				continue
			}
			c.gameManager.playerShootChan <- PlayerShootAction{
				PlayerID:  c.id,
				TargetPos: NewVector2D(targetX, targetY),
			}
		default:
			log.Printf("Unknown message type: %s from player %s", msg.Type, c.id)
		}
	}
}

// writePump pumps messages from the gameManager to the WebSocket connection.
func (c *ClientConn) writePump() {
	// ticker := time.NewTicker(pingPeriod) // Optional: For pings
	defer func() {
		// ticker.Stop() // Optional
		c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			// c.conn.SetWriteDeadline(time.Now().Add(writeWait)) // Optional
			if !ok {
				// The gameManager closed the channel.
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			msgBytes, err := json.Marshal(message)
			if err != nil {
				log.Printf("Error marshalling message: %v", err)
				return // Or continue, depending on desired error handling
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, msgBytes); err != nil {
				log.Printf("Error writing message: %v", err)
				return
			}
			// Optional: Ping mechanism
			// case <-ticker.C:
			// 	c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			// 	if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
			// 		return
			// 	}
		}
	}
}

func serveWs(gm *GameManager, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}
	client := newClientConn(conn, gm)
	gm.register <- client

	// Send a welcome message with the client's ID
	welcomeMsg := Message{Type: "welcome", Payload: map[string]string{"playerId": client.id}}
	client.send <- welcomeMsg

	// Allow collection of memory referenced by the caller by doing all work in
	// new goroutines.
	go client.writePump()
	go client.readPump()
	log.Printf("Client %s connected.", client.id)
}
