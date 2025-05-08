import { Canvas } from "./canvas.js";
import { Player, PlayerState } from "./player.js";
import { Bullet, BulletState } from "./bullet.js";
import { Vector2D } from "./vector2d.js";

interface ServerMessage {
  type: string;
  payload: any;
}

interface ServerGameStatePayload {
  players: { [id: string]: PlayerState };
  bullets: { [id: string]: BulletState };
}

export class Game {
  private canvas: Canvas;
  private ws: WebSocket | null = null;
  private myPlayerId: string | null = null;
  private players: Map<string, Player> = new Map();
  private bullets: Map<string, Bullet> = new Map();
  private keysPressed: { [key: string]: boolean } = {};
  private mousePosition: Vector2D | null = null;
  // private lastTime: number = 0; // deltaTime handled by server, client just renders
  private gameOver: boolean = false; // This concept might change for PvP

  constructor() {
    this.canvas = new Canvas();
    this.connectWebSocket();
    this.setupInputHandlers();
  }

  private connectWebSocket() {
    const serverHost = "localhost:8080";
    const wsUrl = `ws://${serverHost}/ws`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("Connected to game server.");
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
    };

    this.ws.onclose = () => {
      console.log("Disconnected from game server.");
      this.myPlayerId = null;
      this.players.clear();
      this.bullets.clear();
      // Optionally, try to reconnect or show a "disconnected" message
      this.gameOver = true; // Or handle reconnection UI
    };
  }

  private handleServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "welcome":
        this.myPlayerId = msg.payload.playerId;
        console.log("Received welcome. My player ID:", this.myPlayerId);
        // Initial game state might be part of welcome or a separate gameState message
        break;
      case "gameState":
        const statePayload = msg.payload as ServerGameStatePayload;

        // Update or add players
        const receivedPlayerIds = new Set<string>();
        if (statePayload.players) {
          for (const id in statePayload.players) {
            const pState = statePayload.players[id];
            receivedPlayerIds.add(id);
            if (this.players.has(id)) {
              this.players.get(id)!.updateState(pState);
            } else {
              this.players.set(id, new Player(pState));
            }
          }
        }
        // Remove players that are no longer in the server state
        this.players.forEach((player, id) => {
          if (!receivedPlayerIds.has(id)) {
            this.players.delete(id);
          }
        });

        // Update or add bullets
        const receivedBulletIds = new Set<string>();
        if (statePayload.bullets) {
          for (const id in statePayload.bullets) {
            const bState = statePayload.bullets[id];
            receivedBulletIds.add(id);
            if (this.bullets.has(id)) {
              this.bullets.get(id)!.updateState(bState);
            } else {
              this.bullets.set(id, new Bullet(bState));
            }
          }
        }
        // Remove bullets no longer in server state
        this.bullets.forEach((bullet, id) => {
          if (!receivedBulletIds.has(id)) {
            this.bullets.delete(id);
          }
        });
        break;
      // Add other message types if needed (e.g., playerDied, scoreUpdate)
      default:
        console.log("Unknown message type from server:", msg.type);
    }
  }

  private sendWsMessage(type: string, payload: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  private setupInputHandlers() {
    window.addEventListener("keydown", (event: KeyboardEvent) => {
      this.keysPressed[event.key.toLowerCase()] = true;
      this.updatePlayerInput();
    });

    window.addEventListener("keyup", (event: KeyboardEvent) => {
      this.keysPressed[event.key.toLowerCase()] = false;
      this.updatePlayerInput();
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
      if (this.gameOver) {
        // Simple restart logic for client if needed, server handles actual rejoin
        // this.restartGame(); // This would need server interaction
        return;
      }
      if (!this.myPlayerId || !this.mousePosition) return;

      const me = this.players.get(this.myPlayerId);
      if (me && me.getShootingCoolDownTime() <= 0) {
        // Client-side check for immediate feedback
        this.sendWsMessage("shoot", {
          x: this.mousePosition.x,
          y: this.mousePosition.y,
        });
      }
    });
  }

  private updatePlayerInput() {
    if (!this.myPlayerId) return;

    let x = 0;
    let y = 0;
    if (this.keysPressed["w"]) y -= 1;
    if (this.keysPressed["s"]) y += 1;
    if (this.keysPressed["a"]) x -= 1;
    if (this.keysPressed["d"]) x += 1;

    // Normalize if necessary (server also does this for safety)
    const inputVec = new Vector2D(x, y);
    const normalizedInput =
      inputVec.magnitude() > 0 ? inputVec.normalize() : inputVec;

    this.sendWsMessage("input", { x: normalizedInput.x, y: normalizedInput.y });
  }

  private drawUI() {
    if (!this.myPlayerId) return;
    const me = this.players.get(this.myPlayerId);
    if (!me) return;

    // Score / Player Info (Example)
    const panelPadding = 10;
    const scorePanelPosition = new Vector2D(15, 15);
    const scorePanelHeight = 30;

    // My HP
    this.canvas.drawText(
      `HP: ${me.getCurrentHP()}/${me.getMaxHP()}`,
      new Vector2D(
        scorePanelPosition.x,
        scorePanelPosition.y + scorePanelHeight / 2 + 7
      ),
      "white",
      "bold 18px Arial"
    );

    // Cooldown shoot panel
    const cooldownTime = me.getShootingCoolDownTime();
    const maxCooldown = 2; // Should match server PlayerShootCooldown
    const iconSize = 40;
    const iconPosition = new Vector2D(
      scorePanelPosition.x,
      scorePanelPosition.y + scorePanelHeight + panelPadding
    );

    this.canvas.drawRect(iconPosition, iconSize, iconSize, "dimgray");

    if (cooldownTime > 0) {
      const cooldownFillHeight = (cooldownTime / maxCooldown) * iconSize;
      this.canvas.drawRect(
        new Vector2D(
          iconPosition.x,
          iconPosition.y + (iconSize - cooldownFillHeight)
        ),
        iconSize,
        cooldownFillHeight,
        "rgba(50, 50, 50, 0.85)"
      );
    } else {
      this.canvas.drawRect(iconPosition, iconSize, iconSize, "lightgreen");
      this.canvas.drawText(
        "R", // Ready
        new Vector2D(
          iconPosition.x + iconSize / 2,
          iconPosition.y + iconSize / 2 + 7
        ),
        "black",
        "bold 20px Arial",
        "center"
      );
    }
    this.canvas.drawStroke(iconPosition, iconSize, iconSize, "white");

    this.canvas.drawText(
      cooldownTime > 0 ? cooldownTime.toFixed(1) + "s" : "Ready",
      new Vector2D(
        iconPosition.x + iconSize + panelPadding / 2,
        iconPosition.y + iconSize / 2 + 6
      ),
      cooldownTime > 0 ? "yellow" : "lightgreen",
      "16px 'Segoe UI', Arial",
      "left"
    );

    const copyrightText = "Multiplayer Shooter - ikniz";
    this.canvas.drawText(
      copyrightText,
      new Vector2D(
        this.canvas.getWidth() - panelPadding,
        this.canvas.getHeight() - panelPadding
      ),
      "rgba(255, 255, 255, 0.5)",
      "12px Arial",
      "right"
    );
  }

  private drawPlayers() {
    this.players.forEach((player) => {
      this.canvas.drawRect(
        player.getPosition(),
        player.getWidth(),
        player.getHeight(),
        player.getColor()
      );
      // Draw health bar
      const healthBarPos = new Vector2D(
        player.getPosition().x,
        player.getPosition().y - 10 // Above player
      );
      const healthBarMaxWidth = player.getWidth();
      const currentHealthWidth =
        (player.getCurrentHP() / player.getMaxHP()) * healthBarMaxWidth;

      this.canvas.drawRect(healthBarPos, healthBarMaxWidth, 5, "#555"); // Background
      this.canvas.drawRect(healthBarPos, currentHealthWidth, 5, "red");
      this.canvas.drawStroke(healthBarPos, healthBarMaxWidth, 5, "white");

      // Draw player ID (or name if you add that feature)
      this.canvas.drawText(
        player.id.substring(0, 6), // Short ID
        new Vector2D(
          player.getPosition().x + player.getWidth() / 2,
          player.getPosition().y - 15
        ),
        "white",
        "12px Arial",
        "center"
      );

      // Draw short raycast line to mouse for current player
      if (player.id === this.myPlayerId && this.mousePosition) {
        const playerCenter = new Vector2D(
          player.getPosition().x + player.getWidth() / 2,
          player.getPosition().y + player.getHeight() / 2
        );
        const directionToMouse = this.mousePosition
          .add(playerCenter.multiply(-1))
          .normalize();
        const raycastLength = 50;
        const raycastEndPoint = playerCenter.add(
          directionToMouse.multiply(raycastLength)
        );
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
    if (this.bullets.size > 0) {
      console.log(
        `Drawing ${this.bullets.size} bullets. First bullet:`,
        this.bullets.values().next().value
      );
    }
    this.bullets.forEach((bullet) => {
      this.canvas.drawCircle(
        bullet.getPosition(),
        bullet.getRadius(),
        bullet.getWallCollideTime() >= 1 ? "red" : "white" // Red if it can damage
      );
    });
  }

  public gameLoop() {
    // this.deltaTime = Math.min((currentTime - this.lastTime) / 1000, 0.1); // Not needed for client logic
    // this.lastTime = currentTime;

    this.canvas.initCanvas(); // Clear screen

    this.drawPlayers();
    this.drawBullets();
    this.drawUI();

    if (this.gameOver) {
      this.canvas.drawText(
        "Disconnected or Game Over",
        new Vector2D(this.canvas.getWidth() / 2, this.canvas.getHeight() / 2),
        "white",
        "30px Arial",
        "center"
      );
    }

    requestAnimationFrame(() => this.gameLoop());
  }

  public startGame() {
    // this.lastTime = performance.now(); // Not needed for client logic
    requestAnimationFrame(() => this.gameLoop());
  }
}
