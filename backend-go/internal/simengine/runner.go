package simengine

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"viewer/internal/settings"
	"viewer/internal/specdoc"
)

type lineEvent struct {
	Line  string `json:"line"`
	Error *bool  `json:"error,omitempty"`
}

type progressEvent struct {
	Progress progress `json:"progress"`
}

type progress struct {
	Level  string `json:"level"`
	Text   string `json:"text"`
	Status string `json:"status"`
}

type resultEvent struct {
	Result runReport `json:"result"`
}

type doneEvent struct {
	Done     bool `json:"done"`
	ExitCode int  `json:"exit_code"`
}

type lockedEmitter struct {
	inner EventEmitter
	mu    sync.Mutex
}

func (e *lockedEmitter) Emit(v any) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.inner.Emit(v)
}

// Run executes the native Go simulation pipeline and emits frontend-compatible
// SSE payloads.
func Run(ctx context.Context, emit EventEmitter, specPath string, lineNumber *int) {
	locked := &lockedEmitter{inner: emit}
	exitCode := 0
	report, err := run(ctx, locked, specPath, lineNumber)
	if err != nil {
		exitCode = 1
		truth := true
		_ = locked.Emit(lineEvent{Line: fmt.Sprintf("[native-go] Error: %s\n", err), Error: &truth})
	}
	if report.FailedScenarios > 0 {
		exitCode = 1
	}
	if len(report.Specs) > 0 {
		_ = locked.Emit(resultEvent{Result: report})
	}
	_ = locked.Emit(doneEvent{Done: true, ExitCode: exitCode})
}

func run(ctx context.Context, emit EventEmitter, specPath string, lineNumber *int) (runReport, error) {
	specFile, err := settings.SafeResolve(settings.SpecBase(), specPath)
	if err != nil {
		return runReport{}, err
	}
	raw, err := os.ReadFile(specFile)
	if err != nil {
		return runReport{}, err
	}
	parsed := specdoc.Parse(string(raw))
	scenarios := selectScenarios(parsed.Scenarios, lineNumber)
	if len(scenarios) == 0 {
		return runReport{}, fmt.Errorf("no scenario selected")
	}

	_ = emit.Emit(lineEvent{Line: fmt.Sprintf("[native-go] Running %s (%d scenario(s))\n", specPath, len(scenarios))})
	_ = emit.Emit(progressEvent{Progress: progress{Level: "spec", Text: parsed.Title, Status: "running"}})

	start := time.Now()
	reports := make([]scenarioReport, len(scenarios))
	sem := make(chan struct{}, settings.SimConcurrency())
	var wg sync.WaitGroup
	for i, scenario := range scenarios {
		if ctx.Err() != nil {
			break
		}
		sem <- struct{}{}
		wg.Add(1)
		go func(i int, scenario specdoc.Scenario) {
			defer wg.Done()
			defer func() { <-sem }()
			reports[i] = runScenario(ctx, emit, specPath, parsed.Title, parsed.SetupSteps, scenario)
		}(i, scenario)
	}
	wg.Wait()
	if err := ctx.Err(); err != nil {
		return runReport{}, err
	}

	specStatus := "passed"
	report := runReport{
		Specs: []specReport{{
			Heading:   parsed.Title,
			FileName:  specPath,
			Status:    specStatus,
			Scenarios: reports,
		}},
		TotalDurationMs: float64(time.Since(start).Milliseconds()),
	}
	for _, scenario := range reports {
		if scenario.Status == "failed" {
			report.FailedScenarios++
			specStatus = "failed"
		} else {
			report.PassedScenarios++
		}
	}
	report.Specs[0].Status = specStatus
	return report, nil
}

func runScenario(ctx context.Context, emit EventEmitter, specPath, specTitle string, setup []specdoc.Step, scenario specdoc.Scenario) scenarioReport {
	_ = emit.Emit(lineEvent{Line: fmt.Sprintf("[native-go] ## %s\n", scenario.Name)})
	_ = emit.Emit(progressEvent{Progress: progress{Level: "scenario", Text: scenario.Name, Status: "running"}})

	start := time.Now()
	compiled, err := compileScenario(specPath, specTitle, setup, scenario)
	if err != nil {
		report := compileFailureReport(scenario, err)
		report.DurationMs = float64(time.Since(start).Milliseconds())
		_ = emit.Emit(progressEvent{Progress: progress{Level: "scenario", Text: scenario.Name, Status: "failed"}})
		return report
	}

	response, simErr := simulate(ctx, compiled.Request)
	if artifactErr := writeArtifacts(compiled, response); artifactErr != nil && simErr == nil {
		simErr = artifactErr
	}
	report := buildScenarioReport(compiled, response, simErr)
	report.DurationMs = float64(time.Since(start).Milliseconds())
	_ = emit.Emit(progressEvent{Progress: progress{Level: "scenario", Text: scenario.Name, Status: report.Status}})
	return report
}

func compileFailureReport(scenario specdoc.Scenario, err error) scenarioReport {
	steps := []stepResult{}
	if len(scenario.Steps) == 0 {
		msg := err.Error()
		steps = append(steps, stepResult{Text: scenario.Name, Status: "failed", ErrorMessage: &msg, StackTrace: strPtr("")})
	} else {
		for i, step := range scenario.Steps {
			if i == 0 {
				steps = append(steps, failResult(step, err.Error()))
			} else {
				steps = append(steps, passResult(step))
			}
		}
	}
	return scenarioReport{Heading: scenario.Name, Status: "failed", Steps: steps, HookFailure: nil}
}

func selectScenarios(scenarios []specdoc.Scenario, lineNumber *int) []specdoc.Scenario {
	if lineNumber == nil || *lineNumber == 0 {
		return scenarios
	}
	line := *lineNumber
	for i, scenario := range scenarios {
		start := 0
		if scenario.Line != nil {
			start = *scenario.Line
		}
		end := int(^uint(0) >> 1)
		if i+1 < len(scenarios) && scenarios[i+1].Line != nil {
			end = *scenarios[i+1].Line
		}
		if line >= start && line < end {
			return []specdoc.Scenario{scenario}
		}
	}
	return nil
}
