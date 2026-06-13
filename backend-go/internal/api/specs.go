package api

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"viewer/internal/omap"
	"viewer/internal/settings"
	"viewer/internal/simproc"
	"viewer/internal/specdoc"
)

// ── GET /api/scenario-summary?response-path=... ──────────────────────────────

func HandleScenarioSummary(w http.ResponseWriter, r *http.Request) {
	responsePath := r.URL.Query().Get("response-path")
	target, err := settings.SafeResolve(settings.SimulationBase(), responsePath)
	if err != nil {
		resolveErr(w, err)
		return
	}
	raw, err := os.ReadFile(target)
	if err != nil {
		HTTPError(w, http.StatusNotFound, "File not found")
		return
	}
	rawData, err := omap.DecodeOrdered(raw)
	if err != nil {
		HTTPError(w, http.StatusInternalServerError, "Invalid JSON: "+err.Error())
		return
	}

	var requestData any
	requestTarget := strings.TrimSuffix(target, ".response.json") + ".request.json"
	if requestTarget != target {
		if reqRaw, err := os.ReadFile(requestTarget); err == nil {
			if decoded, err := omap.DecodeOrdered(reqRaw); err == nil {
				requestData = decoded
			}
		}
	}

	WriteJSON(w, http.StatusOK, simproc.Process(rawData, requestData))
}

// ── GET /api/find-spec?response-path=... ─────────────────────────────────────

func HandleFindSpec(w http.ResponseWriter, r *http.Request) {
	responsePath := r.URL.Query().Get("response-path")
	parts := strings.Split(responsePath, "/")
	parentDir := strings.Join(parts[:len(parts)-1], "/")
	specRelPath := parentDir + ".spec"

	target, err := settings.SafeResolve(settings.SpecBase(), specRelPath)
	if err != nil {
		resolveErr(w, err)
		return
	}
	raw, err := os.ReadFile(target)
	if err != nil {
		WriteJSON(w, http.StatusOK, map[string]any{"found": false})
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"found":   true,
		"content": string(raw),
		"path":    specRelPath,
	})
}

// ── GET /api/spec?path=... ───────────────────────────────────────────────────

func HandleReadSpec(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	target, err := settings.SafeResolve(settings.SpecBase(), path)
	if err != nil {
		resolveErr(w, err)
		return
	}
	raw, err := os.ReadFile(target)
	if err != nil {
		HTTPError(w, http.StatusNotFound, "Spec not found")
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"content": string(raw), "path": path})
}

// ── GET /api/parse-spec?path=... ─────────────────────────────────────────────

func HandleParseSpec(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	target, err := settings.SafeResolve(settings.SpecBase(), path)
	if err != nil {
		resolveErr(w, err)
		return
	}
	raw, err := os.ReadFile(target)
	if err != nil {
		HTTPError(w, http.StatusNotFound, "Spec not found")
		return
	}
	WriteJSON(w, http.StatusOK, specdoc.Parse(string(raw)))
}

// ── POST /api/save-spec ──────────────────────────────────────────────────────

type saveSpecRequest struct {
	Path       string          `json:"path"`
	StepsJSON  json.RawMessage `json:"steps_json"`
	RawContent *string         `json:"raw_content"`
	Content    *string         `json:"content"`
}

func HandleSaveSpec(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		HTTPError(w, http.StatusBadRequest, "Invalid body")
		return
	}
	var payload saveSpecRequest
	if err := json.Unmarshal(body, &payload); err != nil {
		HTTPError(w, http.StatusBadRequest, "Invalid JSON: "+err.Error())
		return
	}

	relPath := strings.TrimSpace(payload.Path)
	if !strings.HasSuffix(relPath, ".spec") {
		HTTPError(w, http.StatusBadRequest, "Path must end with .spec")
		return
	}
	target, err := settings.SafeResolve(settings.SpecBase(), relPath)
	if err != nil {
		resolveErr(w, err)
		return
	}

	var content string
	if len(payload.StepsJSON) > 0 && string(payload.StepsJSON) != "null" {
		// Decode through the order-preserving path: table-row key order
		// becomes the serialized column order.
		var spec specdoc.ParsedSpec
		if err := unmarshalParsedSpec(payload.StepsJSON, &spec); err != nil {
			HTTPError(w, http.StatusBadRequest, "Invalid steps_json: "+err.Error())
			return
		}
		content = specdoc.Serialize(spec)
	} else if payload.RawContent != nil {
		content = *payload.RawContent
	} else if payload.Content != nil {
		content = *payload.Content
	} else {
		HTTPError(w, http.StatusBadRequest, "Missing steps_json or raw_content")
		return
	}

	if existing, err := os.ReadFile(target); err == nil && string(existing) == content {
		WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "path": relPath, "written": false})
		return
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		HTTPError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := os.WriteFile(target, []byte(content), 0o644); err != nil {
		HTTPError(w, http.StatusInternalServerError, err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "path": relPath, "written": true})
}

// unmarshalParsedSpec decodes steps_json with ordered maps for step data.
func unmarshalParsedSpec(raw json.RawMessage, spec *specdoc.ParsedSpec) error {
	decoded, err := omap.DecodeOrdered(raw)
	if err != nil {
		return err
	}
	root, _ := decoded.(*omap.Map)

	spec.Title = root.GetStrOr("title", "")
	spec.FileTags = strSlice(root.GetList("file_tags"))
	spec.SetupSteps = decodeSteps(root.GetList("setup_steps"))
	for _, scAny := range root.GetList("scenarios") {
		sc, _ := scAny.(*omap.Map)
		spec.Scenarios = append(spec.Scenarios, specdoc.Scenario{
			Name:  sc.GetStrOr("name", ""),
			Tags:  strSlice(sc.GetList("tags")),
			Steps: decodeSteps(sc.GetList("steps")),
		})
	}
	return nil
}

func decodeSteps(items []any) []specdoc.Step {
	steps := make([]specdoc.Step, 0, len(items))
	for _, itemAny := range items {
		item, _ := itemAny.(*omap.Map)
		if item == nil {
			continue
		}
		data, _ := item.Get("data")
		dataMap, _ := data.(*omap.Map)
		if dataMap == nil {
			dataMap = omap.NewMap()
		}
		steps = append(steps, specdoc.Step{
			Type: item.GetStrOr("type", "other"),
			Raw:  item.GetStrOr("raw", ""),
			Data: dataMap,
		})
	}
	return steps
}

func strSlice(items []any) []string {
	out := make([]string, 0, len(items))
	for _, it := range items {
		out = append(out, omap.PyStr(it))
	}
	return out
}
