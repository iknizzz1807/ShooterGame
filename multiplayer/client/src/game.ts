import { Canvas } from "./canvas.js";
import { Player, PlayerState } from "./player.js";
import { Bullet, BulletState } from "./bullet.js";
import { Vector2D } from "./vector2d.js";

// --- INTERFACES ---

interface ServerMessage {
  type: string;
  payload: any;
}

interface ServerGameStatePayload {
  roomId: string;
  players: { [id: string]: PlayerState };
  bullets: { [id: string]: BulletState };
  state: string;
  winnerId: string;
  readyPlayers: { [id: string]: boolean };
  timeRemaining: number;
  shootCooldownMax: number;
}

interface RoomInfo {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
}

interface ClickableArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class Game {
  // --- CORE ---
  private canvas: Canvas;
  private ws: WebSocket | null = null;
  private myPlayerId: string | null = null;

  // --- STATE ---
  private clientState: "connecting" | "lobby" | "in_game" | "disconnected" =
    "connecting";
  private roomState: string = "waiting";
  private winnerId: string | null = null;
  private amIReady: boolean = false;
  private timeRemaining: number = 0;
  private shootCooldownMax: number = 2;

  // --- DATA ---
  private players: Map<string, Player> = new Map();
  private bullets: Map<string, Bullet> = new Map();
  private rooms: RoomInfo[] = [];

  // --- INPUT & UI ---
  private keysPressed: { [key: string]: boolean } = {};
  private mousePosition: Vector2D | null = null;
  private roomListClickableAreas: { [id: string]: ClickableArea } = {};
  private copyIdAreas: { [id: string]: ClickableArea } = {};
  private createRoomButtonArea: ClickableArea | null = null;
  private leaveRoomButtonArea: ClickableArea | null = null;
  private _waitingCopyArea: ClickableArea | null = null;

  // --- LOBBY SCROLL & SEARCH ---
  private lobbyScrollOffset: number = 0;
  private searchQuery: string = "";
  private searchInput: HTMLInputElement | null = null;
  private copyToast: { text: string; expiry: number } | null = null;
  private currentRoomId: string | null = null;

  // --- ANIMATION ---
  private animTime: number = 0;

  constructor() {
    this.canvas = new Canvas();
    this.connectWebSocket();
    this.setupInputHandlers();
    this.setupSearchInput();
  }

  private setupSearchInput() {
    // HTML overlay input — sits on top of canvas, styled to look native
    const input = document.createElement("input");
    input.id = "room-search";
    input.type = "text";
    input.placeholder = "search room ID or name...";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.style.cssText = `
      position: absolute;
      display: none;
      font: 14px monospace;
      background: rgba(10,20,8,0.92);
      color: #b8d090;
      border: 1px solid #3a6a28;
      outline: none;
      padding: 6px 10px;
      letter-spacing: 1px;
    `;
    const syncQuery = () => {
      this.searchQuery = input.value.toLowerCase();
      this.lobbyScrollOffset = 0;
    };
    input.addEventListener("input", syncQuery);
    // keyup catches Backspace/Delete on some browsers where `input` event misfires
    input.addEventListener("keyup", syncQuery);
    // Prevent game keys from firing while typing
    input.addEventListener("keydown", (e) => e.stopPropagation());
    document.body.appendChild(input);
    this.searchInput = input;
  }

  // Position the HTML search input to match the canvas-scaled lobby panel.
  // canvasX/Y/W/H are in canvas-pixel space; this maps them to screen pixels.
  private positionSearchInput(canvasX: number, canvasY: number, canvasW: number, canvasH: number) {
    if (!this.searchInput) return;
    const canvasEl = this.canvas.getCanvas();
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const scaleX = rect.width / this.canvas.getWidth();
    const scaleY = rect.height / this.canvas.getHeight();

    this.searchInput.style.left   = `${rect.left + canvasX * scaleX}px`;
    this.searchInput.style.top    = `${rect.top  + canvasY * scaleY}px`;
    this.searchInput.style.width  = `${canvasW * scaleX}px`;
    this.searchInput.style.height = `${canvasH * scaleY}px`;
    this.searchInput.style.fontSize = `${13 * Math.min(scaleX, scaleY)}px`;
  }

  // --- NETWORK ---

  private connectWebSocket() {
    const serverHost = "localhost:8080";
    this.ws = new WebSocket(`ws://${serverHost}/ws`);

    this.ws.onopen = () => {
      console.log("Connected to game server.");
      this.clientState = "lobby";
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data as string);
        this.handleServerMessage(msg);
      } catch (e) {
        console.error("Parse error:", e);
      }
    };

    this.ws.onerror = () => { this.clientState = "disconnected"; };
    this.ws.onclose = () => {
      this.myPlayerId = null;
      this.clientState = "disconnected";
    };
  }

  private handleServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "welcome":
        this.myPlayerId = msg.payload.playerId;
        break;

      case "room_list":
        this.clientState = "lobby";
        this.currentRoomId = null;
        this.rooms = (msg.payload as RoomInfo[]) || [];
        this.players.clear();
        this.bullets.clear();
        this.keysPressed = {};
        break;

      case "error":
        console.error("Server error:", msg.payload?.message);
        break;

      case "gameState":
        this.clientState = "in_game";
        const sp = msg.payload as ServerGameStatePayload;
        this.currentRoomId = sp.roomId || null;
        this.roomState = sp.state;
        this.winnerId = sp.winnerId || null;
        this.timeRemaining = sp.timeRemaining ?? 0;
        this.shootCooldownMax = sp.shootCooldownMax ?? 2;
        this.amIReady = this.myPlayerId
          ? sp.readyPlayers[this.myPlayerId] || false
          : false;

        const pIds = new Set(Object.keys(sp.players || {}));
        this.players.forEach((_, id) => { if (!pIds.has(id)) this.players.delete(id); });
        pIds.forEach((id) => {
          const s = sp.players[id];
          if (this.players.has(id)) this.players.get(id)!.updateState(s);
          else this.players.set(id, new Player(s));
        });

        const bIds = new Set(Object.keys(sp.bullets || {}));
        this.bullets.forEach((_, id) => { if (!bIds.has(id)) this.bullets.delete(id); });
        bIds.forEach((id) => {
          const s = sp.bullets[id];
          if (this.bullets.has(id)) this.bullets.get(id)!.updateState(s);
          else this.bullets.set(id, new Bullet(s));
        });
        break;
    }
  }

  private sendWsMessage(type: string, payload: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  // --- INPUT ---

  private setupInputHandlers() {
    window.addEventListener("keydown", (e: KeyboardEvent) => {
      if (this.clientState === "in_game") {
        this.keysPressed[e.key.toLowerCase()] = true;
        this.updatePlayerInput();
      }
    });
    window.addEventListener("keyup", (e: KeyboardEvent) => {
      if (this.clientState === "in_game") {
        this.keysPressed[e.key.toLowerCase()] = false;
        this.updatePlayerInput();
      }
    });

    this.canvas.getCanvas()?.addEventListener("mousemove", (e: MouseEvent) => {
      const r = this.canvas.getCanvas()!.getBoundingClientRect();
      // CSS may scale the canvas element — map CSS pixels back to canvas pixels
      const scaleX = this.canvas.getWidth() / r.width;
      const scaleY = this.canvas.getHeight() / r.height;
      this.mousePosition = new Vector2D(
        (e.clientX - r.left) * scaleX,
        (e.clientY - r.top) * scaleY
      );
    });

    this.canvas.getCanvas()?.addEventListener("wheel", (e: WheelEvent) => {
      if (this.clientState === "lobby") {
        this.lobbyScrollOffset = Math.max(0, this.lobbyScrollOffset + e.deltaY * 0.5);
        e.preventDefault();
      }
    }, { passive: false });

    this.canvas.getCanvas()?.addEventListener("click", (e: MouseEvent) => {
      const r = this.canvas.getCanvas()!.getBoundingClientRect();
      const scaleX = this.canvas.getWidth() / r.width;
      const scaleY = this.canvas.getHeight() / r.height;
      const pos = new Vector2D(
        (e.clientX - r.left) * scaleX,
        (e.clientY - r.top) * scaleY
      );
      if (this.clientState === "lobby") this.handleLobbyClick(pos);
      else if (this.clientState === "in_game") this.handleInGameClick(pos);
    });
  }

  private handleLobbyClick(pos: Vector2D) {
    if (this.createRoomButtonArea && this.inArea(pos, this.createRoomButtonArea)) {
      this.sendWsMessage("create_room", {});
      return;
    }
    // Copy room ID chip
    for (const id in this.copyIdAreas) {
      if (this.inArea(pos, this.copyIdAreas[id])) {
        navigator.clipboard.writeText(id).then(() => {
          this.copyToast = { text: "Room ID copied!", expiry: Date.now() + 2000 };
        });
        return;
      }
    }
    // Join button
    for (const id in this.roomListClickableAreas) {
      if (this.inArea(pos, this.roomListClickableAreas[id])) {
        this.sendWsMessage("join_room", { roomId: id });
        return;
      }
    }
  }

  private handleInGameClick(pos: Vector2D) {
    if (this.leaveRoomButtonArea && this.inArea(pos, this.leaveRoomButtonArea)) {
      this.sendWsMessage("leave_room", {});
      return;
    }
    switch (this.roomState) {
      case "waiting":
        // Copy room ID chip
        if (this._waitingCopyArea && this.inArea(pos, this._waitingCopyArea) && this.currentRoomId) {
          navigator.clipboard.writeText(this.currentRoomId).then(() => {
            this.copyToast = { text: "Room ID copied!", expiry: Date.now() + 2000 };
          });
          return;
        }
        if (!this.amIReady) this.sendWsMessage("ready", {});
        break;
      case "in_progress":
        if (!this.myPlayerId || !this.mousePosition) return;
        const me = this.players.get(this.myPlayerId);
        if (me && me.getShootingCoolDownTime() <= 0) {
          this.sendWsMessage("shoot", { x: this.mousePosition.x, y: this.mousePosition.y });
        }
        break;
      case "game_over":
        this.sendWsMessage("restart", {});
        break;
    }
  }

  private inArea(pos: Vector2D, area: ClickableArea): boolean {
    return pos.x >= area.x && pos.x <= area.x + area.width
      && pos.y >= area.y && pos.y <= area.y + area.height;
  }

  private updatePlayerInput() {
    if (!this.myPlayerId || this.clientState !== "in_game") return;
    let x = 0, y = 0;
    if (this.keysPressed["w"]) y -= 1;
    if (this.keysPressed["s"]) y += 1;
    if (this.keysPressed["a"]) x -= 1;
    if (this.keysPressed["d"]) x += 1;
    const v = new Vector2D(x, y);
    const norm = v.magnitude() > 0 ? v.normalize() : v;
    this.sendWsMessage("input", { x: norm.x, y: norm.y });
  }

  // --- DRAWING HELPERS ---

  // Flat military button — returns the area for click detection
  private drawMilButton(
    cx: number, cy: number, w: number, h: number,
    label: string,
    variant: "green" | "red" | "yellow" | "gray" = "green",
    pulse: boolean = false
  ): ClickableArea {
    const ctx = this.canvas.getCtx();
    const x = cx - w / 2, y = cy - h / 2;
    const r = 4;

    const colors: Record<string, [string, string, string]> = {
      green:  ["#2d5a27", "#3a7a32", "#4aaa40"],
      red:    ["#5a1a1a", "#7a2222", "#aa3333"],
      yellow: ["#5a4a10", "#7a6618", "#aaa030"],
      gray:   ["#2a2a2a", "#3a3a3a", "#555555"],
    };
    const [dark, mid, light] = colors[variant];

    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    this.canvas.drawRoundRect(new Vector2D(x + 3, y + 3), w, h, r, "rgba(0,0,0,0.4)");

    // Body
    this.canvas.drawRoundRect(new Vector2D(x, y), w, h, r, mid, dark, 2);

    // Top highlight
    ctx.fillStyle = light;
    ctx.fillRect(x + r, y + 2, w - r * 2, 3);

    // Pulse glow when active
    if (pulse) {
      const alpha = 0.3 + 0.2 * Math.sin(this.animTime * 4);
      ctx.save();
      ctx.shadowColor = light;
      ctx.shadowBlur = 18;
      ctx.strokeStyle = `rgba(100,220,80,${alpha})`;
      ctx.lineWidth = 2;
      this.canvas.drawRoundRect(new Vector2D(x, y), w, h, r, "transparent", `rgba(100,220,80,${alpha})`, 2);
      ctx.restore();
    }

    // Label
    this.canvas.drawText(label, new Vector2D(cx, cy + 6), "#e8e0c0", `bold 16px monospace`, "center");

    return { x, y, width: w, height: h };
  }

  // --- LOBBY DRAWING ---

  private drawLobby() {
    const ctx = this.canvas.getCtx();
    const W = this.canvas.getWidth();
    const H = this.canvas.getHeight();
    const cx = W / 2;

    this.roomListClickableAreas = {};
    this.copyIdAreas = {};

    // ── Panel ────────────────────────────────────────────────
    const panelX = cx - 360, panelY = 20, panelW = 720, panelH = H - 40;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = "#4a6a30";
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    // ── Header ───────────────────────────────────────────────
    ctx.fillStyle = "rgba(30,50,20,0.9)";
    ctx.fillRect(panelX, panelY, panelW, 70);
    ctx.strokeStyle = "#4a8a30";
    ctx.lineWidth = 1;
    ctx.strokeRect(panelX, panelY, panelW, 70);
    this.canvas.drawTextShadow("⚔  TANK BATTLE  ⚔", new Vector2D(cx, 68), "#c8d860", "#80c040", "bold 32px monospace", "center");

    // Divider
    ctx.strokeStyle = "#4a6a30"; ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(cx - 340, 105); ctx.lineTo(cx + 340, 105); ctx.stroke();
    ctx.setLineDash([]);

    // ── Action row: [Create Room]  [Search bar] ──────────────
    // Panel inner width = 680, starting at panelX+20
    const rowY = 118;
    const rowH = 38;
    const innerX = panelX + 20;
    const innerW = panelW - 40; // 680

    // Create Room button — left 220px
    const btnW = 220, btnH = rowH;
    const btnCX = innerX + btnW / 2;
    const btnCY = rowY + btnH / 2;
    this.drawMilButton(btnCX, btnCY, btnW, btnH, "[ + ]  CREATE ROOM", "green");
    this.createRoomButtonArea = { x: innerX, y: rowY, width: btnW, height: btnH };

    // Search bar — remaining right portion with 12px gap
    // Layout: [🔍 icon 28px] [HTML input fills the rest]
    const SEARCH_X = innerX + btnW + 12;
    const SEARCH_W = innerW - btnW - 12;
    const SEARCH_Y = rowY;
    const SEARCH_H = rowH;
    const ICON_W = 30; // width reserved for the 🔍 icon on canvas
    ctx.fillStyle = "rgba(8,18,6,0.85)";
    ctx.fillRect(SEARCH_X, SEARCH_Y, SEARCH_W, SEARCH_H);
    ctx.strokeStyle = this.searchQuery ? "#44aa33" : "#2a4a20";
    ctx.lineWidth = 1;
    ctx.strokeRect(SEARCH_X, SEARCH_Y, SEARCH_W, SEARCH_H);
    // Draw 🔍 icon inside the left portion (canvas side, no HTML input here)
    this.canvas.drawText("🔍", new Vector2D(SEARCH_X + 8, SEARCH_Y + 25), "#4a7a40", "14px monospace");
    if (this.searchInput) {
      this.searchInput.style.display = "block";
      this.positionSearchInput(SEARCH_X + ICON_W, SEARCH_Y, SEARCH_W - ICON_W, SEARCH_H);
    }

    // Section label
    const filteredRooms = this.rooms.filter(r =>
      !this.searchQuery ||
      r.id.toLowerCase().includes(this.searchQuery) ||
      r.name.toLowerCase().includes(this.searchQuery)
    );
    const labelStr = this.searchQuery
      ? `─── ${filteredRooms.length} RESULT${filteredRooms.length !== 1 ? "S" : ""} ───`
      : `─── ACTIVE ROOMS (${this.rooms.length}) ───`;
    this.canvas.drawText(labelStr, new Vector2D(cx, 178), "#6a8a50", "13px monospace", "center");

    // ── Scrollable room list ─────────────────────────────────
    const roomW = 680, roomH = 58;
    const roomX = cx - roomW / 2;
    const listTop = 186;
    const listBottom = H - 55; // leave room for footer
    const listHeight = listBottom - listTop;

    // Clipping region — rooms don't draw outside the panel list area
    ctx.save();
    ctx.beginPath();
    ctx.rect(roomX - 5, listTop, roomW + 10, listHeight);
    ctx.clip();

    let yOff = listTop - this.lobbyScrollOffset;

    if (filteredRooms.length === 0) {
      const msg = this.searchQuery ? "No rooms match your search." : "No rooms. Be the first to create one!";
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fillRect(roomX, yOff, roomW, 70);
      this.canvas.drawText(msg, new Vector2D(cx, yOff + 44), "#445534", "15px monospace", "center");
    }

    filteredRooms.forEach((room) => {
      const isFull = room.playerCount >= room.maxPlayers;
      const rowBottom = yOff + roomH;

      // Only register click areas for visible rows
      const visible = rowBottom > listTop && yOff < listBottom;

      // Row bg
      ctx.fillStyle = isFull ? "rgba(60,20,20,0.5)" : "rgba(20,40,15,0.5)";
      ctx.fillRect(roomX, yOff, roomW, roomH);
      ctx.strokeStyle = isFull ? "#3a1818" : "#1e3e18";
      ctx.lineWidth = 1;
      ctx.strokeRect(roomX, yOff, roomW, roomH);

      // Status dot
      ctx.fillStyle = isFull ? "#aa3333" : "#44aa33";
      ctx.beginPath();
      ctx.arc(roomX + 20, yOff + roomH / 2, 6, 0, Math.PI * 2);
      ctx.fill();

      // Room name
      this.canvas.drawText(room.name, new Vector2D(roomX + 38, yOff + 22), isFull ? "#886666" : "#b8d090", "bold 15px monospace");

      // Short room ID chip — click to copy
      const shortId = room.id.substring(0, 8) + "…";
      const chipX = roomX + 38, chipY = yOff + 30, chipW = 110, chipH = 18;
      ctx.fillStyle = "rgba(40,70,30,0.7)";
      ctx.fillRect(chipX, chipY, chipW, chipH);
      ctx.strokeStyle = "#2a4a20";
      ctx.lineWidth = 1;
      ctx.strokeRect(chipX, chipY, chipW, chipH);
      this.canvas.drawText("📋 " + shortId, new Vector2D(chipX + 5, chipY + 14), "#5a8a50", "11px monospace");
      if (visible) {
        this.copyIdAreas[room.id] = { x: chipX, y: chipY, width: chipW, height: chipH };
      }

      // Player count
      this.canvas.drawText(`${room.playerCount}/${room.maxPlayers} TANKS`, new Vector2D(roomX + 165, yOff + 44), isFull ? "#665555" : "#7a9a60", "12px monospace");

      // Join button / FULL badge
      if (!isFull && visible) {
        const jx = roomX + roomW - 114, jy = yOff + 9, jw = 104, jh = 38;
        this.canvas.drawRoundRect(new Vector2D(jx, jy), jw, jh, 4, "#1e4818", "#44aa33", 2);
        this.canvas.drawText("JOIN ▶", new Vector2D(jx + jw / 2, jy + 25), "#a0e080", "bold 15px monospace", "center");
        this.roomListClickableAreas[room.id] = { x: jx, y: jy, width: jw, height: jh };
      } else if (isFull) {
        this.canvas.drawText("FULL", new Vector2D(roomX + roomW - 60, yOff + roomH / 2 + 6), "#aa4444", "bold 13px monospace", "center");
      }

      yOff += roomH + 6;
    });

    // ── Scroll indicator ─────────────────────────────────────
    const totalContentH = filteredRooms.length * (roomH + 6);
    if (totalContentH > listHeight) {
      const trackH = listHeight;
      const thumbH = Math.max(30, (listHeight / totalContentH) * trackH);
      const thumbY = listTop + (this.lobbyScrollOffset / (totalContentH - listHeight)) * (trackH - thumbH);
      const trackX = roomX + roomW + 6;
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(trackX, listTop, 6, trackH);
      ctx.fillStyle = "#3a6a28";
      ctx.fillRect(trackX, thumbY, 6, thumbH);
      // Clamp scroll
      const maxScroll = Math.max(0, totalContentH - listHeight);
      this.lobbyScrollOffset = Math.min(this.lobbyScrollOffset, maxScroll);
    }

    ctx.restore(); // end clip

    // ── Copy toast ───────────────────────────────────────────
    if (this.copyToast && Date.now() < this.copyToast.expiry) {
      const fade = (this.copyToast.expiry - Date.now()) / 2000;
      ctx.fillStyle = `rgba(20,60,15,${0.9 * fade})`;
      ctx.fillRect(cx - 100, H - 80, 200, 32);
      ctx.strokeStyle = `rgba(60,160,40,${fade})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 100, H - 80, 200, 32);
      this.canvas.drawText(this.copyToast.text, new Vector2D(cx, H - 58), `rgba(140,220,100,${fade})`, "14px monospace", "center");
    }

    // ── Footer ───────────────────────────────────────────────
    this.canvas.drawText("WASD: Move  |  Mouse: Aim  |  Click: Shoot  |  Scroll: Browse rooms",
      new Vector2D(cx, H - 28), "#3a4a2a", "12px monospace", "center");
  }

  // --- IN-GAME DRAWING ---

  private drawPlayers() {
    this.players.forEach((player) => {
      const isMe = player.id === this.myPlayerId;
      const cx = player.getPosition().x + player.getWidth() / 2;
      const cy = player.getPosition().y + player.getHeight() / 2;

      // Aim angle — my tank tracks mouse, enemy points right by default
      let aimAngle = 0;
      if (isMe && this.mousePosition) {
        aimAngle = Math.atan2(
          this.mousePosition.y - cy,
          this.mousePosition.x - cx
        );
      }

      this.canvas.drawTank(cx, cy, aimAngle, isMe, player.getColor());

      // Health bar (above tank)
      const barW = 50;
      const barH = 6;
      const bx = cx - barW / 2;
      const by = cy - 40;
      const hpRatio = player.getCurrentHP() / player.getMaxHP();
      const barColor = hpRatio > 0.5 ? "#44cc44" : hpRatio > 0.25 ? "#ccaa22" : "#cc2222";

      this.canvas.drawRect(new Vector2D(bx, by), barW, barH, "#1a1a1a");
      this.canvas.drawRect(new Vector2D(bx, by), barW * hpRatio, barH, barColor);
      this.canvas.drawStroke(new Vector2D(bx, by), barW, barH, "#444");

      // Label
      const label = isMe ? "YOU" : player.id.substring(0, 6);
      const labelColor = isMe ? "#c8d860" : "#e06060";
      this.canvas.drawTextShadow(
        label,
        new Vector2D(cx, by - 4),
        labelColor,
        isMe ? "#406020" : "#601010",
        "bold 12px monospace",
        "center"
      );

      // Aiming laser — only for me
      if (isMe && this.mousePosition && this.roomState === "in_progress") {
        const dir = new Vector2D(
          this.mousePosition.x - cx,
          this.mousePosition.y - cy
        ).normalize();
        const start = new Vector2D(cx + dir.x * 30, cy + dir.y * 30);
        const end = new Vector2D(cx + dir.x * 80, cy + dir.y * 80);
        const ctx = this.canvas.getCtx();
        ctx.save();
        ctx.strokeStyle = "rgba(255,50,50,0.6)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    });
  }

  private drawBullets() {
    this.bullets.forEach((bullet) => {
      const p = bullet.getPosition();
      this.canvas.drawBullet(p.x, p.y, bullet.getRadius(), bullet.getWallCollideTime() >= 1);
    });
  }

  private drawInGameUI() {
    if (!this.myPlayerId) return;
    const me = this.players.get(this.myPlayerId);
    const ctx = this.canvas.getCtx();
    const W = this.canvas.getWidth();
    const H = this.canvas.getHeight();
    const cx = W / 2;

    // Copy toast (shared with lobby)
    if (this.copyToast && Date.now() < this.copyToast.expiry) {
      const fade = (this.copyToast.expiry - Date.now()) / 2000;
      ctx.fillStyle = `rgba(20,60,15,${0.9 * fade})`;
      ctx.fillRect(cx - 100, H - 80, 200, 32);
      ctx.strokeStyle = `rgba(60,160,40,${fade})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 100, H - 80, 200, 32);
      this.canvas.drawText(this.copyToast.text, new Vector2D(cx, H - 58), `rgba(140,220,100,${fade})`, "14px monospace", "center");
    }

    // ── Leave button (top-right) ──────────────────────────────
    const lw = 140, lh = 34;
    const lx = W - lw - 12, ly = 12;
    this.canvas.drawRoundRect(new Vector2D(lx, ly), lw, lh, 4, "#3a1010", "#aa3333", 2);
    this.canvas.drawText("◀ LOBBY", new Vector2D(lx + lw / 2, ly + 23), "#e08080", "bold 14px monospace", "center");
    this.leaveRoomButtonArea = { x: lx, y: ly, width: lw, height: lh };

    if (!me) return;

    // ── HUD panel (top-left) ──────────────────────────────────
    const panelW = 170, panelH = 70;
    ctx.fillStyle = "rgba(10,20,8,0.8)";
    ctx.fillRect(10, 10, panelW, panelH);
    ctx.strokeStyle = "#2a5a20";
    ctx.lineWidth = 1;
    ctx.strokeRect(10, 10, panelW, panelH);

    // HP bar
    const hp = me.getCurrentHP(), maxHp = me.getMaxHP();
    const hpRatio = hp / maxHp;
    const hpColor = hpRatio > 0.5 ? "#44cc44" : hpRatio > 0.25 ? "#ccaa22" : "#cc2222";
    this.canvas.drawText("HP", new Vector2D(18, 30), "#7a9a60", "12px monospace");
    this.canvas.drawRect(new Vector2D(42, 18), 130, 14, "#111");
    this.canvas.drawRect(new Vector2D(42, 18), 130 * hpRatio, 14, hpColor);
    this.canvas.drawStroke(new Vector2D(42, 18), 130, 14, "#333");
    this.canvas.drawText(`${hp}/${maxHp}`, new Vector2D(107, 30), "#ccc", "11px monospace", "center");

    // Cooldown bar
    const cd = me.getShootingCoolDownTime();
    const cdRatio = Math.max(0, cd / this.shootCooldownMax);
    const cdReady = cd <= 0;
    this.canvas.drawText("GUN", new Vector2D(18, 55), "#7a9a60", "12px monospace");
    this.canvas.drawRect(new Vector2D(42, 43), 130, 14, "#111");
    if (!cdReady) {
      this.canvas.drawRect(new Vector2D(42, 43), 130 * (1 - cdRatio), 14, "#cc8822");
    } else {
      // Pulse green when ready
      const alpha = 0.7 + 0.3 * Math.sin(this.animTime * 6);
      this.canvas.drawRect(new Vector2D(42, 43), 130, 14, `rgba(40,180,40,${alpha})`);
    }
    this.canvas.drawStroke(new Vector2D(42, 43), 130, 14, "#333");
    this.canvas.drawText(
      cdReady ? "READY" : `${cd.toFixed(1)}s`,
      new Vector2D(107, 55),
      cdReady ? "#80ee80" : "#ccaa44",
      "11px monospace",
      "center"
    );
  }

  private drawTimer() {
    const secs = Math.ceil(this.timeRemaining);
    const urgent = secs <= 10;
    const cx = this.canvas.getWidth() / 2;

    const ctx = this.canvas.getCtx();
    // Background pill
    ctx.fillStyle = urgent ? "rgba(80,10,10,0.85)" : "rgba(10,20,8,0.75)";
    ctx.fillRect(cx - 50, 8, 100, 34);
    ctx.strokeStyle = urgent ? "#cc2222" : "#2a5a20";
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - 50, 8, 100, 34);

    const pulse = urgent ? 0.8 + 0.2 * Math.sin(this.animTime * 8) : 1;
    const color = urgent ? `rgba(255,${Math.floor(80 * pulse)},${Math.floor(80 * pulse)},1)` : "#c8d860";
    this.canvas.drawText(
      `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`,
      new Vector2D(cx, 33),
      color,
      `bold 20px monospace`,
      "center"
    );
  }

  private drawWaitingScreen() {
    const ctx = this.canvas.getCtx();
    const cx = this.canvas.getWidth() / 2;
    const cy = this.canvas.getHeight() / 2;
    this._waitingCopyArea = null;

    this.drawPlayers();

    // Semi-transparent overlay
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(cx - 280, cy - 70, 560, 140);
    ctx.strokeStyle = "#2a5a20";
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - 280, cy - 70, 560, 140);

    if (this.players.size < 2) {
      // Spinning dots animation
      const dots = Math.floor(this.animTime * 2) % 4;
      this.canvas.drawTextShadow(
        "WAITING FOR OPPONENT" + ".".repeat(dots),
        new Vector2D(cx, cy - 10),
        "#c8d860",
        "#406020",
        "bold 22px monospace",
        "center"
      );
      // Show room ID chip — click to copy and send to friend
      if (this.currentRoomId) {
        const ctx = this.canvas.getCtx();
        const shortId = this.currentRoomId.substring(0, 8) + "…";
        const chipW = 270, chipH = 24;
        const chipX = cx - chipW / 2, chipY = cy + 18;
        ctx.fillStyle = "rgba(30,60,20,0.85)";
        ctx.fillRect(chipX, chipY, chipW, chipH);
        ctx.strokeStyle = "#3a7a28";
        ctx.lineWidth = 1;
        ctx.strokeRect(chipX, chipY, chipW, chipH);
        this.canvas.drawText(
          `📋 Room ID: ${shortId}  (click to copy)`,
          new Vector2D(cx, chipY + 17),
          "#7aaa50",
          "12px monospace",
          "center"
        );
        // Register click area
        this._waitingCopyArea = { x: chipX, y: chipY, width: chipW, height: chipH };
      }
    } else if (this.amIReady) {
      this.canvas.drawTextShadow(
        "READY — WAITING FOR ENEMY",
        new Vector2D(cx, cy - 10),
        "#c8d860",
        "#406020",
        "bold 22px monospace",
        "center"
      );
      this.canvas.drawText("Enemy is preparing...", new Vector2D(cx, cy + 30), "#557744", "15px monospace", "center");
    } else {
      this.canvas.drawTextShadow(
        "CLICK TO READY UP",
        new Vector2D(cx, cy - 10),
        "#80ee80",
        "#206010",
        `bold ${22 + 2 * Math.sin(this.animTime * 3)}px monospace`,
        "center"
      );
      this.canvas.drawText("Both players must be ready to start", new Vector2D(cx, cy + 30), "#557744", "15px monospace", "center");
    }
  }

  private drawGameOver() {
    const ctx = this.canvas.getCtx();
    const cx = this.canvas.getWidth() / 2;
    const cy = this.canvas.getHeight() / 2;

    this.drawPlayers();

    // Overlay
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(cx - 300, cy - 100, 600, 200);
    ctx.strokeStyle = "#aa2222";
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - 300, cy - 100, 600, 200);

    const isWin = this.winnerId === this.myPlayerId;
    const isDraw = !this.winnerId;

    const headline = isDraw ? "DRAW!" : isWin ? "VICTORY!" : "DEFEATED";
    const headlineColor = isDraw ? "#c8c840" : isWin ? "#60ee60" : "#ee4444";
    const glowColor = isDraw ? "#808010" : isWin ? "#206020" : "#601010";

    this.canvas.drawTextShadow(
      headline,
      new Vector2D(cx, cy - 28),
      headlineColor,
      glowColor,
      "bold 52px monospace",
      "center"
    );

    this.canvas.drawText(
      isDraw ? "No winner this round" : isWin ? "Enemy tank destroyed!" : "Your tank was destroyed",
      new Vector2D(cx, cy + 18),
      "#aaa",
      "16px monospace",
      "center"
    );

    // Pulsing restart prompt
    const alpha = 0.6 + 0.4 * Math.sin(this.animTime * 3);
    this.canvas.drawText(
      "[ CLICK TO REMATCH ]",
      new Vector2D(cx, cy + 60),
      `rgba(180,220,120,${alpha})`,
      "bold 18px monospace",
      "center"
    );
  }

  private drawInGameContent() {
    switch (this.roomState) {
      case "waiting":
        this.drawWaitingScreen();
        this.drawInGameUI();
        break;

      case "in_progress":
        this.drawPlayers();
        this.drawBullets();
        this.drawInGameUI();
        this.drawTimer();
        break;

      case "game_over":
        this.drawGameOver();
        this.drawInGameUI();
        break;
    }
  }

  // --- MAIN LOOP ---

  public gameLoop() {
    this.animTime += 0.016; // ~60fps delta

    this.canvas.initCanvas();
    const cx = this.canvas.getWidth() / 2;
    const cy = this.canvas.getHeight() / 2;

    // Hide HTML search input when not in lobby
    if (this.clientState !== "lobby" && this.searchInput) {
      this.searchInput.style.display = "none";
      this.searchQuery = "";
      if (this.searchInput) this.searchInput.value = "";
      this.lobbyScrollOffset = 0;
    }

    switch (this.clientState) {
      case "connecting":
        this.drawConnecting(cx, cy);
        break;
      case "lobby":
        this.drawLobby();
        break;
      case "in_game":
        this.drawInGameContent();
        break;
      case "disconnected":
        this.drawDisconnected(cx, cy);
        break;
    }

    requestAnimationFrame(() => this.gameLoop());
  }

  private drawConnecting(cx: number, cy: number) {
    const dots = ".".repeat(Math.floor(this.animTime * 2) % 4);
    this.canvas.drawTextShadow(
      "CONNECTING" + dots,
      new Vector2D(cx, cy),
      "#c8d860",
      "#406020",
      "bold 28px monospace",
      "center"
    );
  }

  private drawDisconnected(cx: number, cy: number) {
    this.canvas.drawTextShadow(
      "CONNECTION LOST",
      new Vector2D(cx, cy - 20),
      "#ee4444",
      "#601010",
      "bold 32px monospace",
      "center"
    );
    this.canvas.drawText(
      "Refresh the page to reconnect",
      new Vector2D(cx, cy + 20),
      "#886666",
      "18px monospace",
      "center"
    );
  }

  public startGame() {
    requestAnimationFrame(() => this.gameLoop());
  }
}
