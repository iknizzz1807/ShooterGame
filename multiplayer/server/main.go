package main

import (
	"flag"
	"log"
	"net/http"
	"os"
)

var addr = flag.String("addr", "", "http service address (overrides PORT env)")

func main() {
	flag.Parse()

	// Determine listen address: flag > PORT env > default :8080
	listenAddr := *addr
	if listenAddr == "" {
		if port := os.Getenv("PORT"); port != "" {
			listenAddr = ":" + port
		} else {
			listenAddr = ":8080"
		}
	}

	hub := NewHub()
	go hub.Run()

	// WebSocket endpoint
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		serveWs(hub, w, r)
	})

	// Serve client static files
	fs := http.FileServer(http.Dir("./client"))
	http.Handle("/", fs)

	log.Println("Server starting on", listenAddr)
	err := http.ListenAndServe(listenAddr, nil)
	if err != nil {
		log.Fatal("ListenAndServe: ", err)
	}
}
