export class Canvas {
    constructor() {
        const canvasElement = document.getElementById("canvas");
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
    drawRect(position, width, height, color) {
        if (this.ctx) {
            this.ctx.fillStyle = color;
            this.ctx.fillRect(position.x, position.y, width, height);
        }
    }
    drawCircle(position, radius, color) {
        if (this.ctx) {
            this.ctx.fillStyle = color;
            this.ctx.beginPath();
            this.ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }
    drawStroke(position, width, height, color) {
        if (this.ctx) {
            this.ctx.strokeStyle = color;
            this.ctx.strokeRect(position.x, position.y, width, height);
        }
    }
    drawText(text, position, color, font = "20px Arial", textAlign = "left") {
        if (this.ctx) {
            this.ctx.fillStyle = color;
            this.ctx.font = font;
            this.ctx.textAlign = textAlign;
            this.ctx.fillText(text, position.x, position.y);
            this.ctx.textAlign = "left"; // Reset to default
        }
    }
    drawLine(startPos, endPos, color, lineWidth = 1) {
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
