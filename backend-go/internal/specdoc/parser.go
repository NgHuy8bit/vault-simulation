// Package specdoc parses and serializes Gauge spec markdown — Go port of
// app/services/spec_parser.py and spec_serializer.py.
package specdoc

import (
	"regexp"
	"sort"
	"strings"
)

// Step mirrors the SpecStep pydantic model.
type Step struct {
	Type string `json:"type"`
	Raw  string `json:"raw"`
	Data *Map   `json:"data"`
	Line *int   `json:"line"`
}

type Scenario struct {
	Name  string   `json:"name"`
	Tags  []string `json:"tags"`
	Line  *int     `json:"line"`
	Steps []Step   `json:"steps"`
}

type ParsedSpec struct {
	Title      string     `json:"title"`
	FileTags   []string   `json:"file_tags"`
	SetupSteps []Step     `json:"setup_steps"`
	Scenarios  []Scenario `json:"scenarios"`
}

// rawStep accumulates lines during the first pass.
type rawStep struct {
	text        string
	tableRows   []string
	freeText    string
	sourceLines []string
	line        int
}

func trimTrailingBlank(s *rawStep) {
	for len(s.sourceLines) > 0 && strings.TrimSpace(s.sourceLines[len(s.sourceLines)-1]) == "" {
		s.sourceLines = s.sourceLines[:len(s.sourceLines)-1]
	}
}

// Parse converts spec markdown into the structured form.
func Parse(content string) ParsedSpec {
	type rawScenario struct {
		name  string
		tags  []string
		steps []*rawStep
		line  int
	}

	title := ""
	fileTags := []string{}
	var setupRaw []*rawStep
	var scenarios []*rawScenario
	var current *rawScenario
	var currentStep *rawStep

	targetSteps := func() *[]*rawStep {
		if current != nil {
			return &current.steps
		}
		return &setupRaw
	}

	lines := strings.Split(content, "\n")
	if n := len(lines); n > 0 && lines[n-1] == "" {
		lines = lines[:n-1] // match Python splitlines() for trailing newline
	}

	for i, line := range lines {
		line = strings.TrimSuffix(line, "\r")
		lineNum := i + 1

		if strings.HasPrefix(line, "# ") && !strings.HasPrefix(line, "## ") {
			if currentStep != nil {
				trimTrailingBlank(currentStep)
			}
			title = strings.TrimSpace(line[2:])
			continue
		}

		if strings.HasPrefix(line, "## ") {
			if currentStep != nil {
				trimTrailingBlank(currentStep)
			}
			current = &rawScenario{name: strings.TrimSpace(line[3:]), tags: []string{}, line: lineNum}
			currentStep = nil
			scenarios = append(scenarios, current)
			continue
		}

		stripped := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(stripped, "tags:"):
			if currentStep != nil {
				trimTrailingBlank(currentStep)
			}
			tags := []string{}
			for _, tag := range strings.Split(stripped[5:], ",") {
				if t := strings.TrimSpace(tag); t != "" {
					tags = append(tags, t)
				}
			}
			if current == nil {
				fileTags = tags
			} else {
				current.tags = tags
			}
		case strings.HasPrefix(line, "* "):
			if currentStep != nil {
				trimTrailingBlank(currentStep)
			}
			currentStep = &rawStep{
				text:        strings.TrimSpace(line[2:]),
				sourceLines: []string{line},
				line:        lineNum,
			}
			*targetSteps() = append(*targetSteps(), currentStep)
		case strings.HasPrefix(stripped, "|") && currentStep != nil && currentStep.freeText == "":
			currentStep.tableRows = append(currentStep.tableRows, stripped)
			currentStep.sourceLines = append(currentStep.sourceLines, line)
		case stripped == "" && currentStep != nil:
			currentStep.sourceLines = append(currentStep.sourceLines, line)
		case stripped != "" && !strings.HasPrefix(stripped, "#"):
			// Free-text annotation line — merge into existing free-text block
			// or start a new one.
			if currentStep != nil && currentStep.freeText == "" {
				trimTrailingBlank(currentStep)
				currentStep = nil
			}
			if currentStep != nil && currentStep.freeText != "" {
				currentStep.sourceLines = append(currentStep.sourceLines, line)
			} else {
				free := &rawStep{freeText: stripped, sourceLines: []string{line}}
				*targetSteps() = append(*targetSteps(), free)
				currentStep = free
			}
		}
	}

	parseRawStep := func(s *rawStep) Step {
		trimTrailingBlank(s)
		sourceLines := make([]any, len(s.sourceLines))
		for i, l := range s.sourceLines {
			sourceLines[i] = l
		}
		var linePtr *int
		if s.line > 0 {
			n := s.line
			linePtr = &n
		}
		if s.freeText != "" {
			data := NewMap()
			data.Set("raw_text", s.freeText)
			data.Set("is_free_text", true)
			data.Set("_source_lines", sourceLines)
			return Step{Type: "other", Raw: "", Data: data, Line: linePtr}
		}
		step := parseStep(s.text, s.tableRows)
		step.Data.Set("_source_lines", sourceLines)
		step.Line = linePtr
		return step
	}

	parsedScenarios := make([]Scenario, 0, len(scenarios))
	for _, sc := range scenarios {
		steps := make([]Step, 0, len(sc.steps))
		for _, st := range sc.steps {
			steps = append(steps, parseRawStep(st))
		}
		n := sc.line
		parsedScenarios = append(parsedScenarios, Scenario{
			Name: sc.name, Tags: sc.tags, Line: &n, Steps: steps,
		})
	}

	setupSteps := make([]Step, 0, len(setupRaw))
	for _, st := range setupRaw {
		setupSteps = append(setupSteps, parseRawStep(st))
	}

	return ParsedSpec{
		Title:      title,
		FileTags:   fileTags,
		SetupSteps: setupSteps,
		Scenarios:  parsedScenarios,
	}
}

// ── Step classification ──────────────────────────────────────────────────────

var classifyRes = struct {
	notification, config1, config2, outAuth, inAuth, transfer, settlement,
	pib, balMulti, balance, schedule, paramRejected, derivedParams,
	derivedParamDict, changeInstance, updateVersion, flag, globalParam,
	instrDetail, glDetail, batchDetail, accepted, rejected *regexp.Regexp
}{
	notification:     regexp.MustCompile(`check if the account id .* notification type`),
	config1:          regexp.MustCompile(`set (events time zone|start timestamp|end timestamp|up default|.*time zone)`),
	config2:          regexp.MustCompile(`set up (global environment|.*using parameter as default|default global parameter)`),
	outAuth:          regexp.MustCompile(`outbound authori[sz]`),
	inAuth:           regexp.MustCompile(`inbound authori[sz]`),
	transfer:         regexp.MustCompile(`(make|initiate) a.? transfer`),
	settlement:       regexp.MustCompile(`make a settlement`),
	pib:              regexp.MustCompile(`(make|initiate) a.? (posting instruction batch|instruction batch)`),
	balMulti:         regexp.MustCompile(`check the balances denomination|check the balances with address and denomination`),
	balance:          regexp.MustCompile(`check (the balances|if the balance)`),
	schedule:         regexp.MustCompile(`verify.*expected schedule`),
	paramRejected:    regexp.MustCompile(`verify that the parameter change.*rejected`),
	derivedParams:    regexp.MustCompile(`verify that the (derived )?parameters of account`),
	derivedParamDict: regexp.MustCompile(`verify that the parameter .+ of account`),
	changeInstance:   regexp.MustCompile(`change instance parameter\b`),
	updateVersion:    regexp.MustCompile(`update account id .+ to product version id`),
	flag:             regexp.MustCompile(`set .+ on customer account id`),
	globalParam:      regexp.MustCompile(`(create|init|change) (multiple )?global parameter`),
	instrDetail:      regexp.MustCompile(`verify.*posting instruction detail`),
	glDetail:         regexp.MustCompile(`verify.*gl information.*instruction detail`),
	batchDetail:      regexp.MustCompile(`check batch det`),
	accepted:         regexp.MustCompile(`verify.*\baccepted\b`),
	rejected:         regexp.MustCompile(`verify.*\brejected\b`),
}

func classifyStep(text string) string {
	lowered := strings.ToLower(text)
	contains := func(s string) bool { return strings.Contains(lowered, s) }

	switch {
	case contains("create a new product"):
		return "product"
	case contains("create a new account"):
		return "account"
	case contains("expect no contract notifications"):
		return "no_notifications"
	case classifyRes.notification.MatchString(lowered):
		return "notification"
	case classifyRes.config1.MatchString(lowered), classifyRes.config2.MatchString(lowered):
		return "config"
	case contains("outbound hard settlement"):
		return "outbound"
	case contains("inbound hard settlement"):
		return "inbound"
	case classifyRes.outAuth.MatchString(lowered):
		return "outbound_auth"
	case classifyRes.inAuth.MatchString(lowered):
		return "inbound_auth"
	case contains("auth adjustment"):
		return "auth_adjustment"
	case classifyRes.transfer.MatchString(lowered):
		return "transfer"
	case classifyRes.settlement.MatchString(lowered), contains("settle the transaction"):
		return "settlement"
	case contains("make a release event"), contains("release the transaction"):
		return "release"
	case contains("custom instruction"):
		return "custom_instruction"
	case classifyRes.pib.MatchString(lowered):
		return "posting_instruction_batch"
	case classifyRes.balMulti.MatchString(lowered):
		return "balance_check_multi"
	case classifyRes.balance.MatchString(lowered):
		return "balance_check"
	case classifyRes.schedule.MatchString(lowered):
		return "schedule"
	case classifyRes.paramRejected.MatchString(lowered):
		return "parameter_rejected"
	case classifyRes.derivedParams.MatchString(lowered):
		return "derived_parameters"
	case classifyRes.derivedParamDict.MatchString(lowered):
		return "derived_parameter_dict"
	case contains("change instance parameters"), classifyRes.changeInstance.MatchString(lowered):
		return "change_instance_params"
	case contains("change template parameter"):
		return "change_template_params"
	case contains("update the status of account"):
		return "update_account_status"
	case contains("update account status to pending closure"):
		return "account_close"
	case classifyRes.updateVersion.MatchString(lowered):
		return "update_account_version"
	case contains("assert an exception when closed account"):
		return "exception_msg"
	case contains("create a flag definition event"):
		return "flag_definition"
	case classifyRes.flag.MatchString(lowered):
		return "flag"
	case classifyRes.globalParam.MatchString(lowered):
		return "global_param"
	case classifyRes.instrDetail.MatchString(lowered), classifyRes.glDetail.MatchString(lowered):
		return "instruction_detail_check"
	case classifyRes.batchDetail.MatchString(lowered):
		return "batch_detail_check"
	case classifyRes.accepted.MatchString(lowered):
		return "accepted"
	case classifyRes.rejected.MatchString(lowered):
		return "rejected"
	}
	return "other"
}

// ── Step parsing ─────────────────────────────────────────────────────────────

var (
	amountDenomRe = regexp.MustCompile(`"([\d_,.]+)"\s+"([A-Z]+)"`)
	authAdjRe     = regexp.MustCompile(`(?i)auth adjustment "([^"]+)"`)
	settleAmtRe1  = regexp.MustCompile(`(?i)amount of "([^"]+)"`)
	settleAmtRe2  = regexp.MustCompile(`(?i)Settlement of "([^"]+)"`)
	initiateBatRe = regexp.MustCompile(`initiate an? instruction batch`)
	tableSepRe    = regexp.MustCompile(`^[\|\s\-:]+$`)
)

func first(pattern, text string) string { return firstDef(pattern, text, "") }

func firstDef(pattern, text, def string) string {
	re := regexp.MustCompile("(?i)" + pattern)
	if m := re.FindStringSubmatch(text); m != nil {
		return m[1]
	}
	return def
}

func cleanAmount(value string) string {
	if value == "" {
		value = "0"
	}
	return strings.NewReplacer("_", "", ",", "").Replace(value)
}

func parseStep(text string, tableRows []string) Step {
	stepType := classifyStep(text)
	table := parseTable(tableRows)
	data := NewMap()

	switch stepType {
	case "config":
		parseConfig(text, data)
	case "product":
		data.Set("name", first(`product name "([^"]+)"`, text))
		data.Set("version_id", firstDef(`product version ID "([^"]+)"`, text, "1"))
		data.Set("params", nameValueRows(table))
		if len(table) > 0 {
			data.Set("template_mode", "specify")
		} else {
			data.Set("template_mode", "default")
		}
	case "account":
		data.Set("account_id", first(`account with the ID "([^"]+)"`, text))
		data.Set("version_id", firstDef(`product version ID "([^"]+)"`, text, "1"))
		data.Set("params", nameValueRows(table))
		data.Set("parameter_values", parameterValueRows(table))
		switch {
		case strings.Contains(strings.ToLower(text), "specify parameter values"):
			data.Set("account_param_mode", "parameter_values")
		case len(table) > 0:
			data.Set("account_param_mode", "instance_params")
		default:
			data.Set("account_param_mode", "default")
		}
	case "balance_check":
		parseBalanceCheck(text, table, data)
	case "balance_check_multi":
		parseBalanceCheckMulti(text, table, data)
	case "inbound", "outbound":
		parseHardSettlement(text, table, stepType == "inbound", data)
	case "inbound_auth":
		setAmountDenom(text, data)
		data.Set("internal_account_id", first(`from internal account ID "([^"]+)"`, text))
		data.Set("customer_account_id", first(`to customer account ID "([^"]+)"`, text))
		data.Set("instruction_detail", keyValueRows(table))
	case "outbound_auth":
		setAmountDenom(text, data)
		data.Set("customer_account_id", first(`from customer account ID "([^"]+)"`, text))
		data.Set("internal_account_id", first(`to internal account ID "([^"]+)"`, text))
		data.Set("client_transaction_id", first(`with (?:transaction ID|client_transaction_id) "([^"]+)"`, text))
		data.Set("instruction_detail", keyValueRows(table))
	case "transfer":
		setAmountDenom(text, data)
		data.Set("debtor_account_id", first(`from debtor account ID "([^"]+)"`, text))
		data.Set("creditor_account_id", first(`to creditor account ID "([^"]+)"`, text))
		data.Set("instruction_detail", keyValueRows(table))
	case "settlement":
		data.Set("timestamp", first(`At "([^"]+)"`, text))
		amount := ""
		if m := settleAmtRe1.FindStringSubmatch(text); m != nil {
			amount = m[1]
		} else if m := settleAmtRe2.FindStringSubmatch(text); m != nil {
			amount = m[1]
		}
		data.Set("amount", cleanAmount(amount))
		data.Set("client_transaction_id", first(`(?:transaction ID|client transaction ID) "([^"]+)"`, text))
		data.Set("instruction_detail", keyValueRows(table))
	case "release":
		data.Set("timestamp", first(`At "([^"]+)"`, text))
		data.Set("client_transaction_id", first(`(?:transaction ID|client transaction ID) "([^"]+)"`, text))
		data.Set("instruction_detail", keyValueRows(table))
	case "custom_instruction":
		setAmountDenom(text, data)
		data.Set("debtor_account_id", first(`from debtor account ID "([^"]+)"`, text))
		data.Set("debtor_account_address", first(`with address "([^"]+)"`, text))
		data.Set("creditor_account_id", first(`to creditor account ID "([^"]+)"`, text))
		data.Set("creditor_account_address", first(`to creditor account ID "[^"]+" with address "([^"]+)"`, text))
		data.Set("instruction_detail", keyValueRows(table))
	case "posting_instruction_batch":
		data.Set("timestamp", first(`At "([^"]+)"`, text))
		if initiateBatRe.MatchString(strings.ToLower(text)) {
			data.Set("variant", "initiate")
		} else {
			data.Set("variant", "make")
		}
		data.Set("instructions", tableAsAny(table))
		data.Set("raw_text", text)
	case "auth_adjustment":
		data.Set("timestamp", first(`At "([^"]+)"`, text))
		amount := ""
		if m := authAdjRe.FindStringSubmatch(text); m != nil {
			amount = m[1]
		}
		data.Set("amount", cleanAmount(amount))
		data.Set("client_transaction_id", first(`client transaction ID "([^"]+)"`, text))
	case "accepted":
		data.Set("timestamp", first(`At "([^"]+)"`, text))
		data.Set("account_id", first(`account ID "([^"]+)"`, text))
	case "rejected", "parameter_rejected":
		data.Set("timestamp", first(`At "([^"]+)"`, text))
		data.Set("account_id", first(`account ID "([^"]+)"`, text))
		data.Set("rejection_type", firstDef(`rejected due to "([^"]+)"`, text, "AgainstTermsAndConditions"))
		data.Set("rejection_reason", first(`with reason "([^"]+)"`, text))
	case "notification":
		data.Set("timestamp", first(`At "([^"]+)"`, text))
		data.Set("account_id", first(`account ID "([^"]+)"`, text))
		data.Set("notification_type", first(`notification type "([^"]+)"`, text))
		data.Set("notification_details", keyValueRows(table))
		data.Set("expected", !strings.Contains(strings.ToLower(text), "has no notification type"))
	case "no_notifications":
		// empty data
	case "schedule":
		data.Set("timestamp", first(`At "([^"]+)"`, text))
		data.Set("account_id", first(`account ID "([^"]+)"`, text))
		data.Set("event_id", first(`event "([^"]+)"`, text))
	case "derived_parameters":
		data.Set("timestamp", first(`At "([^"]+)"`, text))
		data.Set("account_id", first(`account ID "([^"]+)"`, text))
		data.Set("rows", nameValueRows(table))
	case "derived_parameter_dict":
		data.Set("timestamp", first(`At "([^"]+)"`, text))
		data.Set("param_name", first(`parameter "([^"]+)"`, text))
		data.Set("account_id", first(`account ID "([^"]+)"`, text))
		rows := make([]any, 0, len(table))
		for _, r := range table {
			row := NewMap()
			row.Set("key", r.GetStr("key", ""))
			row.Set("value", r.GetStr("value", ""))
			rows = append(rows, row)
		}
		data.Set("rows", rows)
	case "change_instance_params":
		data.Set("timestamp", first(`At "([^"]+)"`, text))
		data.Set("account_id", first(`(?:account ID|of) "([^"]+)"`, text))
		rows := nameValueRows(table)
		// Inline single-param form: "...parameter "X" of "ACCOUNT" to "Y"."
		if len(rows) == 0 {
			paramName := first(`\bparameter "([^"]+)"`, text)
			paramVal := first(`\bto "([^"]+)"`, text)
			if paramName != "" {
				row := NewMap()
				row.Set("name", paramName)
				row.Set("value", paramVal)
				rows = append(rows, row)
			}
		}
		data.Set("params", rows)
	case "change_template_params":
		data.Set("timestamp", first(`At "([^"]+)"`, text))
		data.Set("product_version_id", first(`product version ID "([^"]+)"`, text))
		rows := nameValueRows(table)
		// Inline single-param form: "...parameter "X" to "Y"."
		if len(rows) == 0 {
			paramName := first(`\bparameter "([^"]+)"`, text)
			paramVal := first(`\bto "([^"]+)"`, text)
			if paramName != "" {
				row := NewMap()
				row.Set("name", paramName)
				row.Set("value", paramVal)
				rows = append(rows, row)
			}
		}
		data.Set("params", rows)
	case "update_account_status":
		data.Set("timestamp", first(`At "([^"]+)"`, text))
		data.Set("account_id", first(`account ID "([^"]+)"`, text))
		data.Set("status", first(`\bto "([^"]+)"`, text))
	case "account_close":
		data.Set("timestamp", first(`At "([^"]+)"`, text))
		data.Set("account_id", first(`account ID "([^"]+)"`, text))
	case "update_account_version":
		data.Set("timestamp", first(`At "([^"]+)"`, text))
		data.Set("account_id", first(`account ID "([^"]+)"`, text))
		data.Set("product_version_id", first(`product version ID "([^"]+)"`, text))
	case "exception_msg":
		data.Set("message", first(`with message "([^"]+)"`, text))
	case "flag_definition":
		data.Set("timestamp", first(`At "([^"]+)"`, text))
		data.Set("flag_name", first(`for "([^"]+)"`, text))
	case "flag":
		data.Set("timestamp", first(`At "([^"]+)"`, text))
		data.Set("flag_name", first(`set "([^"]+)"`, text))
		data.Set("account_id", first(`account ID "([^"]+)"`, text))
		data.Set("expiry_timestamp", first(`expiry date of "([^"]+)"`, text))
	case "global_param":
		name := first(`parameter ID "([^"]+)"`, text)
		if name == "" {
			name = first(`parameter "([^"]+)"`, text)
		}
		if name == "" {
			name = first(`global parameter (\S+)`, text)
		}
		value := first(`value "([^"]+)"`, text)
		if value == "" {
			value = first(`\bvalue\b\s+"([^"]+)"`, text)
		}
		timestamp := first(`At "([^"]+)"`, text)
		if timestamp == "" {
			timestamp = first(`start "([^"]+)"`, text)
		}
		data.Set("timestamp", timestamp)
		data.Set("name", name)
		data.Set("value", value)
		data.Set("rows", tableAsAny(table))
		if len(table) == 0 {
			data.Set("raw_text", text)
		} else {
			data.Set("raw_text", nil)
		}
	case "instruction_detail_check", "batch_detail_check":
		data.Set("timestamp", first(`At "([^"]+)"`, text))
		data.Set("rows", tableAsAny(table))
	default:
		data.Set("raw_text", text)
	}

	return Step{Type: stepType, Raw: text, Data: data}
}

func setAmountDenom(text string, data *Map) {
	data.Set("timestamp", first(`At "([^"]+)"`, text))
	if m := amountDenomRe.FindStringSubmatch(text); m != nil {
		data.Set("amount", cleanAmount(m[1]))
		data.Set("denomination", m[2])
	} else {
		data.Set("amount", cleanAmount(""))
		data.Set("denomination", "VND")
	}
}

func parseConfig(text string, data *Map) {
	timezone := first(`time zone "([^"]+)"`, text)
	start := first(`start timestamp at "([^"]+)"`, text)
	end := first(`end timestamp at "([^"]+)"`, text)
	switch {
	case timezone != "":
		data.Set("key", "timezone")
		data.Set("value", timezone)
	case start != "":
		data.Set("key", "start_timestamp")
		data.Set("value", start)
	case end != "":
		data.Set("key", "end_timestamp")
		data.Set("value", end)
	default:
		data.Set("key", "global_param")
		data.Set("value", text)
	}
}

func parseBalanceCheck(text string, table []*Map, data *Map) {
	accountID := first(`account "([^"]+)"`, text)
	denomination := firstDef(`denomination "([^"]+)"`, text, "VND")
	atTS := first(`At "([^"]+)"`, text)
	rows := make([]any, 0, len(table))
	for _, row := range table {
		r := NewMap()
		r.Set("timestamp", row.GetStr("timestamp", atTS))
		r.Set("account_id", row.GetStr("account_id", accountID))
		r.Set("address", row.GetStr("address", ""))
		r.Set("denomination", row.GetStr("denomination", denomination))
		r.Set("phase", row.GetStr("phase", "POSTING_PHASE_COMMITTED"))
		r.Set("asset", row.GetStr("asset", "COMMERCIAL_BANK_MONEY"))
		r.Set("balance", row.GetStr("balance", "0"))
		rows = append(rows, r)
	}
	sortRowsByTimestamp(rows)
	data.Set("denomination", denomination)
	data.Set("rows", rows)
}

func parseBalanceCheckMulti(text string, table []*Map, data *Map) {
	denomination := firstDef(`denomination "([^"]+)"`, text, "VND")
	rows := make([]any, 0, len(table))
	for _, row := range table {
		r := NewMap()
		r.Set("timestamp", row.GetStr("timestamp", ""))
		r.Set("account_id", row.GetStr("account_id", ""))
		r.Set("address", row.GetStr("address", ""))
		r.Set("denomination", row.GetStr("denomination", denomination))
		r.Set("phase", row.GetStr("phase", "POSTING_PHASE_COMMITTED"))
		r.Set("asset", row.GetStr("asset", "COMMERCIAL_BANK_MONEY"))
		r.Set("balance", row.GetStr("balance", "0"))
		rows = append(rows, r)
	}
	sortRowsByTimestamp(rows)
	data.Set("denomination", denomination)
	data.Set("rows", rows)
}

func sortRowsByTimestamp(rows []any) {
	sort.SliceStable(rows, func(i, j int) bool {
		mi, _ := rows[i].(*Map)
		mj, _ := rows[j].(*Map)
		return mi.GetStr("timestamp", "") < mj.GetStr("timestamp", "")
	})
}

func parseHardSettlement(text string, table []*Map, inbound bool, data *Map) {
	setAmountDenom(text, data)
	if inbound {
		data.Set("from_account", first(`from internal account ID "([^"]+)"`, text))
		data.Set("to_account", first(`to customer account ID "([^"]+)"`, text))
	} else {
		data.Set("from_account", first(`from customer account ID "([^"]+)"`, text))
		data.Set("to_account", first(`to internal account ID "([^"]+)"`, text))
	}
	data.Set("instruction_detail", keyValueRows(table))
}

// ── Table helpers ────────────────────────────────────────────────────────────

func parseTable(rows []string) []*Map {
	if len(rows) == 0 {
		return nil
	}
	header := parseTableRow(rows[0])
	var parsed []*Map
	for _, row := range rows[1:] {
		if tableSepRe.MatchString(row) {
			continue
		}
		cells := parseTableRow(row)
		for len(cells) < len(header) {
			cells = append(cells, "")
		}
		m := NewMap()
		for i, h := range header {
			m.Set(h, cells[i])
		}
		parsed = append(parsed, m)
	}
	return parsed
}

func parseTableRow(row string) []string {
	trimmed := strings.Trim(strings.TrimSpace(row), "|")
	parts := strings.Split(trimmed, "|")
	out := make([]string, len(parts))
	for i, p := range parts {
		out[i] = strings.TrimSpace(p)
	}
	return out
}

func tableAsAny(table []*Map) []any {
	out := make([]any, len(table))
	for i, m := range table {
		out[i] = m
	}
	return out
}

func keyValueRows(table []*Map) []any {
	out := make([]any, 0, len(table))
	for _, row := range table {
		m := NewMap()
		m.Set("key", row.GetStr("key", row.GetStr("name", "")))
		m.Set("value", row.GetStr("value", ""))
		out = append(out, m)
	}
	return out
}

func nameValueRows(table []*Map) []any {
	out := make([]any, 0, len(table))
	for _, row := range table {
		m := NewMap()
		for _, k := range row.Keys() {
			v, _ := row.Get(k)
			m.Set(k, v)
		}
		out = append(out, m)
	}
	return out
}

func parameterValueRows(table []*Map) []any {
	out := []any{}
	for _, row := range table {
		if !row.Has("constraint") {
			continue
		}
		m := NewMap()
		m.Set("name", row.GetStr("name", ""))
		m.Set("constraint", row.GetStr("constraint", ""))
		m.Set("value", row.GetStr("value", ""))
		out = append(out, m)
	}
	return out
}
