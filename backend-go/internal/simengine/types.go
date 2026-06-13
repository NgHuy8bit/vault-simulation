package simengine

import (
	"encoding/json"
	"time"

	"viewer/internal/specdoc"
)

type EventEmitter interface {
	Emit(any) error
}

type runRequest struct {
	SpecPath   string
	LineNumber *int
}

type compiledScenario struct {
	SpecPath       string
	SpecTitle      string
	Scenario       specdoc.Scenario
	Timezone       string
	Start          time.Time
	End            time.Time
	Request        map[string]any
	Checks         []expectation
	StepByLine     map[int]int
	CompileNotices []stepResult
}

type simulationEvent struct {
	Time  time.Time
	Event map[string]any
	Order int
	Line  *int
}

type expectation struct {
	Kind string
	Step specdoc.Step
	Data map[string]any
}

type stepResult struct {
	Text         string  `json:"text"`
	Status       string  `json:"status"`
	Line         *int    `json:"line"`
	ErrorMessage *string `json:"error_message,omitempty"`
	StackTrace   *string `json:"stack_trace,omitempty"`
}

type scenarioReport struct {
	Heading     string       `json:"heading"`
	Status      string       `json:"status"`
	Steps       []stepResult `json:"steps"`
	HookFailure any          `json:"hook_failure"`
	DurationMs  float64      `json:"duration_ms"`
}

type specReport struct {
	Heading   string           `json:"heading"`
	FileName  string           `json:"file_name"`
	Status    string           `json:"status"`
	Scenarios []scenarioReport `json:"scenarios"`
}

type runReport struct {
	Specs            []specReport `json:"specs"`
	PassedScenarios  int          `json:"passed_scenarios"`
	FailedScenarios  int          `json:"failed_scenarios"`
	SkippedScenarios int          `json:"skipped_scenarios"`
	TotalDurationMs  float64      `json:"total_duration_ms"`
}

func failResult(step specdoc.Step, msg string) stepResult {
	return stepResult{
		Text:         step.Raw,
		Status:       "failed",
		Line:         step.Line,
		ErrorMessage: &msg,
		StackTrace:   strPtr(""),
	}
}

func passResult(step specdoc.Step) stepResult {
	return stepResult{Text: step.Raw, Status: "passed", Line: step.Line}
}

func strPtr(s string) *string { return &s }

func cloneStringMap(in map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range in {
		out[k] = v
	}
	return out
}

func jsonRaw(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
