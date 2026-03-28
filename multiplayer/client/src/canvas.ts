import { Vector2D } from "./vector2d.js";

export class Canvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private bgCanvas: HTMLCanvasElement | null = null;

  constructor() {
    const canvasElement = document.getElementById(
      "canvas"
    ) as HTMLCanvasElement | null;
    if (!canvasElement) {
      throw new Error("Canvas element with ID 'canvas' not found.");
    }
    this.canvas = canvasElement;

    const context = this.canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to get 2D rendering context from canvas.");
    }
    this.ctx = context;

    this.width = 1300;
    this.height = 650;
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    // Create offscreen canvas for background caching
    this._initBackgroundCache();
  }

  private _initBackgroundCache() {
    this.bgCanvas = document.createElement("canvas");
    this.bgCanvas.width = this.width;
    this.bgCanvas.height = this.height;
    const bgCtx = this.bgCanvas.getContext("2d");
    if (!bgCtx) return;
    // Draw static background once to offscreen canvas
    this._drawBackground(bgCtx);
  }

  // Dark military desert background - now draws cached background
  initCanvas() {
    if (this.bgCanvas) {
      // Draw cached background - much faster than redrawing everything
      this.ctx.drawImage(this.bgCanvas, 0, 0);
      return;
    }
    // Fallback if cache not available
    this._drawBackground(this.ctx);
  }

  // Draw static background to any context
  private _drawBackground(ctx: CanvasRenderingContext2D) {
    // Base ground — sandy dark
    ctx.fillStyle = "#2a2010";
    ctx.fillRect(0, 0, this.width, this.height);

    // Subtle grid lines (tactical map feel)
    ctx.strokeStyle = "rgba(80, 70, 30, 0.35)";
    ctx.lineWidth = 1;
    const gridSize = 65;
    for (let x = 0; x <= this.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }
    for (let y = 0; y <= this.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }

    // Corner blast marks
    this._drawBlastMark(ctx, 60, 60, 40);
    this._drawBlastMark(ctx, this.width - 60, 60, 35);
    this._drawBlastMark(ctx, 60, this.height - 60, 38);
    this._drawBlastMark(ctx, this.width - 60, this.height - 60, 42);

    // Wall border — concrete slabs
    this._drawWallBorder(ctx);
  }

  private _drawBlastMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, "rgba(10,8,4,0.7)");
    grad.addColorStop(0.5, "rgba(40,30,10,0.4)");
    grad.addColorStop(1, "rgba(40,30,10,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // cracks
    ctx.strokeStyle = "rgba(10,8,4,0.5)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const len = r * 0.6 + Math.random() * r * 0.4;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
      ctx.stroke();
    }
  }

  private _drawWallBorder(ctx: CanvasRenderingContext2D) {
    const t = 18; // wall thickness
    const slabW = 52;
    const slabH = t;

    const drawSlab = (x: number, y: number, w: number, h: number) => {
      ctx.fillStyle = "#3d3a32";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#4a4640";
      ctx.fillRect(x + 1, y + 1, w - 2, 4);
      ctx.fillStyle = "#2a2820";
      ctx.fillRect(x + 1, y + h - 3, w - 2, 2);
      ctx.strokeStyle = "#1a1810";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
    };

    // Top & bottom rows
    for (let x = 0; x < this.width; x += slabW) {
      drawSlab(x, 0, slabW - 1, slabH);
      drawSlab(x, this.height - slabH, slabW - 1, slabH);
    }
    // Left & right columns (skip corners already drawn)
    for (let y = slabH; y < this.height - slabH; y += slabW) {
      drawSlab(0, y, slabH, slabW - 1);
      drawSlab(this.width - slabH, y, slabH, slabW - 1);
    }
  }

  // ── Primitives ──────────────────────────────────────────────

  drawRect(position: Vector2D, width: number, height: number, color: string) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(position.x, position.y, width, height);
  }

  drawRoundRect(
    position: Vector2D,
    width: number,
    height: number,
    radius: number,
    color: string,
    strokeColor?: string,
    strokeWidth: number = 2
  ) {
    const ctx = this.ctx;
    const x = position.x,
      y = position.y;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.arcTo(x + width, y, x + width, y + radius, radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
    ctx.lineTo(x + radius, y + height);
    ctx.arcTo(x, y + height, x, y + height - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }
  }

  drawCircle(position: Vector2D, radius: number, color: string) {
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
    this.ctx.fill();
  }

  drawCircleStroke(
    position: Vector2D,
    radius: number,
    color: string,
    lineWidth: number = 2
  ) {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = lineWidth;
    this.ctx.beginPath();
    this.ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  drawStroke(position: Vector2D, width: number, height: number, color: string) {
    this.ctx.strokeStyle = color;
    this.ctx.strokeRect(position.x, position.y, width, height);
  }

  drawText(
    text: string,
    position: Vector2D,
    color: string,
    font: string = "20px monospace",
    textAlign: CanvasTextAlign = "left"
  ) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = textAlign;
    ctx.fillText(text, position.x, position.y);
    ctx.textAlign = "left";
  }

  drawTextShadow(
    text: string,
    position: Vector2D,
    color: string,
    shadowColor: string,
    font: string = "20px monospace",
    textAlign: CanvasTextAlign = "left"
  ) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = font;
    ctx.textAlign = textAlign;
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    ctx.fillText(text, position.x, position.y);
    ctx.restore();
  }

  drawLine(
    startPos: Vector2D,
    endPos: Vector2D,
    color: string,
    lineWidth: number = 1
  ) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(startPos.x, startPos.y);
    ctx.lineTo(endPos.x, endPos.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  // Draw a tank — body + turret + barrel, rotated toward aimAngle
  drawTank(
    cx: number,
    cy: number,
    aimAngle: number,
    isMe: boolean,
    color: string
  ) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(cx, cy);

    // ── Tracks (drawn first, behind body) ────────────────────
    const trackColor = isMe ? "#5a4a20" : "#4a1a1a";
    const trackW = 48;
    const trackH = 14;
    const trackOffY = 18;

    for (const side of [-1, 1]) {
      const ty = side * trackOffY - trackH / 2;
      // Track base
      ctx.fillStyle = trackColor;
      this._roundRectPath(-trackW / 2, ty, trackW, trackH, 4);
      ctx.fill();
      // Track segments
      ctx.strokeStyle = isMe ? "#7a6a30" : "#6a2a2a";
      ctx.lineWidth = 1;
      const segCount = 7;
      for (let i = 0; i <= segCount; i++) {
        const sx = -trackW / 2 + (i / segCount) * trackW;
        ctx.beginPath();
        ctx.moveTo(sx, ty + 1);
        ctx.lineTo(sx, ty + trackH - 1);
        ctx.stroke();
      }
      // Track outline
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 1.5;
      this._roundRectPath(-trackW / 2, ty, trackW, trackH, 4);
      ctx.stroke();
    }

    // ── Body ─────────────────────────────────────────────────
    const bodyW = 44;
    const bodyH = 32;
    const bodyColor = isMe ? "#8b7a35" : "#7a2525";
    const bodyHighlight = isMe ? "#a8944a" : "#943030";
    const bodyDark = isMe ? "#5a5020" : "#4a1515";

    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    this._roundRectPath(-bodyW / 2 + 2, -bodyH / 2 + 2, bodyW, bodyH, 6);
    ctx.fill();

    // Body fill
    ctx.fillStyle = bodyColor;
    this._roundRectPath(-bodyW / 2, -bodyH / 2, bodyW, bodyH, 6);
    ctx.fill();

    // Top highlight stripe
    ctx.fillStyle = bodyHighlight;
    ctx.fillRect(-bodyW / 2 + 4, -bodyH / 2 + 3, bodyW - 8, 5);

    // Bottom shadow stripe
    ctx.fillStyle = bodyDark;
    ctx.fillRect(-bodyW / 2 + 4, bodyH / 2 - 6, bodyW - 8, 4);

    // Body outline
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    this._roundRectPath(-bodyW / 2, -bodyH / 2, bodyW, bodyH, 6);
    ctx.stroke();

    // ── Turret ───────────────────────────────────────────────
    ctx.save();
    ctx.rotate(aimAngle);

    const turretR = 12;
    const turretColor = isMe ? "#6b5e28" : "#5e1e1e";

    // Barrel
    const barrelLen = 26;
    const barrelW = 6;
    ctx.fillStyle = isMe ? "#4a3e18" : "#3e1010";
    ctx.beginPath();
    ctx.rect(2, -barrelW / 2, barrelLen, barrelW);
    ctx.fill();
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Barrel tip ring
    ctx.fillStyle = "#222";
    ctx.fillRect(barrelLen + 2, -barrelW / 2 - 1, 5, barrelW + 2);

    // Turret circle
    ctx.fillStyle = turretColor;
    ctx.beginPath();
    ctx.arc(0, 0, turretR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.stroke();
    // Turret dome highlight
    ctx.fillStyle = isMe ? "rgba(200,180,80,0.25)" : "rgba(200,60,60,0.25)";
    ctx.beginPath();
    ctx.arc(-2, -3, turretR * 0.55, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // ── Star/skull marker on body ─────────────────────────────
    if (isMe) {
      ctx.fillStyle = "rgba(255,220,50,0.9)";
      this._drawStar(ctx, 0, 0, 5, 5, 2.5);
    } else {
      // enemy: two red cross bars
      ctx.fillStyle = "rgba(220,40,40,0.9)";
      ctx.fillRect(-7, -2, 14, 3);
      ctx.fillRect(-2, -7, 3, 14);
    }

    ctx.restore();
  }

  private _drawStar(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    points: number,
    outerR: number,
    innerR: number
  ) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const angle = (i * Math.PI) / points - Math.PI / 2;
      if (i === 0) ctx.moveTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
      else ctx.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    }
    ctx.closePath();
    ctx.fill();
  }

  private _roundRectPath(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // Draw bullet — glowing shell
  drawBullet(cx: number, cy: number, radius: number, activated: boolean) {
    const ctx = this.ctx;
    ctx.save();

    if (activated) {
      // Hot bounced shell — red/orange glow
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 3);
      grad.addColorStop(0, "rgba(255,100,0,0.6)");
      grad.addColorStop(1, "rgba(255,50,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ff6a00";
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ffcc00";
      ctx.beginPath();
      ctx.arc(cx - radius * 0.3, cy - radius * 0.3, radius * 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Normal shell — silver
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 2);
      grad.addColorStop(0, "rgba(200,200,200,0.3)");
      grad.addColorStop(1, "rgba(200,200,200,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#cccccc";
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(cx - radius * 0.3, cy - radius * 0.3, radius * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  getCanvas() {
    return this.canvas;
  }

  getWidth() {
    return this.width;
  }

  getHeight() {
    return this.height;
  }

  getCtx() {
    return this.ctx;
  }
}
