// Package gaugerun runs Gauge and translates its output into the compact
// events consumed by the viewer frontend.
package gaugerun

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"

	"viewer/internal/settings"
)

var (
	ansiRE         = regexp.MustCompile(`\x1b\[[0-9;]*m`)
	tickRE         = regexp.MustCompile(`[✔✓]`)
	crossRE        = regexp.MustCompile(`[✗✘×]`)
	specLineRE     = regexp.MustCompile(`^#\s+(\S.*)$`)
	scenarioLineRE = regexp.MustCompile(`^\s*##\s+(\S.*)$`)
	stepLineRE     = regexp.MustCompile(`^\s*\*\s+(\S.*)$`)
)

// Progress is the best-effort live breadcrumb extracted from Gauge output.
type Progress struct {
	Level  string `json:"level"`
	Text   string `json:"text"`
	Status string `json:"status"`
}

// EventEmitter is implemented by the API layer's SSE writer.
type EventEmitter interface {
	Emit(any) error
}

type lineEvent struct {
	Line  string `json:"line"`
	Error *bool  `json:"error,omitempty"`
}

type progressEvent struct {
	Progress Progress `json:"progress"`
}

type resultEvent struct {
	Result *Report `json:"result"`
}

type doneEvent struct {
	Done     bool `json:"done"`
	ExitCode int  `json:"exit_code"`
}

// Run executes a Gauge run and emits FastAPI-compatible SSE payloads.
func Run(ctx context.Context, emit EventEmitter, specPath string, lineNumber *int) {
	exitCode := 1
	if err := run(ctx, emit, specPath, lineNumber, &exitCode); err != nil {
		msg := fmt.Sprintf("Error: %s\n", err)
		truth := true
		_ = emit.Emit(lineEvent{Line: msg, Error: &truth})
		exitCode = 1
	}
	_ = emit.Emit(doneEvent{Done: true, ExitCode: exitCode})
}

func run(ctx context.Context, emit EventEmitter, specPath string, lineNumber *int, exitCode *int) error {
	runCfg := settings.GetRunSettings()
	smartContractsDir := settings.SmartContractsDir()

	gaugePath := "specs/" + specPath
	if lineNumber != nil && *lineNumber != 0 {
		gaugePath = fmt.Sprintf("%s:%d", gaugePath, *lineNumber)
	}

	cmd, err := buildCommand(ctx, runCfg, smartContractsDir, gaugePath)
	if err != nil {
		return err
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		return err
	}

	readErr := streamOutput(stdout, emit)
	waitErr := cmd.Wait()
	if readErr != nil {
		return readErr
	}
	if waitErr != nil {
		if ee, ok := waitErr.(*exec.ExitError); ok {
			*exitCode = ee.ExitCode()
		} else {
			return waitErr
		}
	} else {
		*exitCode = 0
	}

	if report := LoadJSONReport(smartContractsDir); report != nil {
		if err := emit.Emit(resultEvent{Result: report}); err != nil {
			return err
		}
	}
	return nil
}

func buildCommand(ctx context.Context, runCfg settings.RunSettings, smartContractsDir, gaugePath string) (*exec.Cmd, error) {
	if runtime.GOOS == "darwin" {
		containerID, err := ResolveContainerID(ctx, runCfg.ContainerName, runCfg.BunxPath)
		if err != nil {
			return nil, err
		}
		docker, err := exec.LookPath("docker")
		if err != nil {
			return nil, fmt.Errorf("docker CLI not found. Make sure Docker/OrbStack is installed")
		}
		shellCmd := fmt.Sprintf(
			"cd %s && %s gauge run %s --env ci --verbose",
			shellQuote(runCfg.ContainerWorkdir),
			shellQuote(runCfg.BunxPath),
			shellQuote(gaugePath),
		)
		return exec.CommandContext(ctx, docker, "exec", "-i", containerID, "/bin/bash", "-c", shellCmd), nil
	}

	cmd := exec.CommandContext(ctx, runCfg.BunxPath, "gauge", "run", gaugePath, "--env", "ci", "--verbose")
	cmd.Dir = smartContractsDir
	cmd.Env = withPrependedPath(os.Environ(), filepath.Dir(runCfg.BunxPath))
	return cmd, nil
}

func streamOutput(stdout io.Reader, emit EventEmitter) error {
	reader := bufio.NewReader(stdout)
	for {
		raw, err := reader.ReadString('\n')
		if raw != "" {
			line := ansiRE.ReplaceAllString(raw, "")
			if err := emit.Emit(lineEvent{Line: line}); err != nil {
				return err
			}
			if progress, ok := ClassifyProgressLine(line); ok {
				if err := emit.Emit(progressEvent{Progress: progress}); err != nil {
					return err
				}
			}
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
}

// ResolveContainerID returns the Docker container used for Gauge on macOS.
func ResolveContainerID(ctx context.Context, containerName, bunxPath string) (string, error) {
	docker, err := exec.LookPath("docker")
	if err != nil {
		return "", fmt.Errorf("docker CLI not found. Make sure Docker/OrbStack is installed")
	}

	if strings.TrimSpace(containerName) != "" {
		out, err := exec.CommandContext(ctx, docker, "ps", "--filter", "name="+containerName, "--format", "{{.ID}}").Output()
		if err != nil {
			return "", err
		}
		ids := nonEmptyLines(string(out))
		if len(ids) == 0 {
			return "", fmt.Errorf("Container '%s' is not running. Check the container name in Settings.", containerName)
		}
		return ids[0], nil
	}

	out, err := exec.CommandContext(ctx, docker, "ps", "--filter", "label=devcontainer.local_folder", "--format", "{{.ID}}").Output()
	if err != nil {
		return "", err
	}
	ids := nonEmptyLines(string(out))
	if len(ids) == 0 {
		return "", fmt.Errorf("No VS Code devcontainer found. Open this project in VS Code with the Remote - Containers extension, or set a container name in Settings.")
	}

	for _, id := range ids {
		check := exec.CommandContext(ctx, docker, "exec", id, "test", "-f", bunxPath)
		if err := check.Run(); err == nil {
			return id, nil
		}
	}
	return ids[0], nil
}

// ClassifyProgressLine ports run.py:_classify_progress_line.
func ClassifyProgressLine(line string) (Progress, bool) {
	stripped := strings.TrimRight(line, "\n")
	if strings.TrimSpace(stripped) == "" {
		return Progress{}, false
	}

	statusFrom := func(text string) string {
		switch {
		case crossRE.MatchString(text):
			return "failed"
		case tickRE.MatchString(text):
			return "passed"
		default:
			return "running"
		}
	}
	clean := func(text string) string {
		text = tickRE.ReplaceAllString(text, "")
		text = crossRE.ReplaceAllString(text, "")
		return strings.TrimSpace(text)
	}

	if m := stepLineRE.FindStringSubmatch(stripped); m != nil {
		return Progress{Level: "step", Text: clean(m[1]), Status: statusFrom(stripped)}, true
	}
	if m := scenarioLineRE.FindStringSubmatch(stripped); m != nil {
		return Progress{Level: "scenario", Text: clean(m[1]), Status: "running"}, true
	}
	if m := specLineRE.FindStringSubmatch(stripped); m != nil {
		return Progress{Level: "spec", Text: strings.TrimSpace(m[1]), Status: "running"}, true
	}
	return Progress{}, false
}

func withPrependedPath(env []string, dir string) []string {
	out := make([]string, 0, len(env)+1)
	found := false
	for _, item := range env {
		if strings.HasPrefix(item, "PATH=") {
			out = append(out, "PATH="+dir+":"+strings.TrimPrefix(item, "PATH="))
			found = true
			continue
		}
		out = append(out, item)
	}
	if !found {
		out = append(out, "PATH="+dir)
	}
	return out
}

func nonEmptyLines(s string) []string {
	var out []string
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			out = append(out, line)
		}
	}
	return out
}

func shellQuote(s string) string {
	if s == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}

// Report is the compact shape emitted by run.py:_load_json_report.
type Report struct {
	Specs            []SpecReport `json:"specs"`
	PassedScenarios  int          `json:"passed_scenarios"`
	FailedScenarios  int          `json:"failed_scenarios"`
	SkippedScenarios int          `json:"skipped_scenarios"`
}

type SpecReport struct {
	Heading   string           `json:"heading"`
	FileName  string           `json:"file_name"`
	Status    string           `json:"status"`
	Scenarios []ScenarioReport `json:"scenarios"`
}

type ScenarioReport struct {
	Heading     string       `json:"heading"`
	Status      string       `json:"status"`
	Steps       []StepReport `json:"steps"`
	HookFailure *HookFailure `json:"hook_failure"`
}

type StepReport struct {
	Text         string  `json:"text"`
	Status       string  `json:"status"`
	Line         *int    `json:"line"`
	ErrorMessage *string `json:"error_message,omitempty"`
	StackTrace   *string `json:"stack_trace,omitempty"`
}

type HookFailure struct {
	ErrorMessage string `json:"error_message"`
	StackTrace   string `json:"stack_trace"`
}

// LoadJSONReport reads .gauge/reports/json-report/result.json.
func LoadJSONReport(smartContractsDir string) *Report {
	raw, err := os.ReadFile(filepath.Join(smartContractsDir, ".gauge", "reports", "json-report", "result.json"))
	if err != nil {
		return nil
	}

	var gauge gaugeReport
	if err := json.Unmarshal(raw, &gauge); err != nil {
		return nil
	}

	report := &Report{
		Specs:            make([]SpecReport, 0, len(gauge.SpecResults)),
		PassedScenarios:  gauge.PassedScenariosCount,
		FailedScenarios:  gauge.FailedScenariosCount,
		SkippedScenarios: gauge.SkippedScenariosCount,
	}
	for _, spec := range gauge.SpecResults {
		specOut := SpecReport{
			Heading:   spec.SpecHeading,
			FileName:  spec.FileName,
			Status:    defaultString(spec.ExecutionStatus, "notExecuted"),
			Scenarios: make([]ScenarioReport, 0, len(spec.Scenarios)),
		}
		for _, scenario := range spec.Scenarios {
			scenarioOut := ScenarioReport{
				Heading: scenario.ScenarioHeading,
				Status:  defaultString(scenario.ExecutionStatus, "notExecuted"),
				Steps:   []StepReport{},
			}
			for _, item := range scenario.Items {
				if item.ItemType != "step" {
					continue
				}
				status := "notExecuted"
				if item.Result != nil {
					status = defaultString(item.Result.Status, "notExecuted")
				}
				step := StepReport{
					Text:   item.StepText,
					Status: status,
					Line:   nil,
				}
				if item.Span != nil {
					step.Line = item.Span.Start
				}
				if status == "failed" {
					errMsg, stack := "", ""
					if item.Result != nil {
						errMsg = item.Result.ErrorMessage
						stack = item.Result.StackTrace
					}
					step.ErrorMessage = &errMsg
					step.StackTrace = &stack
				}
				scenarioOut.Steps = append(scenarioOut.Steps, step)
			}
			if scenario.AfterScenarioHookFailure != nil {
				scenarioOut.HookFailure = &HookFailure{
					ErrorMessage: scenario.AfterScenarioHookFailure.ErrorMessage,
					StackTrace:   scenario.AfterScenarioHookFailure.StackTrace,
				}
			}
			specOut.Scenarios = append(specOut.Scenarios, scenarioOut)
		}
		report.Specs = append(report.Specs, specOut)
	}
	return report
}

func defaultString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

type gaugeReport struct {
	SpecResults           []gaugeSpecResult `json:"specResults"`
	PassedScenariosCount  int               `json:"passedScenariosCount"`
	FailedScenariosCount  int               `json:"failedScenariosCount"`
	SkippedScenariosCount int               `json:"skippedScenariosCount"`
}

type gaugeSpecResult struct {
	SpecHeading     string          `json:"specHeading"`
	FileName        string          `json:"fileName"`
	ExecutionStatus string          `json:"executionStatus"`
	Scenarios       []gaugeScenario `json:"scenarios"`
}

type gaugeScenario struct {
	ScenarioHeading          string            `json:"scenarioHeading"`
	ExecutionStatus          string            `json:"executionStatus"`
	Items                    []gaugeItem       `json:"items"`
	AfterScenarioHookFailure *gaugeHookFailure `json:"afterScenarioHookFailure"`
}

type gaugeItem struct {
	ItemType string       `json:"itemType"`
	StepText string       `json:"stepText"`
	Result   *gaugeResult `json:"result"`
	Span     *gaugeSpan   `json:"span"`
}

type gaugeResult struct {
	Status       string `json:"status"`
	ErrorMessage string `json:"errorMessage"`
	StackTrace   string `json:"stackTrace"`
}

type gaugeSpan struct {
	Start *int `json:"start"`
}

type gaugeHookFailure struct {
	ErrorMessage string `json:"errorMessage"`
	StackTrace   string `json:"stackTrace"`
}
