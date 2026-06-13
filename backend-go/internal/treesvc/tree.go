// Package treesvc builds the sidebar tree — Go port of app/services/tree_service.py.
package treesvc

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"viewer/internal/settings"
)

var (
	scenarioRe  = regexp.MustCompile(`^##\s+(.+?)(?:\s+@\S+)*\s*$`)
	normalizeRe = regexp.MustCompile(`[^a-z0-9]+`)
)

// normalize lowercases and collapses non-alphanumeric runs to "_" — used to
// match scenario names to response file stems.
func normalize(name string) string {
	return strings.Trim(normalizeRe.ReplaceAllString(strings.ToLower(name), "_"), "_")
}

type Scenario struct {
	Name         string  `json:"name"`
	LineNumber   *int    `json:"lineNumber"`
	ResponsePath *string `json:"responsePath"`
	RequestPath  *string `json:"requestPath"`
	HasResponse  bool    `json:"hasResponse"`
}

type SpecFile struct {
	Name         string     `json:"name"`
	SpecPath     string     `json:"specPath"`
	Scenarios    []Scenario `json:"scenarios"`
	HasResponses bool       `json:"hasResponses"`
}

// Tree is a directory node: {"dirs": {...}, "files": [...]}.
type Tree struct {
	Dirs  OrderedDirs `json:"dirs"`
	Files []SpecFile  `json:"files"`
}

// DirNode is a named subdirectory: {"path": ..., "dirs": ..., "files": ...}.
type DirNode struct {
	Path  string      `json:"path"`
	Dirs  OrderedDirs `json:"dirs"`
	Files []SpecFile  `json:"files"`
}

// OrderedDirs marshals as a JSON object preserving insertion order (Python
// dicts are insertion-ordered; Go maps marshal sorted, which would reorder
// the sidebar).
type OrderedDirs []namedDir

type namedDir struct {
	Name string
	Node DirNode
}

func (o OrderedDirs) MarshalJSON() ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, item := range o {
		if i > 0 {
			buf.WriteByte(',')
		}
		key, err := json.Marshal(item.Name)
		if err != nil {
			return nil, err
		}
		buf.Write(key)
		buf.WriteByte(':')
		val, err := json.Marshal(item.Node)
		if err != nil {
			return nil, err
		}
		buf.Write(val)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

func extractScenarios(specPath string) []Scenario {
	raw, err := os.ReadFile(specPath)
	if err != nil {
		return nil
	}
	var out []Scenario
	for i, line := range strings.Split(string(raw), "\n") {
		if m := scenarioRe.FindStringSubmatch(line); m != nil {
			n := i + 1
			out = append(out, Scenario{Name: strings.TrimSpace(m[1]), LineNumber: &n})
		}
	}
	return out
}

// Build walks the spec base and returns the sidebar tree.
func Build() Tree {
	specBase := settings.SpecBase()
	simBase := settings.SimulationBase()
	return buildDir(specBase, specBase, simBase)
}

func buildDir(dir, specBase, simBase string) Tree {
	result := Tree{Dirs: OrderedDirs{}, Files: []SpecFile{}}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return result
	}

	// Directories first, then files; both case-insensitively by name.
	sort.SliceStable(entries, func(i, j int) bool {
		di, dj := entries[i].IsDir(), entries[j].IsDir()
		if di != dj {
			return di
		}
		return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name())
	})

	for _, entry := range entries {
		full := filepath.Join(dir, entry.Name())
		relSpec, _ := filepath.Rel(specBase, full)
		relSpec = filepath.ToSlash(relSpec)

		if entry.IsDir() {
			subtree := buildDir(full, specBase, simBase)
			if len(subtree.Files) > 0 || len(subtree.Dirs) > 0 {
				result.Dirs = append(result.Dirs, namedDir{
					Name: entry.Name(),
					Node: DirNode{Path: relSpec, Dirs: subtree.Dirs, Files: subtree.Files},
				})
			}
			continue
		}
		if !strings.HasSuffix(entry.Name(), ".spec") {
			continue
		}

		specBaseName := strings.TrimSuffix(entry.Name(), ".spec")
		relDir := filepath.Dir(relSpec)
		simDir := filepath.Join(simBase, relDir, specBaseName)

		// normalized response stem → paths
		type respInfo struct {
			responsePath string
			requestPath  *string
		}
		responseLookup := map[string]respInfo{}
		if simEntries, err := os.ReadDir(simDir); err == nil {
			for _, se := range simEntries {
				if !strings.HasSuffix(se.Name(), ".response.json") {
					continue
				}
				stem := strings.TrimSuffix(se.Name(), ".response.json")
				respRel, _ := filepath.Rel(simBase, filepath.Join(simDir, se.Name()))
				info := respInfo{responsePath: filepath.ToSlash(respRel)}
				reqFull := filepath.Join(simDir, stem+".request.json")
				if _, err := os.Stat(reqFull); err == nil {
					reqRel, _ := filepath.Rel(simBase, reqFull)
					s := filepath.ToSlash(reqRel)
					info.requestPath = &s
				}
				responseLookup[stem] = info
			}
		}

		specScenarios := extractScenarios(full)

		// Skip the first scenario if it looks like a global setup block.
		displayScenarios := specScenarios
		if len(specScenarios) > 0 {
			firstName := strings.ToLower(specScenarios[0].Name)
			if strings.Contains(firstName, "set up") ||
				strings.Contains(firstName, "setup") ||
				strings.Contains(firstName, "global environment") {
				displayScenarios = specScenarios[1:]
			}
		}

		scenarios := []Scenario{}
		matchedStems := map[string]bool{}
		for _, sc := range displayScenarios {
			norm := normalize(sc.Name)
			matchedStems[norm] = true
			item := Scenario{Name: sc.Name, LineNumber: sc.LineNumber}
			if resp, ok := responseLookup[norm]; ok {
				p := resp.responsePath
				item.ResponsePath = &p
				item.RequestPath = resp.requestPath
				item.HasResponse = true
			}
			scenarios = append(scenarios, item)
		}

		// Orphaned response files with no matching spec scenario.
		for stem, resp := range responseLookup {
			if matchedStems[stem] {
				continue
			}
			p := resp.responsePath
			scenarios = append(scenarios, Scenario{
				Name:         strings.ReplaceAll(stem, "_", " "),
				ResponsePath: &p,
				RequestPath:  resp.requestPath,
				HasResponse:  true,
			})
		}

		sort.SliceStable(scenarios, func(i, j int) bool {
			li, lj := scenarios[i].LineNumber, scenarios[j].LineNumber
			if (li == nil) != (lj == nil) {
				return lj == nil // non-nil line numbers first
			}
			vi, vj := 0, 0
			if li != nil {
				vi = *li
			}
			if lj != nil {
				vj = *lj
			}
			if vi != vj {
				return vi < vj
			}
			return scenarios[i].Name < scenarios[j].Name
		})

		hasResponses := false
		for _, s := range scenarios {
			if s.HasResponse {
				hasResponses = true
				break
			}
		}

		result.Files = append(result.Files, SpecFile{
			Name:         specBaseName,
			SpecPath:     relSpec,
			Scenarios:    scenarios,
			HasResponses: hasResponses,
		})
	}

	sort.SliceStable(result.Files, func(i, j int) bool {
		return result.Files[i].Name < result.Files[j].Name
	})
	return result
}
