class Vector2D {
  constructor(public x: number, public y: number) {}

  add(other: Vector2D): Vector2D {
    return new Vector2D(this.x + other.x, this.y + other.y);
  }

  multiply(scalar: number): Vector2D {
    return new Vector2D(this.x * scalar, this.y * scalar);
  }

  magnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  normalize(): Vector2D {
    const mag = this.magnitude();
    return mag > 0
      ? new Vector2D(this.x / mag, this.y / mag)
      : new Vector2D(0, 0);
  }
}

// Canvas class
class Canvas {
  private canvas: HTMLCanvasElement | null;
  private ctx!: CanvasRenderingContext2D | null;
  private width: number;
  private height: number;

  constructor() {
    this.canvas = document.getElementById("canvas") as HTMLCanvasElement;
    if (this.canvas) this.ctx = this.canvas.getContext("2d");
    this.width = 1400;
    this.height = 700;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  initCanvas() {
    if (this.ctx) {
      this.ctx.fillStyle = "gray";
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

  drawText(text: string, position: Vector2D, color: string) {
    if (this.ctx) {
      this.ctx.fillStyle = color;
      this.ctx.font = "20px Arial";
      this.ctx.fillText(text, position.x, position.y);
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
  private position: Vector2D;
  private hasCollided: number;
  private direction: Vector2D;
  private radius: number;

  constructor(position: Vector2D, direction: Vector2D) {
    this.position = position;
    this.hasCollided = 0;
    this.direction = direction;
    this.radius = 5;
  }

  getBullet() {
    return this;
  }

  getPosition() {
    return this.position;
  }

  getRadius() {
    return this.radius;
  }

  update(deltaTime: number, canvasWidth: number, canvasHeight: number) {
    // This function is called every frame
    const speed = 1000;
    this.position = new Vector2D(
      this.position.x + speed * this.direction.x * deltaTime,
      this.position.y + speed * this.direction.y * deltaTime
    );

    // Boundary check and reflection
    if (
      // Check if collide left and right
      this.position.x - this.radius < 0 ||
      this.position.x + this.radius > canvasWidth
    ) {
      this.hasCollided += 1;
      this.direction = new Vector2D(-this.direction.x, this.direction.y);
    }
    if (
      // Check if collide top and bot
      this.position.y - this.radius < 0 ||
      this.position.y + this.radius > canvasHeight
    ) {
      this.hasCollided += 1;
      this.direction = new Vector2D(this.direction.x, -this.direction.y);
    }
  }
  getCollideTime() {
    return this.hasCollided;
  }
}

class Player {
  private id: number;
  private currentHP: number;
  private maxHP: number;
  private position: Vector2D;
  private currentVelocity: Vector2D;
  private maxVelocity: number;
  private acceleration: number;
  private friction: number;
  private input: Vector2D;
  private width: number;
  private height: number;
  private isShooting: boolean;
  private color: string;

  constructor(position: Vector2D) {
    this.id = Math.random() * 1000;
    this.currentHP = 10;
    this.maxHP = 10;
    this.position = position;
    this.currentVelocity = new Vector2D(0, 0);
    this.maxVelocity = 400;
    this.acceleration = 1000;
    this.friction = 0.95;
    this.input = new Vector2D(0, 0);
    this.isShooting = false;
    this.width = 50;
    this.height = 50;
    this.color = "blue";
  }

  getPlayer() {
    return this;
  }

  getPosition(): Vector2D {
    return this.position;
  }

  getWidth() {
    return this.width;
  }

  getHeight() {
    return this.height;
  }
  setInput(direction: Vector2D) {
    this.input = direction;
  }

  reduceHP(amount: number) {
    this.currentHP -= amount;
    // this.color = "green";
    if (this.currentHP < 0) this.currentHP = 0;
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

  update(deltaTime: number, canvasWidth: number, canvasHeight: number) {
    // This function is called every frame
    // -------------------------------------
    // Normalize input if it exists
    if (this.input.magnitude() > 0) {
      const normalizedInput = this.input.normalize();

      // Apply acceleration
      const acceleration = normalizedInput.multiply(
        this.acceleration * deltaTime
      );
      this.currentVelocity = new Vector2D(
        this.currentVelocity.x + acceleration.x,
        this.currentVelocity.y + acceleration.y
      );

      // Limit to max velocity
      const currentSpeed = this.currentVelocity.magnitude();
      if (currentSpeed > this.maxVelocity) {
        const normalized = this.currentVelocity.normalize();
        this.currentVelocity = new Vector2D(
          normalized.x * this.maxVelocity,
          normalized.y * this.maxVelocity
        );
      }
    } else {
      // Apply friction when no input
      this.currentVelocity = new Vector2D(
        this.currentVelocity.x * this.friction,
        this.currentVelocity.y * this.friction
      );

      // Stop completely if very slow
      if (this.currentVelocity.magnitude() < 0.1) {
        this.currentVelocity = new Vector2D(0, 0);
      }
    }

    // Update position
    this.position = new Vector2D(
      this.position.x + this.currentVelocity.x * deltaTime,
      this.position.y + this.currentVelocity.y * deltaTime
    );

    // Boundary check
    if (this.position.x < 0) this.position.x = 0;
    if (this.position.y < 0) this.position.y = 0;
    if (this.position.x + this.width > canvasWidth)
      this.position.x = canvasWidth - this.width;
    if (this.position.y + this.height > canvasHeight)
      this.position.y = canvasHeight - this.height;
  }

  shoot(mousePosition: Vector2D): Bullet {
    const playerCenter = new Vector2D(
      this.position.x + this.width / 2,
      this.position.y + this.height / 2
    );
    const direction = mousePosition
      .add(new Vector2D(-playerCenter.x, -playerCenter.y))
      .normalize();
    const bullet = new Bullet(playerCenter, direction);
    this.isShooting = true;
    return bullet;
  }
}

class Enemy {
  private playerToFollow: Player | null;
  private position: Vector2D | null;
  private speed: number;
  private maxHP: number;
  private currentHP: number;
  private width: number;
  private height: number;
  private color: string;

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

  followPlayer(player: Player) {
    this.playerToFollow = player;
  }

  setPosition(pos: Vector2D) {
    this.position = new Vector2D(pos.x, pos.y);
  }

  getPosition() {
    if (this.position) return this.position;
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

  reduceHP(amount: number) {
    this.currentHP -= amount;
    if (this.currentHP <= 0) this.currentHP = 0;
  }

  update() {
    if (this.playerToFollow && this.position) {
      const playerPos: Vector2D = this.playerToFollow.getPosition();
      const direction = playerPos
        .add(new Vector2D(-this.position.x, -this.position.y))
        .normalize();
      const speed = this.speed;
      this.position = new Vector2D(
        this.position.x + direction.x * speed,
        this.position.y + direction.y * speed
      );
    }
  }
}

class Game {
  private canvas: Canvas;
  private players: Player[];
  private enemies: Enemy[];
  private lastTime: number;
  private keysPressed: { [key: string]: boolean };
  private bullets: Bullet[];
  private score: number;

  constructor() {
    this.canvas = new Canvas();
    this.canvas.initCanvas();
    this.players = [];
    this.enemies = [];
    this.lastTime = 0;
    this.keysPressed = {};
    this.bullets = [];
    this.score = 0;
    setInterval(() => {
      this.spawnEnemy();
    }, 2000);

    window.addEventListener("keydown", (event: KeyboardEvent) => {
      this.keysPressed[event.key.toLowerCase()] = true;
      this.updatePlayerInput();
    });

    window.addEventListener("keyup", (event: KeyboardEvent) => {
      this.keysPressed[event.key.toLowerCase()] = false;
      this.updatePlayerInput();
    });

    this.canvas.getCanvas()?.addEventListener("click", (event) => {
      if (this.players.length === 0) return;

      const canvasElement = this.canvas.getCanvas();
      if (canvasElement) {
        const canvasRect = canvasElement.getBoundingClientRect();
        const mouseX = event.clientX - canvasRect.left;
        const mouseY = event.clientY - canvasRect.top;

        const mousePosition = new Vector2D(mouseX, mouseY);

        const newBullet = this.players[0].shoot(mousePosition);
        this.bullets.push(newBullet);
      }
    });
  }

  private updatePlayerInput() {
    if (this.players.length === 0) return;

    let x = 0;
    let y = 0;

    if (this.keysPressed["w"]) y -= 1;
    if (this.keysPressed["s"]) y += 1;
    if (this.keysPressed["a"]) x -= 1;
    if (this.keysPressed["d"]) x += 1;

    this.players[0].setInput(new Vector2D(x, y));
  }

  addPlayer(newPlayer: Player) {
    this.players.push(newPlayer);
    this.spawnEnemy();
  }

  spawnEnemy() {
    const player = this.players[0];
    const minDistance = 500; // Spawn far away from the player
    let newEnemyPosition;

    do {
      newEnemyPosition = new Vector2D(
        Math.random() * this.canvas.getWidth(),
        Math.random() * this.canvas.getHeight()
      );
    } while (
      newEnemyPosition
        .add(new Vector2D(-player.getPosition().x, -player.getPosition().y))
        .magnitude() < minDistance
    );

    const newEnemy = new Enemy();
    newEnemy.followPlayer(player);
    newEnemy.setPosition(newEnemyPosition);
    this.enemies.push(newEnemy);
  }

  checkCollisionBullet(bullet: Bullet, target: Player | Enemy): boolean {
    const bulletLeft = bullet.getPosition().x - bullet.getRadius();
    const bulletRight = bullet.getPosition().x + bullet.getRadius();
    const bulletTop = bullet.getPosition().y - bullet.getRadius();
    const bulletBottom = bullet.getPosition().y + bullet.getRadius();

    const targetPosition = target.getPosition();
    if (!targetPosition) return false;
    const targetLeft = targetPosition.x;
    const targetRight = targetPosition.x + target.getWidth();
    const targetTop = targetPosition.y;
    const targetBottom = targetPosition.y + target.getHeight();

    if (target instanceof Player) {
      return (
        bulletRight > targetLeft &&
        bulletLeft < targetRight &&
        bulletBottom > targetTop &&
        bulletTop < targetBottom &&
        bullet.getCollideTime() >= 1
      );
    } else
      return (
        bulletRight > targetLeft &&
        bulletLeft < targetRight &&
        bulletBottom > targetTop &&
        bulletTop < targetBottom
      );
  }

  checkCollisionEnemy(enemy: Enemy, player: Player): boolean {
    const enemyPos = enemy.getPosition();
    if (!enemyPos) return false;

    const enemyLeft = enemyPos.x;
    const enemyRight = enemyPos.x + enemy.getWidth();
    const enemyTop = enemyPos.y;
    const enemyBottom = enemyPos.y + enemy.getHeight();

    const playerPos = player.getPosition();
    const playerLeft = playerPos.x;
    const playerRight = playerPos.x + player.getWidth();
    const playerTop = playerPos.y;
    const playerBottom = playerPos.y + player.getHeight();

    return (
      enemyRight >= playerLeft &&
      enemyLeft <= playerRight &&
      enemyBottom >= playerTop &&
      enemyTop <= playerBottom
    );
  }

  deleteEnemy(enemy: Enemy) {
    this.enemies = this.enemies.filter((e) => e !== enemy);
  }

  deleteBullet(bullet: Bullet) {
    this.bullets = this.bullets.filter((b) => b !== bullet);
  }
  //   ____    _    __  __ _____   _     ___   ___  ____
  //  / ___|  / \  |  \/  | ____| | |   / _ \ / _ \|  _ \
  // | |  _  / _ \ | |\/| |  _|   | |  | | | | | | | |_) |
  // | |_| |/ ___ \| |  | | |___  | |__| |_| | |_| |  __/
  //  \____/_/   \_\_|  |_|_____| |_____\___/ \___/|_|
  gameLoop(currentTime: number) {
    const deltaTime = Math.min((currentTime - this.lastTime) / 1000, 0.1);
    this.lastTime = currentTime;

    this.canvas.initCanvas();

    // Draw players
    this.players.forEach((player) => {
      player.update(deltaTime, this.canvas.getWidth(), this.canvas.getHeight());
      this.canvas.drawRect(
        player.getPosition(),
        player.getWidth(),
        player.getHeight(),
        player.getColor()
      );
      // Draw health bar
      const healthBarPos = new Vector2D(
        player.getPosition().x,
        player.getPosition().y - 8
      );
      this.canvas.drawRect(
        healthBarPos,
        (player.getWidth() * player.getCurrentHP()) / player.getMaxHP(),
        4,
        "red"
      );
      this.canvas.drawStroke(
        healthBarPos,
        (player.getWidth() * player.getCurrentHP()) / player.getMaxHP(),
        5,
        "white"
      );
    });

    // Draw bullets
    this.bullets.forEach((bullet) => {
      if (bullet.getCollideTime() <= 5) {
        bullet.update(
          deltaTime,
          this.canvas.getWidth(),
          this.canvas.getHeight()
        );
        this.canvas.drawCircle(
          bullet.getPosition(),
          bullet.getRadius(),
          "white"
        );
        // Check collision with players
        this.players.forEach((player) => {
          if (this.checkCollisionBullet(bullet, player)) {
            player.reduceHP(2);
            this.deleteBullet(bullet);
          }
        });
        // Check collision with enemies
        this.enemies.forEach((enemy) => {
          //
          if (this.checkCollisionBullet(bullet, enemy)) {
            enemy.reduceHP(2);
            this.deleteBullet(bullet);
            this.deleteEnemy(enemy);
          }
        });
      } else {
        this.deleteBullet(bullet);
      }
    });

    // Draw enemies
    this.enemies.forEach((enemy) => {
      const pos = enemy.getPosition();
      if (pos) {
        enemy.update();
        this.canvas.drawRect(
          pos,
          enemy.getWidth(),
          enemy.getHeight(),
          enemy.getColor()
        );

        // Check collision with player
        this.players.forEach((player) => {
          if (this.checkCollisionEnemy(enemy, player)) {
            player.reduceHP(5);
            this.deleteEnemy(enemy);
          }
        });
      }
    });

    requestAnimationFrame((time) => this.gameLoop(time));
  }

  startGame() {
    this.lastTime = performance.now();
    requestAnimationFrame((time) => this.gameLoop(time));
  }
}

// Initialize game
document.addEventListener("DOMContentLoaded", () => {
  const game = new Game();
  const spawnPosition = new Vector2D(80, 80);
  const firstPlayer = new Player(spawnPosition);
  game.addPlayer(firstPlayer);
  game.startGame();
});
