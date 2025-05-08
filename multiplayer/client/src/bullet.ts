import { Vector2D } from "./vector2d.js";

export interface BulletState {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  dirX: number; // Not strictly needed for client rendering if only position matters
  dirY: number; // Not strictly needed
  radius: number;
  timesCollidedWall: number;
}

export class Bullet {
  public id: string;
  public ownerId: string;
  public position: Vector2D;
  public radius: number;
  public timesCollidedWall: number;

  constructor(state: BulletState) {
    this.id = state.id;
    this.ownerId = state.ownerId;
    this.position = new Vector2D(state.x, state.y);
    this.radius = state.radius;
    this.timesCollidedWall = state.timesCollidedWall;
  }

  updateState(state: BulletState) {
    this.position.x = state.x;
    this.position.y = state.y;
    this.radius = state.radius;
    this.timesCollidedWall = state.timesCollidedWall;
  }

  getPosition() {
    return this.position;
  }

  getRadius() {
    return this.radius;
  }

  getWallCollideTime() {
    return this.timesCollidedWall;
  }
}
