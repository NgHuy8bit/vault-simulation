// Package api wires the HTTP handlers — Go port of app/api/routes/*.
package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"

	"viewer/internal/settings"
	"viewer/internal/treesvc"
)

// WriteJSON writes v as a JSON response.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// HTTPError writes a FastAPI-compatible error body: {"detail": "..."}.
func HTTPError(w http.ResponseWriter, status int, detail string) {
	WriteJSON(w, status, map[string]string{"detail": detail})
}

// resolveErr maps settings.SafeResolve errors to HTTP statuses (400/403 parity).
func resolveErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, settings.ErrMissingPath):
		HTTPError(w, http.StatusBadRequest, "Missing path")
	default:
		HTTPError(w, http.StatusForbidden, "Forbidden")
	}
}

// ── GET /api/tree ────────────────────────────────────────────────────────────

func HandleTree(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, treesvc.Build())
}

// ── GET /api/file?path=... ───────────────────────────────────────────────────

func HandleFile(w http.ResponseWriter, r *http.Request) {
	target, err := settings.SafeResolve(settings.SimulationBase(), r.URL.Query().Get("path"))
	if err != nil {
		resolveErr(w, err)
		return
	}
	raw, err := os.ReadFile(target)
	if err != nil {
		HTTPError(w, http.StatusNotFound, "File not found")
		return
	}
	if !json.Valid(raw) {
		HTTPError(w, http.StatusInternalServerError, "Invalid JSON")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}
