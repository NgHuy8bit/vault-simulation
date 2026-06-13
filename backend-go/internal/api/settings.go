package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"viewer/internal/settings"
)

// ── GET/POST/DELETE /api/settings ──────────────────────────────────────────

func HandleGetSettings(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]any{
		"settings": settings.Load(),
		"defaults": settings.Defaults(),
	})
}

func HandleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var raw map[string]any
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		HTTPError(w, http.StatusBadRequest, "Invalid JSON: "+err.Error())
		return
	}
	data := map[string]*string{}
	for key := range settings.Defaults() {
		if val, ok := raw[key]; ok && val != nil {
			s := settingString(val)
			data[key] = &s
		}
	}
	updated, err := settings.Save(data)
	if err != nil {
		HTTPError(w, http.StatusInternalServerError, err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"settings": updated,
		"defaults": settings.Defaults(),
	})
}

func HandleResetSettings(w http.ResponseWriter, r *http.Request) {
	data := map[string]*string{}
	for key, value := range settings.Defaults() {
		v := value
		data[key] = &v
	}
	updated, err := settings.Save(data)
	if err != nil {
		HTTPError(w, http.StatusInternalServerError, err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"settings": updated,
		"defaults": settings.Defaults(),
	})
}

func settingString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64, bool:
		raw, _ := json.Marshal(t)
		return string(raw)
	default:
		return ""
	}
}

// ── GET /api/containers ────────────────────────────────────────────────────

type containerInfo struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Image  string `json:"image"`
	Status string `json:"status"`
}

func HandleContainers(w http.ResponseWriter, r *http.Request) {
	docker, err := exec.LookPath("docker")
	if err != nil {
		WriteJSON(w, http.StatusOK, map[string]any{
			"containers": []containerInfo{},
			"error":      "docker CLI not found",
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, docker, "ps", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}")
	out, err := cmd.CombinedOutput()
	if err != nil {
		WriteJSON(w, http.StatusOK, map[string]any{
			"containers": []containerInfo{},
			"error":      strings.TrimSpace(string(out)),
		})
		return
	}

	containers := []containerInfo{}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		item := containerInfo{}
		if len(parts) > 0 {
			item.ID = parts[0]
		}
		if len(parts) > 1 {
			item.Name = parts[1]
		}
		if len(parts) > 2 {
			item.Image = parts[2]
		}
		if len(parts) > 3 {
			item.Status = parts[3]
		}
		if item.ID != "" && item.Name != "" {
			containers = append(containers, item)
		}
	}
	WriteJSON(w, http.StatusOK, map[string]any{"containers": containers})
}
