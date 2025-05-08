// Your existing Canvas class, make sure it's exportable
import { Vector2D } from "./vector2d.js";

export class Canvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;

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

    // Set initial dimensions (should match server constants)
    this.width = 1300;
    this.height = 650;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  initCanvas() {
    if (this.ctx) {
      this.ctx.fillStyle = "gray"; // Or a darker background for space feel
      this.ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  drawRect(position: Vector2D, width: number, height: number, color: string) {
    if (this.ctx) {
      this.ctx.fillStyle = color;
      this.ctx.fillRect(position.x, position.y, width, height);
    }
  }

  drawCircle(position: Vector2D, radius: number, color: string) {
    if (this.ctx) {
      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  drawStroke(position: Vector2D, width: number, height: number, color: string) {
    if (this.ctx) {
      this.ctx.strokeStyle = color;
      this.ctx.strokeRect(position.x, position.y, width, height);
    }
  }

  drawText(
    text: string,
    position: Vector2D,
    color: string,
    font: string = "20px Arial",
    textAlign: CanvasTextAlign = "left"
  ) {
    if (this.ctx) {
      this.ctx.fillStyle = color;
      this.ctx.font = font;
      this.ctx.textAlign = textAlign;
      this.ctx.fillText(text, position.x, position.y);
      this.ctx.textAlign = "left"; // Reset to default
    }
  }

  drawLine(
    startPos: Vector2D,
    endPos: Vector2D,
    color: string,
    lineWidth: number = 1
  ) {
    if (this.ctx) {
      this.ctx.beginPath();
      this.ctx.moveTo(startPos.x, startPos.y);
      this.ctx.lineTo(endPos.x, endPos.y);
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = lineWidth;
      this.ctx.stroke();
    }
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
}
