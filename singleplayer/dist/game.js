"use strict";
class Vector2D {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    add(other) {
        return new Vector2D(this.x + other.x, this.y + other.y);
    }
    multiply(scalar) {
        return new Vector2D(this.x * scalar, this.y * scalar);
    }
    magnitude() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }
    normalize() {
        const mag = this.magnitude();
        return mag > 0
            ? new Vector2D(this.x / mag, this.y / mag)
            : new Vector2D(0, 0);
    }
}
// Canvas class
class Canvas {
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
        // Set initial dimensions to window size
        this.width = 1300;
        this.height = 650;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
    }
    initCanvas() {
        if (this.ctx) {
            this.ctx.fillStyle = "gray";
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
            this.ctx.textAlign = "left";
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
class Bullet {
    constructor(position, direction) {
        this.position = position;
        this.timesCollidedWall = 0;
        this.direction = direction;
        this.radius = 5;
    }
    getPosition() {
        return this.position;
    }
    getRadius() {
        return this.radius;
    }
    update(deltaTime, canvasWidth, canvasHeight) {
        // This function is called every frame
        const speed = 1000;
        this.position = new Vector2D(this.position.x + speed * this.direction.x * deltaTime, this.position.y + speed * this.direction.y * deltaTime);
        // Boundary check and reflection
        if (
        // Check if collide left and right
        this.position.x - this.radius < 0 ||
            this.position.x + this.radius > canvasWidth) {
            this.timesCollidedWall += 1;
            this.direction = new Vector2D(-this.direction.x, this.direction.y);
        }
        if (
        // Check if collide top and bot
        this.position.y - this.radius < 0 ||
            this.position.y + this.radius > canvasHeight) {
            this.timesCollidedWall += 1;
            this.direction = new Vector2D(this.direction.x, -this.direction.y);
        }
    }
    getWallCollideTime() {
        return this.timesCollidedWall;
    }
}
class Player {
    constructor(position) {
        this.id = Math.random() * 1000;
        this.currentHP = 10;
        this.maxHP = 10;
        this.position = position;
        this.currentVelocity = new Vector2D(0, 0);
        this.maxVelocity = 400;
        this.acceleration = 1000;
        this.friction = 0.95;
        this.input = new Vector2D(0, 0);
        this.width = 50;
        this.height = 50;
        this.color = "blue";
        this.shootingCoolDownTime = 0;
    }
    getPosition() {
        return this.position;
    }
    getWidth() {
        return this.width;
    }
    getHeight() {
        return this.height;
    }
    setInput(direction) {
        this.input = direction;
    }
    reduceHP(amount) {
        this.currentHP -= amount;
        // this.color = "green";
        if (this.currentHP < 0)
            this.currentHP = 0;
    }
    getCurrentHP() {
        return this.currentHP;
    }
    getMaxHP() {
        return this.maxHP;
    }
    getColor() {
        return this.color;
    }
    update(deltaTime, canvasWidth, canvasHeight) {
        // This function is called every frame
        // -------------------------------------
        // Normalize input if it exists
        if (this.input.magnitude() > 0) {
            const normalizedInput = this.input.normalize();
            // Apply acceleration
            const acceleration = normalizedInput.multiply(this.acceleration * deltaTime);
            this.currentVelocity = new Vector2D(this.currentVelocity.x + acceleration.x, this.currentVelocity.y + acceleration.y);
            // Limit to max velocity
            const currentSpeed = this.currentVelocity.magnitude();
            if (currentSpeed > this.maxVelocity) {
                const normalized = this.currentVelocity.normalize();
                this.currentVelocity = new Vector2D(normalized.x * this.maxVelocity, normalized.y * this.maxVelocity);
            }
        }
        else {
            // Apply friction when no input
            this.currentVelocity = new Vector2D(this.currentVelocity.x * this.friction, this.currentVelocity.y * this.friction);
            // Stop completely if very slow
            if (this.currentVelocity.magnitude() < 0.1) {
                this.currentVelocity = new Vector2D(0, 0);
            }
        }
        // Update position
        this.position = new Vector2D(this.position.x + this.currentVelocity.x * deltaTime, this.position.y + this.currentVelocity.y * deltaTime);
        // Boundary check
        if (this.position.x < 0)
            this.position.x = 0;
        if (this.position.y < 0)
            this.position.y = 0;
        if (this.position.x + this.width > canvasWidth)
            this.position.x = canvasWidth - this.width;
        if (this.position.y + this.height > canvasHeight)
            this.position.y = canvasHeight - this.height;
    }
    getShootingCoolDownTime() {
        return this.shootingCoolDownTime;
    }
    reduceShootingCoolDownTime(time) {
        if (this.shootingCoolDownTime - time < 0)
            this.shootingCoolDownTime = 0;
        else
            this.shootingCoolDownTime -= time;
    }
    shoot(mousePosition) {
        if (this.shootingCoolDownTime > 0) {
            return null;
        }
        const playerCenter = new Vector2D(this.position.x + this.width / 2, this.position.y + this.height / 2);
        const direction = mousePosition
            .add(new Vector2D(-playerCenter.x, -playerCenter.y))
            .normalize();
        const bullet = new Bullet(playerCenter, direction);
        this.shootingCoolDownTime = 2; // 2 seconds cooldown for shooting a bullet
        return bullet;
    }
}
class Enemy {
    constructor() {
        this.position = null;
        this.speed = 0.5;
        this.playerToFollow = null;
        this.maxHP = 10;
        this.currentHP = 10;
        this.width = 30;
        this.height = 30;
        this.color = "green";
    }
    getWidth() {
        return this.width;
    }
    getHeight() {
        return this.height;
    }
    followPlayer(player) {
        this.playerToFollow = player;
    }
    setPosition(pos) {
        this.position = new Vector2D(pos.x, pos.y);
    }
    getPosition() {
        if (this.position)
            return this.position;
    }
    getCurrentHP() {
        return this.currentHP;
    }
    getColor() {
        return this.color;
    }
    getMaxHP() {
        return this.maxHP;
    }
    reduceHP(amount) {
        this.currentHP -= amount;
        if (this.currentHP <= 0)
            this.currentHP = 0;
    }
    update() {
        if (this.playerToFollow && this.position) {
            const playerPos = this.playerToFollow.getPosition();
            const direction = playerPos
                .add(new Vector2D(-this.position.x, -this.position.y))
                .normalize();
            const speed = this.speed;
            this.position = new Vector2D(this.position.x + direction.x * speed, this.position.y + direction.y * speed);
        }
    }
}
class Game {
    constructor() {
        var _a, _b;
        this.canvas = new Canvas();
        this.canvas.initCanvas();
        this.players = [];
        this.enemies = [];
        this.lastTime = 0;
        this.keysPressed = {};
        this.bullets = [];
        this.score = 0;
        this.gameOver = false;
        this.mousePosition = null;
        this.deltaTime = 0;
        setInterval(() => {
            this.spawnEnemy();
        }, 6000);
        (_a = this.canvas
            .getCanvas()) === null || _a === void 0 ? void 0 : _a.addEventListener("mousemove", (event) => {
            const canvasElement = this.canvas.getCanvas();
            if (canvasElement) {
                const canvasRect = canvasElement.getBoundingClientRect();
                const mouseX = event.clientX - canvasRect.left;
                const mouseY = event.clientY - canvasRect.top;
                this.mousePosition = new Vector2D(mouseX, mouseY);
            }
        });
        window.addEventListener("keydown", (event) => {
            this.keysPressed[event.key.toLowerCase()] = true;
            this.updatePlayerInput();
        });
        window.addEventListener("keyup", (event) => {
            this.keysPressed[event.key.toLowerCase()] = false;
            this.updatePlayerInput();
        });
        (_b = this.canvas.getCanvas()) === null || _b === void 0 ? void 0 : _b.addEventListener("click", (event) => {
            if (this.gameOver) {
                this.restartGame();
                return;
            }
            if (this.players.length === 0)
                return;
            const canvasElement = this.canvas.getCanvas();
            if (canvasElement) {
                const canvasRect = canvasElement.getBoundingClientRect();
                const mouseX = event.clientX - canvasRect.left;
                const mouseY = event.clientY - canvasRect.top;
                const mousePosition = new Vector2D(mouseX, mouseY);
                const newBullet = this.players[0].shoot(mousePosition);
                if (newBullet)
                    this.bullets.push(newBullet);
            }
        });
    }
    updatePlayerInput() {
        if (this.players.length === 0)
            return;
        let x = 0;
        let y = 0;
        if (this.keysPressed["w"])
            y -= 1;
        if (this.keysPressed["s"])
            y += 1;
        if (this.keysPressed["a"])
            x -= 1;
        if (this.keysPressed["d"])
            x += 1;
        this.players[0].setInput(new Vector2D(x, y));
    }
    addPlayer(newPlayer) {
        this.players.push(newPlayer);
        this.spawnEnemy();
    }
    spawnEnemy() {
        const player = this.players[0];
        const minDistance = 500; // Spawn far away from the player
        let newEnemyPosition;
        do {
            newEnemyPosition = new Vector2D(Math.random() * this.canvas.getWidth(), Math.random() * this.canvas.getHeight());
        } while (newEnemyPosition
            .add(new Vector2D(-player.getPosition().x, -player.getPosition().y))
            .magnitude() < minDistance);
        const newEnemy = new Enemy();
        newEnemy.followPlayer(player);
        newEnemy.setPosition(newEnemyPosition);
        this.enemies.push(newEnemy);
    }
    checkCollisionBullet(bullet, target) {
        const bulletLeft = bullet.getPosition().x - bullet.getRadius();
        const bulletRight = bullet.getPosition().x + bullet.getRadius();
        const bulletTop = bullet.getPosition().y - bullet.getRadius();
        const bulletBottom = bullet.getPosition().y + bullet.getRadius();
        const targetPosition = target.getPosition();
        if (!targetPosition)
            return false;
        const targetLeft = targetPosition.x;
        const targetRight = targetPosition.x + target.getWidth();
        const targetTop = targetPosition.y;
        const targetBottom = targetPosition.y + target.getHeight();
        if (target instanceof Player) {
            return (bulletRight > targetLeft &&
                bulletLeft < targetRight &&
                bulletBottom > targetTop &&
                bulletTop < targetBottom &&
                bullet.getWallCollideTime() >= 1);
        }
        else
            return (bulletRight > targetLeft &&
                bulletLeft < targetRight &&
                bulletBottom > targetTop &&
                bulletTop < targetBottom);
    }
    checkCollisionEnemy(enemy, player) {
        const enemyPos = enemy.getPosition();
        if (!enemyPos)
            return false;
        const enemyLeft = enemyPos.x;
        const enemyRight = enemyPos.x + enemy.getWidth();
        const enemyTop = enemyPos.y;
        const enemyBottom = enemyPos.y + enemy.getHeight();
        const playerPos = player.getPosition();
        const playerLeft = playerPos.x;
        const playerRight = playerPos.x + player.getWidth();
        const playerTop = playerPos.y;
        const playerBottom = playerPos.y + player.getHeight();
        return (enemyRight >= playerLeft &&
            enemyLeft <= playerRight &&
            enemyBottom >= playerTop &&
            enemyTop <= playerBottom);
    }
    deleteEnemy(enemy) {
        this.enemies = this.enemies.filter((e) => e !== enemy);
    }
    deleteBullet(bullet) {
        this.bullets = this.bullets.filter((b) => b !== bullet);
    }
    drawUI() {
        const scoreText = "Score: " + this.score.toString();
        const scoreFont = "bold 20px 'Segoe UI', 'Arial', sans-serif";
        const scoreColor = "#FFFFFF";
        const panelPadding = 10;
        const scorePanelPosition = new Vector2D(15, 15);
        const scorePanelHeight = 30;
        const scorePanelWidth = 160;
        this.canvas.drawRect(scorePanelPosition, scorePanelWidth, scorePanelHeight, "rgba(20, 20, 20, 0.75)");
        this.canvas.drawStroke(scorePanelPosition, scorePanelWidth, scorePanelHeight, "rgba(150, 150, 150, 0.4)");
        const textX = scorePanelPosition.x + panelPadding;
        const textY = scorePanelPosition.y + scorePanelHeight / 2 + 7;
        this.canvas.drawText(scoreText, new Vector2D(textX, textY), scoreColor, scoreFont, "left");
        // Cooldown shoot panel
        if (this.players.length > 0) {
            const player = this.players[0];
            const cooldownTime = player.getShootingCoolDownTime();
            const maxCooldown = 2;
            const iconSize = 40;
            const iconPosition = new Vector2D(scorePanelPosition.x, scorePanelPosition.y + scorePanelHeight + panelPadding);
            this.canvas.drawRect(iconPosition, iconSize, iconSize, "dimgray");
            if (cooldownTime > 0) {
                const cooldownFillHeight = (cooldownTime / maxCooldown) * iconSize;
                this.canvas.drawRect(new Vector2D(iconPosition.x, iconPosition.y + (iconSize - cooldownFillHeight)), iconSize, cooldownFillHeight, "rgba(50, 50, 50, 0.85)");
            }
            else {
                this.canvas.drawRect(iconPosition, iconSize, iconSize, "lightgreen");
                this.canvas.drawText("R", new Vector2D(iconPosition.x + iconSize / 2, iconPosition.y + iconSize / 2 + 7), "black", "bold 20px Arial", "center");
            }
            this.canvas.drawStroke(iconPosition, iconSize, iconSize, "white");
            this.canvas.drawText(cooldownTime > 0 ? cooldownTime.toFixed(1) + "s" : "Ready", new Vector2D(iconPosition.x + iconSize + panelPadding / 2, iconPosition.y + iconSize / 2 + 6), cooldownTime > 0 ? "yellow" : "lightgreen", "16px 'Segoe UI', Arial", "left");
        }
        const copyrightText = "Made by ikniz Nguyễn Mỹ Thống";
        const copyrightFont = "12px 'Segoe UI', Arial, sans-serif";
        const copyrightColor = "rgba(255, 255, 255, 0.5)";
        const copyrightX = this.canvas.getWidth() - panelPadding;
        const copyrightY = this.canvas.getHeight() - panelPadding;
        this.canvas.drawText(copyrightText, new Vector2D(copyrightX, copyrightY), copyrightColor, copyrightFont, "right");
    }
    drawPlayer() {
        this.players.forEach((player) => {
            player.update(this.deltaTime, this.canvas.getWidth(), this.canvas.getHeight());
            this.canvas.drawRect(player.getPosition(), player.getWidth(), player.getHeight(), player.getColor());
            // Draw health bar
            const healthBarPos = new Vector2D(player.getPosition().x, player.getPosition().y - 8);
            this.canvas.drawRect(healthBarPos, (player.getWidth() * player.getCurrentHP()) / player.getMaxHP(), 4, "red");
            this.canvas.drawStroke(healthBarPos, (player.getWidth() * player.getCurrentHP()) / player.getMaxHP(), 5, "white");
            // Draw short raycast line to mouse
            if (this.mousePosition) {
                const playerCenter = new Vector2D(player.getPosition().x + player.getWidth() / 2, player.getPosition().y + player.getHeight() / 2);
                const directionToMouse = this.mousePosition
                    .add(playerCenter.multiply(-1))
                    .normalize();
                const raycastLength = 50;
                const raycastEndPoint = playerCenter.add(directionToMouse.multiply(raycastLength));
                this.canvas.drawLine(playerCenter, raycastEndPoint, "red", 2);
            }
            if (player.getCurrentHP() <= 0) {
                this.gameOver = true;
            }
        });
    }
    reducePlayerCooldown() {
        if (this.players.length > 0 &&
            this.players[0].getShootingCoolDownTime() > 0) {
            this.players[0].reduceShootingCoolDownTime(this.deltaTime);
        }
    }
    //   ____    _    __  __ _____   _     ___   ___  ____
    //  / ___|  / \  |  \/  | ____| | |   / _ \ / _ \|  _ \
    // | |  _  / _ \ | |\/| |  _|   | |  | | | | | | | |_) |
    // | |_| |/ ___ \| |  | | |___  | |__| |_| | |_| |  __/
    //  \____/_/   \_\_|  |_|_____| |_____\___/ \___/|_|
    gameLoop(currentTime) {
        if (this.gameOver) {
            this.canvas.drawRect(new Vector2D(0, 0), this.canvas.getWidth(), this.canvas.getHeight(), "rgba(0, 0, 0, 0.8)");
            const centerX = this.canvas.getWidth() / 2;
            const centerY = this.canvas.getHeight() / 2;
            this.canvas.drawText("Game Over", new Vector2D(centerX, centerY - 80), "#E74C3C", "bold 72px 'Impact', 'Arial Black', sans-serif", "center");
            this.canvas.drawText("Final Score: " + this.score, new Vector2D(centerX, centerY), "#FFFFFF", "36px 'Segoe UI', Arial, sans-serif", "center");
            this.canvas.drawText("Click anywhere to Restart", new Vector2D(centerX, centerY + 60), "#DDDDDD", "24px 'Segoe UI', Arial, sans-serif", "center");
            this.canvas.drawText("Made by ikniz Nguyễn Mỹ Thống", new Vector2D(centerX, centerY + 100), "#AAAAAA", "16px 'Segoe UI', Arial, sans-serif", "center");
            return;
        }
        this.deltaTime = Math.min((currentTime - this.lastTime) / 1000, 0.1);
        this.lastTime = currentTime;
        this.canvas.initCanvas();
        this.drawPlayer();
        // Draw bullets
        this.bullets.forEach((bullet) => {
            if (bullet.getWallCollideTime() <= 5) {
                bullet.update(this.deltaTime, this.canvas.getWidth(), this.canvas.getHeight());
                // Draw bullet
                this.canvas.drawCircle(bullet.getPosition(), bullet.getRadius(), bullet.getWallCollideTime() >= 1 ? "red" : "white");
                // Check collision with players
                this.players.forEach((player) => {
                    if (this.checkCollisionBullet(bullet, player)) {
                        if (bullet.getWallCollideTime() >= 1) {
                            player.reduceHP(2);
                            this.deleteBullet(bullet);
                        }
                    }
                });
                // Check collision with enemies
                this.enemies.forEach((enemy) => {
                    if (this.checkCollisionBullet(bullet, enemy)) {
                        if (bullet.getWallCollideTime() >= 1) {
                            this.deleteBullet(bullet);
                            this.deleteEnemy(enemy);
                            this.score += 1;
                        }
                    }
                });
            }
            else {
                this.deleteBullet(bullet);
            }
        });
        // Draw enemies
        this.enemies.forEach((enemy) => {
            const pos = enemy.getPosition();
            if (pos) {
                enemy.update();
                this.canvas.drawRect(pos, enemy.getWidth(), enemy.getHeight(), enemy.getColor());
                // Check collision with player
                this.players.forEach((player) => {
                    if (this.checkCollisionEnemy(enemy, player)) {
                        player.reduceHP(5);
                        this.deleteEnemy(enemy);
                    }
                });
            }
        });
        this.drawUI();
        // Reduce player cooldown time for each frame
        this.reducePlayerCooldown();
        requestAnimationFrame((time) => this.gameLoop(time));
    }
    startGame() {
        this.lastTime = performance.now();
        requestAnimationFrame((time) => this.gameLoop(time));
    }
    restartGame() {
        this.players = [];
        this.enemies = [];
        this.bullets = [];
        this.score = 0;
        this.gameOver = false;
        const spawnPosition = new Vector2D(120, 120);
        const firstPlayer = new Player(spawnPosition);
        this.addPlayer(firstPlayer);
        this.startGame();
    }
}
// Initialize game
document.addEventListener("DOMContentLoaded", () => {
    const game = new Game();
    const spawnPosition = new Vector2D(120, 120);
    const firstPlayer = new Player(spawnPosition);
    game.addPlayer(firstPlayer);
    game.startGame();
});
