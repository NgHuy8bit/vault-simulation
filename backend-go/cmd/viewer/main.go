// Vault Simulation Viewer backend — Go rewrite of the FastAPI app.
package main

import (
	"log"
	"net/http"
	"os"

	"viewer/internal/api"
)

var allowedOrigins = map[string]bool{
	"http://localhost:5173": true,
	"http://127.0.0.1:5173": true,
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if allowedOrigins[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/tree", api.HandleTree)
	mux.HandleFunc("GET /api/file", api.HandleFile)
	mux.HandleFunc("GET /api/scenario-summary", api.HandleScenarioSummary)
	mux.HandleFunc("GET /api/find-spec", api.HandleFindSpec)
	mux.HandleFunc("GET /api/spec", api.HandleReadSpec)
	mux.HandleFunc("GET /api/parse-spec", api.HandleParseSpec)
	mux.HandleFunc("POST /api/save-spec", api.HandleSaveSpec)
	mux.HandleFunc("POST /api/run-spec", api.HandleRunSpec)
	mux.HandleFunc("GET /api/settings", api.HandleGetSettings)
	mux.HandleFunc("POST /api/settings", api.HandleUpdateSettings)
	mux.HandleFunc("DELETE /api/settings", api.HandleResetSettings)
	mux.HandleFunc("GET /api/containers", api.HandleContainers)

	addr := ":8000"
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}
	log.Printf("Vault Simulation Viewer API (Go) listening on %s", addr)
	if err := http.ListenAndServe(addr, cors(mux)); err != nil {
		log.Fatal(err)
	}
}
