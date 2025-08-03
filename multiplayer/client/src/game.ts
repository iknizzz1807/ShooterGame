import { Canvas } from "./canvas.js";
import { Player, PlayerState } from "./player.js";
import { Bullet, BulletState } from "./bullet.js";
import { Vector2D } from "./vector2d.js";

// --- INTERFACES ---

interface ServerMessage {
  type: string;
  payload: any;
}

// Server payload when in a game room
interface ServerGameStatePayload {
  players: { [id: string]: PlayerState };
  bullets: { [id: string]: BulletState };
  state: string; // "waiting", "in_progress", "game_over"
  winnerId: string;
  readyPlayers: { [id: string]: boolean };
}

// Server payload for room info in the lobby
interface RoomInfo {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
}

// Type for storing clickable UI element boundaries
interface ClickableArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class Game {
  // --- CORE PROPERTIES ---
  private canvas: Canvas;
  private ws: WebSocket | null = null;
  private myPlayerId: string | null = null;

  // --- STATE MANAGEMENT ---
  private clientState: "connecting" | "lobby" | "in_game" | "disconnected" =
    "connecting";
  private roomState: string = "waiting"; // The state of the game *inside* a room
  private winnerId: string | null = null;
  private amIReady: boolean = false;

  // --- DATA STORAGE ---
  private players: Map<string, Player> = new Map();
  private bullets: Map<string, Bullet> = new Map();
  private rooms: RoomInfo[] = [];

  // --- INPUT & UI ---
  private keysPressed: { [key: string]: boolean } = {};
  private mousePosition: Vector2D | null = null;
  private roomListClickableAreas: { [id: string]: ClickableArea } = {};
  private createRoomButtonArea: ClickableArea | null = null;
  private leaveRoomButtonArea: ClickableArea | null = null;

  constructor() {
    this.canvas = new Canvas();
    this.connectWebSocket();
    this.setupInputHandlers();
  }

  // --- NETWORK LOGIC ---

  private connectWebSocket() {
    const serverHost = "localhost:8080";
    const wsUrl = `ws://${serverHost}/ws`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("Connected to game server hub.");
      this.clientState = "lobby"; // Initial state after connection is the lobby
    };

    this.ws.onmessage = (event) => {
      try {
        const serverMsg: ServerMessage = JSON.parse(event.data as string);
        this.handleServerMessage(serverMsg);
      } catch (error) {
        console.error("Error parsing server message:", error, event.data);
      }
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      this.clientState = "disconnected";
    };

    this.ws.onclose = () => {
      console.log("Disconnected from game server.");
      this.myPlayerId = null;
      this.clientState = "disconnected";
    };
  }

  private handleServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "welcome":
        this.myPlayerId = msg.payload.playerId;
        console.log("Received welcome. My player ID:", this.myPlayerId);
        break;

      case "room_list":
        this.clientState = "lobby";
        this.rooms = (msg.payload as RoomInfo[]) || [];
        // Clear old game data when returning to lobby
        this.players.clear();
        this.bullets.clear();
        console.log("Received room list:", this.rooms);
        break;

      case "gameState":
        this.clientState = "in_game";
        const statePayload = msg.payload as ServerGameStatePayload;
        this.roomState = statePayload.state;
        this.winnerId = statePayload.winnerId;

        this.amIReady = this.myPlayerId
          ? statePayload.readyPlayers[this.myPlayerId] || false
          : false;

        // Update players
        const receivedPlayerIds = new Set(
          Object.keys(statePayload.players || {})
        );
        this.players.forEach((_, id) => {
          if (!receivedPlayerIds.has(id)) this.players.delete(id);
        });
        receivedPlayerIds.forEach((id) => {
          const pState = statePayload.players[id];
          if (this.players.has(id)) {
            this.players.get(id)!.updateState(pState);
          } else {
            this.players.set(id, new Player(pState));
          }
        });

        // Update bullets
        const receivedBulletIds = new Set(
          Object.keys(statePayload.bullets || {})
        );
        this.bullets.forEach((_, id) => {
          if (!receivedBulletIds.has(id)) this.bullets.delete(id);
        });
        receivedBulletIds.forEach((id) => {
          const bState = statePayload.bullets[id];
          if (this.bullets.has(id)) {
            this.bullets.get(id)!.updateState(bState);
          } else {
            this.bullets.set(id, new Bullet(bState));
          }
        });
        break;

      default:
        console.log("Unknown message type from server:", msg.type);
    }
  }

  private sendWsMessage(type: string, payload: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  // --- INPUT HANDLING ---

  private setupInputHandlers() {
    window.addEventListener("keydown", (event: KeyboardEvent) => {
      if (this.clientState === "in_game") {
        this.keysPressed[event.key.toLowerCase()] = true;
        this.updatePlayerInput();
      }
    });

    window.addEventListener("keyup", (event: KeyboardEvent) => {
      if (this.clientState === "in_game") {
        this.keysPressed[event.key.toLowerCase()] = false;
        this.updatePlayerInput();
      }
    });

    this.canvas
      .getCanvas()
      ?.addEventListener("mousemove", (event: MouseEvent) => {
        const canvasRect = this.canvas.getCanvas()!.getBoundingClientRect();
        this.mousePosition = new Vector2D(
          event.clientX - canvasRect.left,
          event.clientY - canvasRect.top
        );
      });

    this.canvas.getCanvas()?.addEventListener("click", (event: MouseEvent) => {
      const canvasRect = this.canvas.getCanvas()!.getBoundingClientRect();
      const clickPos = new Vector2D(
        event.clientX - canvasRect.left,
        event.clientY - canvasRect.top
      );

      switch (this.clientState) {
        case "lobby":
          this.handleLobbyClick(clickPos);
          break;
        case "in_game":
          this.handleInGameClick(clickPos);
          break;
      }
    });
  }

  private handleLobbyClick(clickPos: Vector2D) {
    // Check "Create Room" button
    if (
      this.createRoomButtonArea &&
      this.isClickInArea(clickPos, this.createRoomButtonArea)
    ) {
      console.log("Sending create_room message.");
      this.sendWsMessage("create_room", {});
      return;
    }
    // Check "Join Room" buttons
    for (const roomId in this.roomListClickableAreas) {
      if (this.isClickInArea(clickPos, this.roomListClickableAreas[roomId])) {
        console.log(`Sending join_room message for room ${roomId}.`);
        this.sendWsMessage("join_room", { roomId });
        return;
      }
    }
  }

  private handleInGameClick(clickPos: Vector2D) {
    // Check "Leave Room" button first
    if (
      this.leaveRoomButtonArea &&
      this.isClickInArea(clickPos, this.leaveRoomButtonArea)
    ) {
      console.log("Sending leave_room message.");
      this.sendWsMessage("leave_room", {});
      return; // The server will send a 'room_list' which will change our state back to lobby
    }

    // Logic depends on the state *within* the game room
    switch (this.roomState) {
      case "waiting":
        if (!this.amIReady) {
          console.log("Sending ready message to server.");
          this.sendWsMessage("ready", {});
        }
        break;
      case "in_progress":
        if (!this.myPlayerId || !this.mousePosition) return;
        const me = this.players.get(this.myPlayerId);
        if (me && me.getShootingCoolDownTime() <= 0) {
          this.sendWsMessage("shoot", {
            x: this.mousePosition.x,
            y: this.mousePosition.y,
          });
        }
        break;
      case "game_over":
        console.log("Sending restart message to server.");
        this.sendWsMessage("restart", {});
        break;
    }
  }

  private isClickInArea(clickPos: Vector2D, area: ClickableArea): boolean {
    return (
      clickPos.x >= area.x &&
      clickPos.x <= area.x + area.width &&
      clickPos.y >= area.y &&
      clickPos.y <= area.y + area.height
    );
  }

  private updatePlayerInput() {
    if (!this.myPlayerId || this.clientState !== "in_game") return;

    let x = 0;
    let y = 0;
    if (this.keysPressed["w"]) y -= 1;
    if (this.keysPressed["s"]) y += 1;
    if (this.keysPressed["a"]) x -= 1;
    if (this.keysPressed["d"]) x += 1;

    const inputVec = new Vector2D(x, y);
    const normalizedInput =
      inputVec.magnitude() > 0 ? inputVec.normalize() : inputVec;
    this.sendWsMessage("input", { x: normalizedInput.x, y: normalizedInput.y });
  }

  // --- DRAWING LOGIC ---

  private drawLobby() {
    const centerX = this.canvas.getWidth() / 2;
    // Clear previous clickable areas
    this.roomListClickableAreas = {};

    // Title
    this.canvas.drawText(
      "Game Lobby",
      new Vector2D(centerX, 80),
      "white",
      "bold 48px Arial",
      "center"
    );

    // Create Room Button
    const createBtnWidth = 250;
    const createBtnHeight = 50;
    const createBtnPos = new Vector2D(centerX - createBtnWidth / 2, 120);
    this.createRoomButtonArea = {
      x: createBtnPos.x,
      y: createBtnPos.y,
      width: createBtnWidth,
      height: createBtnHeight,
    };
    this.canvas.drawRect(
      createBtnPos,
      createBtnWidth,
      createBtnHeight,
      "#2a9d8f"
    );
    this.canvas.drawText(
      "Create New Room",
      new Vector2D(centerX, createBtnPos.y + 35),
      "white",
      "24px Arial",
      "center"
    );

    // Room List
    let yOffset = 220;
    const roomHeight = 60;
    const roomWidth = 600;
    const roomStartX = centerX - roomWidth / 2;

    if (this.rooms.length === 0) {
      this.canvas.drawText(
        "No rooms available. Create one!",
        new Vector2D(centerX, yOffset + 30),
        "lightgray",
        "20px Arial",
        "center"
      );
    }

    this.rooms.forEach((room) => {
      // Room background
      this.canvas.drawRect(
        new Vector2D(roomStartX, yOffset),
        roomWidth,
        roomHeight,
        "#333"
      );
      this.canvas.drawStroke(
        new Vector2D(roomStartX, yOffset),
        roomWidth,
        roomHeight,
        "#555"
      );

      // Room info text
      const roomInfoText = `${room.name}  -  Players: ${room.playerCount}/${room.maxPlayers}`;
      this.canvas.drawText(
        roomInfoText,
        new Vector2D(roomStartX + 20, yOffset + 38),
        "white",
        "20px Arial",
        "left"
      );

      // Join button
      if (room.playerCount < room.maxPlayers) {
        const joinBtnWidth = 100;
        const joinBtnHeight = 40;
        const joinBtnPos = new Vector2D(
          roomStartX + roomWidth - joinBtnWidth - 10,
          yOffset + 10
        );
        this.roomListClickableAreas[room.id] = {
          x: joinBtnPos.x,
          y: joinBtnPos.y,
          width: joinBtnWidth,
          height: joinBtnHeight,
        };

        this.canvas.drawRect(
          joinBtnPos,
          joinBtnWidth,
          joinBtnHeight,
          "#e9c46a"
        );
        this.canvas.drawText(
          "Join",
          new Vector2D(joinBtnPos.x + joinBtnWidth / 2, joinBtnPos.y + 28),
          "black",
          "bold 20px Arial",
          "center"
        );
      } else {
        this.canvas.drawText(
          "Full",
          new Vector2D(roomStartX + roomWidth - 55, yOffset + 38),
          "red",
          "bold 20px Arial",
          "center"
        );
      }

      yOffset += roomHeight + 15;
    });
  }

  private drawInGameUI() {
    if (!this.myPlayerId) return;
    const me = this.players.get(this.myPlayerId);
    if (!me) return;

    // --- Leave Room Button ---
    const leaveBtnWidth = 120;
    const leaveBtnHeight = 30;
    const leaveBtnPos = new Vector2D(
      this.canvas.getWidth() - leaveBtnWidth - 15,
      15
    );
    this.leaveRoomButtonArea = {
      x: leaveBtnPos.x,
      y: leaveBtnPos.y,
      width: leaveBtnWidth,
      height: leaveBtnHeight,
    };
    this.canvas.drawRect(leaveBtnPos, leaveBtnWidth, leaveBtnHeight, "#e76f51");
    this.canvas.drawText(
      "Back to Lobby",
      new Vector2D(leaveBtnPos.x + leaveBtnWidth / 2, leaveBtnPos.y + 21),
      "white",
      "16px Arial",
      "center"
    );

    // --- HP Info ---
    const panelPadding = 10;
    const infoPanelPos = new Vector2D(15, 15);
    this.canvas.drawText(
      `HP: ${me.getCurrentHP()}/${me.getMaxHP()}`,
      new Vector2D(infoPanelPos.x, infoPanelPos.y + 15),
      "white",
      "bold 18px Arial"
    );

    // --- Cooldown Panel ---
    const cooldownTime = me.getShootingCoolDownTime();
    const maxCooldown = 2; // Should match server
    const iconSize = 40;
    const iconPos = new Vector2D(infoPanelPos.x, infoPanelPos.y + 25);

    this.canvas.drawRect(iconPos, iconSize, iconSize, "dimgray");
    if (cooldownTime > 0) {
      const fillHeight = (cooldownTime / maxCooldown) * iconSize;
      this.canvas.drawRect(
        new Vector2D(iconPos.x, iconPos.y + (iconSize - fillHeight)),
        iconSize,
        fillHeight,
        "rgba(50, 50, 50, 0.85)"
      );
    } else {
      this.canvas.drawRect(iconPos, iconSize, iconSize, "lightgreen");
      this.canvas.drawText(
        "R",
        new Vector2D(iconPos.x + iconSize / 2, iconPos.y + iconSize / 2 + 7),
        "black",
        "bold 20px Arial",
        "center"
      );
    }
    this.canvas.drawStroke(iconPos, iconSize, iconSize, "white");
    this.canvas.drawText(
      cooldownTime > 0 ? cooldownTime.toFixed(1) + "s" : "Ready",
      new Vector2D(
        iconPos.x + iconSize + panelPadding / 2,
        iconPos.y + iconSize / 2 + 6
      ),
      cooldownTime > 0 ? "yellow" : "lightgreen",
      "16px 'Segoe UI', Arial",
      "left"
    );
  }

  private drawPlayers() {
    this.players.forEach((player) => {
      const color = player.id === this.myPlayerId ? "gold" : player.getColor();
      this.canvas.drawRect(
        player.getPosition(),
        player.getWidth(),
        player.getHeight(),
        color
      );

      // "YOU" text
      if (player.id === this.myPlayerId) {
        this.canvas.drawText(
          "YOU",
          new Vector2D(
            player.getPosition().x + player.getWidth() / 2,
            player.getPosition().y - 30
          ),
          "gold",
          "bold 14px Arial",
          "center"
        );
      }

      // Health bar
      const healthBarPos = new Vector2D(
        player.getPosition().x,
        player.getPosition().y - 10
      );
      const healthBarMaxWidth = player.getWidth();
      const currentHealthWidth =
        (player.getCurrentHP() / player.getMaxHP()) * healthBarMaxWidth;
      this.canvas.drawRect(healthBarPos, healthBarMaxWidth, 5, "#555");
      this.canvas.drawRect(healthBarPos, currentHealthWidth, 5, "red");
      this.canvas.drawStroke(healthBarPos, healthBarMaxWidth, 5, "white");

      // Player ID
      this.canvas.drawText(
        player.id.substring(0, 6),
        new Vector2D(
          player.getPosition().x + player.getWidth() / 2,
          player.getPosition().y - 15
        ),
        "white",
        "12px Arial",
        "center"
      );

      // Aiming line
      if (player.id === this.myPlayerId && this.mousePosition) {
        const playerCenter = player
          .getPosition()
          .add(new Vector2D(player.getWidth() / 2, player.getHeight() / 2));
        const directionToMouse = this.mousePosition
          .add(playerCenter.multiply(-1))
          .normalize();
        const raycastEndPoint = playerCenter.add(directionToMouse.multiply(50));
        this.canvas.drawLine(
          playerCenter,
          raycastEndPoint,
          "rgba(255,0,0,0.5)",
          2
        );
      }
    });
  }

  private drawBullets() {
    this.bullets.forEach((bullet) => {
      this.canvas.drawCircle(
        bullet.getPosition(),
        bullet.getRadius(),
        bullet.getWallCollideTime() >= 1 ? "red" : "white"
      );
    });
  }

  private drawInGameContent() {
    switch (this.roomState) {
      case "waiting":
        this.drawPlayers();
        this.canvas.drawText(
          this.players.size < 2
            ? "Waiting for player..."
            : this.amIReady
            ? "Waiting for opponent..."
            : "Click to Ready",
          new Vector2D(this.canvas.getWidth() / 2, this.canvas.getHeight() / 2),
          "white",
          "30px Arial",
          "center"
        );
        this.drawInGameUI();
        break;

      case "in_progress":
        this.drawPlayers();
        this.drawBullets();
        this.drawInGameUI();
        break;

      case "game_over":
        this.drawPlayers();
        const winner = this.players.get(this.winnerId!);
        const winnerText =
          winner?.id === this.myPlayerId ? "YOU WIN!" : `YOU LOSE!`;
        const centerX = this.canvas.getWidth() / 2;
        const centerY = this.canvas.getHeight() / 2;
        this.canvas.drawText(
          "GAME OVER",
          new Vector2D(centerX, centerY - 40),
          "red",
          "50px Arial",
          "center"
        );
        this.canvas.drawText(
          winnerText,
          new Vector2D(centerX, centerY + 10),
          "white",
          "30px Arial",
          "center"
        );
        this.canvas.drawText(
          "Click to Ready for Rematch",
          new Vector2D(centerX, centerY + 60),
          "lightgray",
          "20px Arial",
          "center"
        );
        this.drawInGameUI();
        break;
    }
  }

  // --- MAIN GAME LOOP ---

  public gameLoop() {
    this.canvas.initCanvas();
    const centerX = this.canvas.getWidth() / 2;
    const centerY = this.canvas.getHeight() / 2;

    switch (this.clientState) {
      case "connecting":
        this.canvas.drawText(
          "Connecting to server...",
          new Vector2D(centerX, centerY),
          "white",
          "30px Arial",
          "center"
        );
        break;

      case "lobby":
        this.drawLobby();
        break;

      case "in_game":
        this.drawInGameContent();
        break;

      case "disconnected":
        this.canvas.drawText(
          "Disconnected from server",
          new Vector2D(centerX, centerY),
          "white",
          "30px Arial",
          "center"
        );
        this.canvas.drawText(
          "Please refresh the page to reconnect.",
          new Vector2D(centerX, centerY + 40),
          "lightgray",
          "20px Arial",
          "center"
        );
        break;
    }

    requestAnimationFrame(() => this.gameLoop());
  }

  public startGame() {
    requestAnimationFrame(() => this.gameLoop());
  }
}
