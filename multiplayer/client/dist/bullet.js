import { Vector2D } from "./vector2d.js";
export class Bullet {
    constructor(state) {
        this.id = state.id;
        this.ownerId = state.ownerId;
        this.position = new Vector2D(state.x, state.y);
        this.radius = state.radius;
        this.timesCollidedWall = state.timesCollidedWall;
    }
    updateState(state) {
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
