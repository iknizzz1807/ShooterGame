package main

import "math"

type Vector2D struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

func NewVector2D(x, y float64) Vector2D {
	return Vector2D{X: x, Y: y}
}

func (v Vector2D) Add(other Vector2D) Vector2D {
	return NewVector2D(v.X+other.X, v.Y+other.Y)
}

func (v Vector2D) Multiply(scalar float64) Vector2D {
	return NewVector2D(v.X*scalar, v.Y*scalar)
}

func (v Vector2D) Magnitude() float64 {
	return math.Sqrt(v.X*v.X + v.Y*v.Y)
}

func (v Vector2D) Normalize() Vector2D {
	mag := v.Magnitude()
	if mag > 0 {
		return NewVector2D(v.X/mag, v.Y/mag)
	}
	return NewVector2D(0, 0)
}
