# Stage 1: Build Go server
FROM golang:1.23-alpine AS builder

WORKDIR /app/server
COPY server/go.mod server/go.sum ./
RUN go mod download

COPY server/ .
RUN CGO_ENABLED=0 go build -o /game-server .

# Stage 2: Runtime
FROM alpine:3.19

WORKDIR /app

# Copy Go binary
COPY --from=builder /game-server ./game-server

# Copy client files (server serves them as static)
COPY client/index.html ./client/index.html
COPY client/dist/ ./client/dist/

# Railway injects PORT env var
ENV PORT=8080
EXPOSE 8080

CMD ["./game-server"]
