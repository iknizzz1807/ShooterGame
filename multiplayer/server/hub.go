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
	shutdown       bool
}

func NewHub() *Hub {
	return &Hub{
		clients:        make(map[*ClientConn]bool),
		rooms:          make(map[string]*GameRoom),
		register:       make(chan *ClientConn, 512),
		unregister:     make(chan *ClientConn, 512),
		unregisterRoom: make(chan *GameRoom, 128),
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
				room.RLock()
				name := room.getCreatorName()
				room.RUnlock()
				log.Printf("Room %s (%s) was empty and has been removed.", room.ID, name)
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

	// Send to clients without holding the main lock — non-blocking, drop if full
	for _, client := range clients {
		select {
		case client.send <- message:
		default:
		}
	}
	log.Printf("Broadcasted room list to %d clients in lobby.", len(clients))
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
	if h.shutdown {
		h.mu.Unlock()
		return
	}

	roomID := uuid.NewString()
	room := NewGameRoom(roomID, h)
	h.rooms[roomID] = room
	delete(h.clients, creator)
	h.mu.Unlock() // ← unlock hub NGAY, không giữ trong khi setup room

	go room.Run()
	log.Printf("Client %s created a new room %s", creator.id, roomID)

	// Register qua channel — room.Run() xử lý, consistent state
	// Chạy trong goroutine riêng, broadcast SAU KHI creator thật sự vào room
	go func() {
		room.register <- creator
		go h.broadcastRoomList()
	}()
}

func (h *Hub) joinRoom(client *ClientConn, roomID string) {
	h.mu.Lock()
	if h.shutdown {
		h.mu.Unlock()
		return
	}

	room, ok := h.rooms[roomID]
	if !ok {
		h.mu.Unlock()
		log.Printf("Client %s failed to join non-existent room %s", client.id, roomID)
		select {
		case client.send <- Message{Type: "error", Payload: map[string]string{"message": "Room not found"}}:
		default:
		}
		return
	}

	room.RLock()
	isFull := len(room.players) >= MaxPlayersPerRoom
	room.RUnlock()

	if isFull {
		h.mu.Unlock()
		log.Printf("Client %s failed to join full room %s", client.id, roomID)
		select {
		case client.send <- Message{Type: "error", Payload: map[string]string{"message": "Room is full"}}:
		default:
		}
		return
	}

	delete(h.clients, client)
	h.mu.Unlock() // ← unlock hub trước khi gửi vào room.register channel

	log.Printf("Client %s is joining room %s", client.id, roomID)

	// Gửi vào room.register — block goroutine này (readPump), không block Hub
	room.register <- client

	// Broadcast SAU KHI client đã vào room → playerCount đúng
	go h.broadcastRoomList()
}

func (h *Hub) leaveRoom(client *ClientConn) {
	client.roomMu.Lock()
	room := client.room
	client.roomMu.Unlock()

	if room == nil {
		log.Printf("Client %s attempted to leave room but is not in any room", client.id)
		return
	}
	log.Printf("Client %s is leaving room %s", client.id, room.ID)

	// Step 1: remove from room (room lock only)
	room.Lock()
	if _, ok := room.clients[client]; ok {
		delete(room.clients, client)
		if client.player != nil {
			delete(room.players, client.player.ID)
			delete(room.readyPlayers, client.player.ID)
		}
	}
	wasInProgress := room.State == StateInProgress || room.State == StateGameOver
	if wasInProgress && len(room.players) < 2 {
		log.Printf("Player left mid-game. Resetting room %s to waiting state.", room.ID)
		room.resetGame()
	}
	roomShouldBeRemoved := len(room.clients) == 0
	room.Unlock()

	// Step 2: clear client's room ref
	client.roomMu.Lock()
	client.room = nil
	client.player = nil
	client.roomMu.Unlock()

	// Step 3: add back to hub lobby (hub lock only)
	h.mu.Lock()
	h.clients[client] = true
	h.mu.Unlock()

	log.Printf("Client %s successfully returned to lobby", client.id)

	go h.sendRoomList(client)

	if roomShouldBeRemoved {
		log.Printf("Room %s is now empty, signaling for removal", room.ID)
		go func() {
			h.unregisterRoom <- room
		}()
	} else {
		go h.broadcastRoomList()
	}
}
