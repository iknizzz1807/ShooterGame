FROM golang:1.23-alpine AS builder
WORKDIR /build
COPY multiplayer/server/go.mod multiplayer/server/go.sum ./
RUN go mod download
COPY multiplayer/server/ .
RUN CGO_ENABLED=0 go build -o /game-server .

FROM alpine:3.19
WORKDIR /app
COPY --from=builder /game-server /app/game-server
COPY multiplayer/client/index.html /app/client/index.html
COPY multiplayer/client/dist/ /app/client/dist/
ENV PORT=8080
EXPOSE 8080
CMD ["/app/game-server"]
