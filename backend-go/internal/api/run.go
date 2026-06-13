package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	"viewer/internal/gaugerun"
	"viewer/internal/settings"
	"viewer/internal/simengine"
)

type runSpecRequest struct {
	SpecPath   string `json:"spec_path"`
	LineNumber *int   `json:"line_number"`
}

// ── POST /api/run-spec ─────────────────────────────────────────────────────

func HandleRunSpec(w http.ResponseWriter, r *http.Request) {
	var payload runSpecRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		HTTPError(w, http.StatusBadRequest, "Invalid JSON: "+err.Error())
		return
	}

	specPath := strings.TrimSpace(payload.SpecPath)
	specFile, err := settings.SafeResolve(settings.SpecBase(), specPath)
	if err != nil {
		resolveErr(w, err)
		return
	}
	if _, err := os.Stat(specFile); err != nil {
		HTTPError(w, http.StatusNotFound, "Spec not found")
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		HTTPError(w, http.StatusInternalServerError, "Streaming not supported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	emitter := sseEmitter{w: w, flusher: flusher}
	if settings.RunMode() == "gauge" {
		gaugerun.Run(r.Context(), emitter, specPath, payload.LineNumber)
		return
	}
	simengine.Run(r.Context(), emitter, specPath, payload.LineNumber)
}

type sseEmitter struct {
	w       http.ResponseWriter
	flusher http.Flusher
}

func (e sseEmitter) Emit(v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(e.w, "data: %s\n\n", raw); err != nil {
		return err
	}
	e.flusher.Flush()
	return nil
}
