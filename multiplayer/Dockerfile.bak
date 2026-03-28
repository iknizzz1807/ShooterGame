# Stage 1: Build Go server
FROM golang:1.23-alpine AS builder

WORKDIR /build
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ .
RUN CGO_ENABLED=0 go build -o /game-server .

# Stage 2: Runtime
FROM alpine:3.19

WORKDIR /app

# Copy Go binary
COPY --from=builder /game-server /app/game-server

# Copy client files (server serves them as static)
COPY client/index.html /app/client/index.html
COPY client/dist/ /app/client/dist/

# Railway injects PORT env var
ENV PORT=8080
EXPOSE 8080

CMD ["/app/game-server"]
