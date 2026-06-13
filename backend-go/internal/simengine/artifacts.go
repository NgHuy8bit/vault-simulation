package simengine

import (
	"encoding/json"
	"os"
	"path/filepath"
)

func writeArtifacts(compiled compiledScenario, response []map[string]any) error {
	dir := artifactDir(compiled.SpecPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	base := normalizeScenarioID(compiled.Scenario.Name)
	if err := writeJSON(filepath.Join(dir, base+".request.json"), compiled.Request); err != nil {
		return err
	}
	return writeJSON(filepath.Join(dir, base+".response.json"), response)
}

func writeJSON(path string, value any) error {
	raw, err := json.MarshalIndent(value, "", "    ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o644)
}
