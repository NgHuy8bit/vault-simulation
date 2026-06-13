// Package settings is the Go port of app/core/settings_store.py + paths.py.
//
// Settings live in viewer-settings.json inside the viewer directory. The
// viewer directory is resolved from the VIEWER_DIR env var (set by docker
// compose / Makefile); it defaults to the current working directory so that
// running the binary from simulation-viewer/ during host development "just
// works".
package settings

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Defaults mirrors settings_store.DEFAULTS. Keys are the persisted settings.
func Defaults() map[string]string {
	return map[string]string{
		"smart_contracts_dir": defaultSmartContractsDir(),
		"container_name":      "", // empty → auto-detect
		"container_workdir":   "/workspaces/smart-contracts",
		"bunx_path":           "/home/vscode/.bun/bin/bunx",
		// New keys for the native Go simulation engine (Phase 2):
		"run_mode":        "native", // native | gauge
		"sim_concurrency": "4",
		"sim_environment": "", // empty → smart-contracts/config/framework_config.json
	}
}

func viewerDir() string {
	if dir := strings.TrimSpace(os.Getenv("VIEWER_DIR")); dir != "" {
		return dir
	}
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}

func settingsFile() string {
	return filepath.Join(viewerDir(), "viewer-settings.json")
}

func defaultSmartContractsDir() string {
	if env := strings.TrimSpace(os.Getenv("SMART_CONTRACTS_DIR")); env != "" {
		return env
	}
	// simulation-viewer/../smart-contracts (current repo layout)
	abs, err := filepath.Abs(filepath.Join(viewerDir(), "..", "smart-contracts"))
	if err != nil {
		return filepath.Join(viewerDir(), "..", "smart-contracts")
	}
	return abs
}

// Load returns current settings merged over defaults (re-reads on every call,
// matching the Python behavior so changes take effect immediately).
func Load() map[string]string {
	merged := Defaults()
	raw, err := os.ReadFile(settingsFile())
	if err != nil {
		return merged
	}
	var stored map[string]any
	if err := json.Unmarshal(raw, &stored); err != nil {
		return merged
	}
	for key := range merged {
		if val, ok := stored[key]; ok && val != nil {
			s := strings.TrimSpace(toString(val))
			if s != "" {
				merged[key] = s
			}
		}
	}
	return merged
}

// Save persists only known keys; returns the merged result.
func Save(data map[string]*string) (map[string]string, error) {
	current := Load()
	defaults := Defaults()
	for key := range defaults {
		if val, ok := data[key]; ok && val != nil {
			s := strings.TrimSpace(*val)
			if s == "" {
				s = defaults[key]
			}
			current[key] = s
		}
	}
	if err := os.MkdirAll(filepath.Dir(settingsFile()), 0o755); err != nil {
		return nil, err
	}
	out, err := json.MarshalIndent(current, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(settingsFile(), append(out, '\n'), 0o644); err != nil {
		return nil, err
	}
	return current, nil
}

// Reset deletes the settings file, restoring defaults.
func Reset() error {
	err := os.Remove(settingsFile())
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func toString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		b, _ := json.Marshal(t)
		return string(b)
	case bool:
		if t {
			return "true"
		}
		return "false"
	default:
		return ""
	}
}

// ── Per-request accessors ────────────────────────────────────────────────────

func SmartContractsDir() string { return Load()["smart_contracts_dir"] }

func SpecBase() string { return filepath.Join(SmartContractsDir(), "specs") }

func SimulationBase() string {
	return filepath.Join(SmartContractsDir(), ".gauge", "simulation")
}

// RunSettings returns the subset used by the gauge runner.
type RunSettings struct {
	ContainerName    string
	ContainerWorkdir string
	BunxPath         string
}

func GetRunSettings() RunSettings {
	s := Load()
	return RunSettings{
		ContainerName:    s["container_name"],
		ContainerWorkdir: s["container_workdir"],
		BunxPath:         s["bunx_path"],
	}
}

func RunMode() string {
	mode := strings.ToLower(strings.TrimSpace(Load()["run_mode"]))
	if mode == "" {
		return "native"
	}
	return mode
}

func SimConcurrency() int {
	n, err := strconv.Atoi(strings.TrimSpace(Load()["sim_concurrency"]))
	if err != nil || n < 1 {
		return 4
	}
	if n > 32 {
		return 32
	}
	return n
}

func SimEnvironment() string {
	return strings.TrimSpace(Load()["sim_environment"])
}

// ── safe path resolution (port of paths.safe_resolve) ───────────────────────

// ErrMissingPath maps to HTTP 400, ErrForbiddenPath to HTTP 403.
var (
	ErrMissingPath   = errors.New("Missing path")
	ErrForbiddenPath = errors.New("Forbidden")
)

// SafeResolve joins rel onto base and guarantees the result stays inside base.
func SafeResolve(base, rel string) (string, error) {
	if strings.TrimSpace(rel) == "" {
		return "", ErrMissingPath
	}
	absBase, err := filepath.Abs(base)
	if err != nil {
		return "", ErrForbiddenPath
	}
	target := filepath.Clean(filepath.Join(absBase, rel))
	if target != absBase && !strings.HasPrefix(target, absBase+string(filepath.Separator)) {
		return "", ErrForbiddenPath
	}
	return target, nil
}
