package main

import (
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
)

const MaxPlayersPerRoom = 2

// RoomInfo is a light-weight struct for broadcasting room list
type RoomInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	PlayerCount int    `json:"playerCount"`
	MaxPlayers  int    `json:"maxPlayers"`
}

// Hub maintains the set of active clients and rooms.
type Hub struct {
	clients        map[*ClientConn]bool
	rooms          map[string]*GameRoom
	register       chan *ClientConn
	unregister     chan *ClientConn
	unregisterRoom chan *GameRoom
	mu             sync.RWMutex
	// Add shutdown flag
	shutdown bool
}

func NewHub() *Hub {
	return &Hub{
		clients:        make(map[*ClientConn]bool),
		rooms:          make(map[string]*GameRoom),
		register:       make(chan *ClientConn),
		unregister:     make(chan *ClientConn),
		unregisterRoom: make(chan *GameRoom),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			if h.shutdown {
				h.mu.Unlock()
				close(client.send)
				client.conn.Close()
				continue
			}
			h.clients[client] = true
			log.Printf("Client %s registered with Hub. Now %d clients in lobby.", client.id, len(h.clients))
			h.mu.Unlock()

			// Send room list in a separate goroutine to avoid blocking
			go h.sendRoomList(client)

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				// Close send channel safely
				select {
				case <-client.done:
					// Already signaled by readPump
				default:
					close(client.send)
				}
				log.Printf("Client %s disconnected from Hub. Now %d clients in lobby.", client.id, len(h.clients))
			}
			h.mu.Unlock()

		case room := <-h.unregisterRoom:
			h.mu.Lock()
			if _, ok := h.rooms[room.ID]; ok {
				delete(h.rooms, room.ID)
				log.Printf("Room %s (%s) was empty and has been removed.", room.ID, room.getCreatorName())
			}
			h.mu.Unlock()

			// Broadcast room list update in separate goroutine
			go h.broadcastRoomList()
		}
	}
}

func (h *Hub) broadcastRoomList() {
	h.mu.RLock()
	if h.shutdown {
		h.mu.RUnlock()
		return
	}

	roomInfos := h.getRoomInfoList()
	message := Message{Type: "room_list", Payload: roomInfos}

	// Create a slice of clients to avoid holding the lock while sending
	clients := make([]*ClientConn, 0, len(h.clients))
	for client := range h.clients {
		clients = append(clients, client)
	}
	h.mu.RUnlock()

	// Send to clients without holding the main lock
	successCount := 0
	for _, client := range clients {
		select {
		case client.send <- message:
			successCount++
		case <-time.After(100 * time.Millisecond):
			// Client is slow/disconnected, skip it
			log.Printf("Skipping slow lobby client %s during room list broadcast", client.id)
		}
	}
	log.Printf("Broadcasted room list to %d/%d clients in lobby.", successCount, len(clients))
}

func (h *Hub) sendRoomList(client *ClientConn) {
	h.mu.RLock()
	roomInfos := h.getRoomInfoList()
	h.mu.RUnlock()

	message := Message{Type: "room_list", Payload: roomInfos}
	select {
	case client.send <- message:
		log.Printf("Sent room list to client %s", client.id)
	case <-time.After(5 * time.Second):
		log.Printf("Timeout sending room list to client %s", client.id)
	}
}

func (h *Hub) getRoomInfoList() []RoomInfo {
	roomInfos := make([]RoomInfo, 0, len(h.rooms))
	for _, room := range h.rooms {
		room.RLock()
		playerCount := len(room.players)
		creatorName := room.getCreatorName()
		room.RUnlock()

		roomInfos = append(roomInfos, RoomInfo{
			ID:          room.ID,
			Name:        "Room by " + creatorName,
			PlayerCount: playerCount,
			MaxPlayers:  MaxPlayersPerRoom,
		})
	}
	return roomInfos
}

func (h *Hub) createRoom(creator *ClientConn) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.shutdown {
		return
	}

	roomID := uuid.NewString()
	room := NewGameRoom(roomID, h)
	h.rooms[roomID] = room
	go room.Run()

	log.Printf("Client %s created a new room %s", creator.id, roomID)

	// Move creator from hub to the new room
	delete(h.clients, creator)

	// Register creator with room in separate goroutine to avoid blocking
	go func() {
		room.register <- creator
	}()

	// Broadcast room list update
	go h.broadcastRoomList()
}

func (h *Hub) joinRoom(client *ClientConn, roomID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.shutdown {
		return
	}

	room, ok := h.rooms[roomID]
	if !ok {
		log.Printf("Client %s failed to join non-existent room %s", client.id, roomID)
		// Send error message to client
		go func() {
			select {
			case client.send <- Message{Type: "error", Payload: "Room not found"}:
			case <-time.After(time.Second):
			}
		}()
		return
	}

	room.RLock()
	isFull := len(room.players) >= MaxPlayersPerRoom
	room.RUnlock()

	if isFull {
		log.Printf("Client %s failed to join full room %s", client.id, roomID)
		// Send error message to client
		go func() {
			select {
			case client.send <- Message{Type: "error", Payload: "Room is full"}:
			case <-time.After(time.Second):
			}
		}()
		return
	}

	log.Printf("Client %s is joining room %s", client.id, roomID)
	delete(h.clients, client) // Move client from hub

	// Register with room in separate goroutine
	go func() {
		room.register <- client
	}()

	// Broadcast room list update
	go h.broadcastRoomList()
}

func (h *Hub) leaveRoom(client *ClientConn) {
	// Check if client is actually in a room
	if client.room == nil {
		log.Printf("Client %s attempted to leave room but is not in any room", client.id)
		return
	}

	room := client.room
	log.Printf("Client %s is leaving room %s", client.id, room.ID)

	h.mu.Lock()
	room.Lock()

	// Remove client from room
	if _, ok := room.clients[client]; ok {
		delete(room.clients, client)
		if client.player != nil {
			delete(room.players, client.player.ID)
			delete(room.readyPlayers, client.player.ID)
		}
	}

	// Add client back to hub lobby
	client.room = nil
	client.player = nil
	h.clients[client] = true

	// Check if room should be reset due to mid-game leave
	wasInProgress := room.State == StateInProgress || room.State == StateGameOver
	if wasInProgress && len(room.players) < 2 {
		log.Printf("Player left mid-game. Resetting room %s to waiting state.", room.ID)
		room.resetGame()
	}

	// Check if room is now empty and should be removed
	roomShouldBeRemoved := len(room.clients) == 0

	room.Unlock()
	h.mu.Unlock()

	// Send room list to the client who just left (in separate goroutine)
	go h.sendRoomList(client)

	// If room is empty, signal for removal
	if roomShouldBeRemoved {
		log.Printf("Room %s is now empty, signaling for removal", room.ID)
		go func() {
			h.unregisterRoom <- room
		}()
	} else {
		// Broadcast updated room list to lobby clients
		go h.broadcastRoomList()
	}

	log.Printf("Client %s successfully returned to lobby", client.id)
}
