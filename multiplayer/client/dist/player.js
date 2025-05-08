import { Vector2D } from "./vector2d.js";
export class Player {
    constructor(state) {
        this.id = state.id;
        this.position = new Vector2D(state.x, state.y);
        this.width = state.width;
        this.height = state.height;
        this.color = state.color;
        this.currentHP = state.currentHP;
        this.maxHP = state.maxHP;
        this.shootingCooldown = state.shootingCooldown;
    }
    // Update local state from server data
    updateState(state) {
        this.position.x = state.x;
        this.position.y = state.y;
        this.currentHP = state.currentHP;
        this.maxHP = state.maxHP; // Should be constant but good to sync
        this.color = state.color; // In case it can change
        this.shootingCooldown = state.shootingCooldown;
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
    getColor() {
        return this.color;
    }
    getCurrentHP() {
        return this.currentHP;
    }
    getMaxHP() {
        return this.maxHP;
    }
    getShootingCoolDownTime() {
        return this.shootingCooldown;
    }
}
