package simengine

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"viewer/internal/omap"
	"viewer/internal/settings"
	"viewer/internal/specdoc"
)

func compileScenario(specPath, specTitle string, setup []specdoc.Step, scenario specdoc.Scenario) (compiledScenario, error) {
	defs, err := loadProductDefaults()
	if err != nil {
		return compiledScenario{}, err
	}

	state := &compileState{
		defs:           defs,
		specPath:       specPath,
		specTitle:      specTitle,
		scenario:       scenario,
		timezone:       "UTC",
		productConfigs: map[string]*productConfig{},
		stepByLine:     map[int]int{},
	}
	steps := append([]specdoc.Step{}, setup...)
	steps = append(steps, scenario.Steps...)
	for idx, step := range scenario.Steps {
		if step.Line != nil {
			state.stepByLine[*step.Line] = idx
		}
	}
	for _, step := range steps {
		if err := state.applyStep(step); err != nil {
			state.compileNotices = append(state.compileNotices, failResult(step, err.Error()))
		}
	}
	if len(state.timestamps) == 0 {
		return compiledScenario{}, fmt.Errorf("scenario %q has no timestamps", scenario.Name)
	}
	sort.SliceStable(state.timestamps, func(i, j int) bool { return state.timestamps[i].Before(state.timestamps[j]) })
	start := state.timestamps[0]
	end := state.timestamps[len(state.timestamps)-1].Add(time.Second)

	for _, pc := range state.productOrder {
		code, err := loadContract(settings.SmartContractsDir(), pc.Info, state.timezone)
		if err != nil {
			return compiledScenario{}, err
		}
		pc.ContractContents = code
	}

	request := state.buildRequest(start, end)
	return compiledScenario{
		SpecPath:       specPath,
		SpecTitle:      specTitle,
		Scenario:       scenario,
		Timezone:       state.timezone,
		Start:          start,
		End:            end,
		Request:        request,
		Checks:         state.checks,
		StepByLine:     state.stepByLine,
		CompileNotices: state.compileNotices,
	}, nil
}

type compileState struct {
	defs           productDefaults
	specPath       string
	specTitle      string
	scenario       specdoc.Scenario
	timezone       string
	productConfigs map[string]*productConfig
	productOrder   []*productConfig
	events         []simulationEvent
	checks         []expectation
	timestamps     []time.Time
	order          int
	stepByLine     map[int]int
	compileNotices []stepResult
	msgException   string
}

func (s *compileState) applyStep(step specdoc.Step) error {
	data := step.Data
	switch step.Type {
	case "config":
		key := data.GetStrOr("key", "")
		switch key {
		case "timezone":
			s.timezone = data.GetStrOr("value", "UTC")
		case "start_timestamp", "end_timestamp":
			ts, err := parseScenarioTime(data.GetStrOr("value", ""), s.timezone)
			if err != nil {
				return err
			}
			s.timestamps = append(s.timestamps, ts)
		case "global_param":
			return s.applyConceptStep(data.GetStrOr("value", ""))
		}
	case "product":
		return s.addProduct(step)
	case "account":
		return s.addAccount(step)
	case "inbound", "outbound", "inbound_auth", "outbound_auth", "transfer", "settlement", "release", "custom_instruction", "posting_instruction_batch", "auth_adjustment", "change_instance_params", "change_template_params", "update_account_status", "account_close", "update_account_version", "flag_definition", "flag", "global_param":
		return s.addEventStep(step)
	case "balance_check", "balance_check_multi", "instruction_detail_check", "batch_detail_check", "notification", "no_notifications", "schedule", "parameter_rejected", "derived_parameters", "derived_parameter_dict", "accepted", "rejected":
		s.addCheck(step)
	case "exception_msg":
		s.msgException = data.GetStrOr("message", "")
	default:
		// Free-text notes are not executable Gauge steps; keep them out of the native report.
	}
	return nil
}

func (s *compileState) applyConceptStep(text string) error {
	// Try product-specific concept file first (old path).
	if productName := defaultGlobalParamProduct(text); productName != "" {
		path := filepath.Join(settings.SmartContractsDir(), "specs", productName, "concept_steps", "set_up_default_global_parameter_value.cpt")
		if err := s.expandConceptFile(path); err == nil {
			return nil
		}
	}
	// General concept lookup: search for a .cpt file whose heading matches.
	return s.findAndExpandConcept(text)
}

// expandConceptFile reads and applies all setup steps from a .cpt file.
func (s *compileState) expandConceptFile(path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	parsed := specdoc.Parse(string(raw))
	for _, step := range parsed.SetupSteps {
		if err := s.applyStep(step); err != nil {
			return err
		}
	}
	return nil
}

// findAndExpandConcept walks the specs/ directory searching for a .cpt file whose
// title (first # heading) matches the concept step text (case-insensitive).
func (s *compileState) findAndExpandConcept(text string) error {
	specsDir := filepath.Join(settings.SmartContractsDir(), "specs")
	needle := strings.ToLower(strings.TrimSpace(text))
	var found string
	_ = filepath.WalkDir(specsDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".cpt") {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		parsed := specdoc.Parse(string(raw))
		if strings.ToLower(strings.TrimSpace(parsed.Title)) == needle {
			found = path
			return filepath.SkipAll
		}
		return nil
	})
	if found == "" {
		return nil // concept not found — not an error (free-text step)
	}
	return s.expandConceptFile(found)
}

func defaultGlobalParamProduct(text string) string {
	lowered := strings.ToLower(strings.TrimSpace(text))
	const prefix = "set up default global parameter value for "
	if !strings.HasPrefix(lowered, prefix) {
		return ""
	}
	product := strings.TrimPrefix(lowered, prefix)
	product = strings.TrimSuffix(product, ".")
	product = strings.TrimSuffix(product, " account")
	product = strings.TrimSpace(product)
	return strings.ReplaceAll(product, " ", "_")
}

func (s *compileState) addProduct(step specdoc.Step) error {
	name := step.Data.GetStrOr("name", "")
	versionID := step.Data.GetStrOr("version_id", "1")
	if _, exists := s.productConfigs[versionID]; exists {
		return fmt.Errorf("duplicated product version id %s", versionID)
	}
	info, ok := s.defs.product(name)
	if !ok {
		return fmt.Errorf("unknown product %q", name)
	}
	params := cloneStringMap(info.TemplateParameters)
	for k, v := range rowsToMap(step.Data.GetList("params")) {
		params[k] = v
	}
	pc := &productConfig{
		Info:           info,
		VersionID:      versionID,
		TemplateParams: params,
	}
	s.productConfigs[versionID] = pc
	s.productOrder = append(s.productOrder, pc)
	return nil
}

func (s *compileState) addAccount(step specdoc.Step) error {
	versionID := step.Data.GetStrOr("version_id", "1")
	pc := s.productConfigs[versionID]
	if pc == nil {
		return fmt.Errorf("unknown product version ID %s", versionID)
	}
	if step.Data.GetStrOr("account_param_mode", "") == "parameter_values" {
		return fmt.Errorf("native simulation does not support v2 parameter_values account creation yet")
	}
	params := cloneStringMap(pc.Info.InstanceParameters)
	for k, v := range rowsToMap(step.Data.GetList("params")) {
		params[k] = v
	}
	pc.AccountConfigs = append(pc.AccountConfigs, accountConfig{
		AccountID:      step.Data.GetStrOr("account_id", ""),
		InstanceParams: params,
	})
	return nil
}

func (s *compileState) addEventStep(step specdoc.Step) error {
	events, err := s.eventsFromStep(step)
	if err != nil {
		return err
	}
	for _, ev := range events {
		s.events = append(s.events, ev)
		if !ev.Time.IsZero() {
			s.timestamps = append(s.timestamps, ev.Time)
		}
	}
	return nil
}

func (s *compileState) addCheck(step specdoc.Step) {
	kind := step.Type
	data := map[string]any{}
	if step.Data != nil {
		for _, k := range step.Data.Keys() {
			v, _ := step.Data.Get(k)
			data[k] = v
		}
	}
	s.checks = append(s.checks, expectation{Kind: kind, Step: step, Data: data})
	for _, tsValue := range timestampsFromCheck(step) {
		if ts, err := parseScenarioTime(tsValue, s.timezone); err == nil {
			s.timestamps = append(s.timestamps, ts)
		}
	}
}

func timestampsFromCheck(step specdoc.Step) []string {
	switch step.Type {
	case "balance_check", "balance_check_multi", "derived_parameters":
		var out []string
		for _, item := range step.Data.GetList("rows") {
			if row, ok := item.(*omap.Map); ok {
				out = append(out, row.GetStrOr("timestamp", ""))
			}
		}
		return out
	default:
		return []string{step.Data.GetStrOr("timestamp", "")}
	}
}

func (s *compileState) eventsFromStep(step specdoc.Step) ([]simulationEvent, error) {
	data := step.Data
	tsValue := data.GetStrOr("timestamp", "")
	if step.Type == "global_param" && tsValue == "" {
		mkStart := func(event map[string]any) simulationEvent {
			s.order++
			return simulationEvent{Event: event, Order: s.order, Line: step.Line}
		}
		return s.globalParamEvents(time.Time{}, data, mkStart), nil
	}
	if step.Type != "global_param" && step.Type != "change_instance_params" && tsValue == "" {
		return nil, fmt.Errorf("missing timestamp for %s", step.Type)
	}
	var ts time.Time
	if tsValue != "" {
		var err error
		ts, err = parseScenarioTime(tsValue, s.timezone)
		if err != nil {
			return nil, err
		}
	}

	mk := func(event map[string]any) simulationEvent {
		s.order++
		return simulationEvent{Time: ts, Event: event, Order: s.order, Line: step.Line}
	}

	switch step.Type {
	case "inbound", "outbound", "inbound_auth", "outbound_auth":
		return []simulationEvent{mk(s.transactionEvent(step.Type, data))}, nil
	case "transfer":
		return []simulationEvent{mk(s.transferEvent(data))}, nil
	case "settlement":
		return []simulationEvent{mk(s.settlementEvent(data))}, nil
	case "release":
		return []simulationEvent{mk(s.releaseEvent(data))}, nil
	case "custom_instruction":
		return []simulationEvent{mk(s.customInstructionEvent(data))}, nil
	case "auth_adjustment":
		pi := postingInstruction("authorisation_adjustment", data.GetStrOr("amount", "0"), nil, data.GetStrOr("client_transaction_id", ""), nil)
		return []simulationEvent{mk(postingBatch(ts, []map[string]any{pi}, "", nil, nil, ""))}, nil
	case "posting_instruction_batch":
		return []simulationEvent{mk(s.postingInstructionBatchEvent(ts, data))}, nil
	case "change_instance_params":
		// Rows may include a "timestamp" column; if so, generate one event per row.
		// Otherwise emit a single event at the step-level timestamp.
		accountID := data.GetStrOr("account_id", "")
		var out []simulationEvent
		for _, item := range data.GetList("params") {
			row, ok := item.(*omap.Map)
			if !ok {
				continue
			}
			rowTS := row.GetStrOr("timestamp", "")
			name := row.GetStrOr("name", "")
			if name == "" {
				continue
			}
			value := formatValue(row.GetStrOr("value", ""))
			var evTS time.Time
			if rowTS != "" {
				t, err := parseScenarioTime(rowTS, s.timezone)
				if err != nil {
					return nil, fmt.Errorf("change_instance_params: invalid row timestamp %q: %w", rowTS, err)
				}
				evTS = t
			} else {
				evTS = ts
			}
			s.order++
			if !evTS.IsZero() {
				s.timestamps = append(s.timestamps, evTS)
			}
			out = append(out, simulationEvent{
				Time:  evTS,
				Order: s.order,
				Line:  step.Line,
				Event: map[string]any{"create_account_update": map[string]any{
					"account_id":                 accountID,
					"instance_param_vals_update": map[string]any{"instance_param_vals": map[string]string{name: value}},
				}},
			})
		}
		if len(out) == 0 {
			// fallback: batch all params in one event at step-level timestamp
			out = []simulationEvent{mk(map[string]any{"create_account_update": map[string]any{
				"account_id":                 accountID,
				"instance_param_vals_update": map[string]any{"instance_param_vals": rowsToMap(data.GetList("params"))},
			}})}
		}
		return out, nil
	case "change_template_params":
		var out []simulationEvent
		productVersionID := data.GetStrOr("product_version_id", "0")
		for k, v := range rowsToMap(data.GetList("params")) {
			out = append(out, mk(map[string]any{"update_smart_contract_param": map[string]any{
				"smart_contract_version_id": productVersionID,
				"parameter_name":            k,
				"new_parameter_value":       v,
			}}))
		}
		return out, nil
	case "update_account_status":
		return []simulationEvent{mk(map[string]any{"update_account": map[string]any{"id": data.GetStrOr("account_id", ""), "status": data.GetStrOr("status", "")}})}, nil
	case "account_close":
		return []simulationEvent{mk(map[string]any{"update_account": map[string]any{"id": data.GetStrOr("account_id", ""), "status": "ACCOUNT_STATUS_PENDING_CLOSURE"}})}, nil
	case "update_account_version":
		return []simulationEvent{mk(map[string]any{"create_account_update": map[string]any{
			"account_id":             data.GetStrOr("account_id", ""),
			"product_version_update": map[string]any{"product_version_id": data.GetStrOr("product_version_id", "")},
		}})}, nil
	case "flag_definition":
		return []simulationEvent{mk(map[string]any{"create_flag_definition": map[string]any{"id": data.GetStrOr("flag_name", "")}})}, nil
	case "flag":
		return []simulationEvent{mk(map[string]any{"create_flag": map[string]any{
			"flag_definition_id":  data.GetStrOr("flag_name", ""),
			"effective_timestamp": rfc3339UTC(ts),
			"expiry_timestamp":    data.GetStrOr("expiry_timestamp", ""),
			"account_id":          data.GetStrOr("account_id", ""),
		}})}, nil
	case "global_param":
		return s.globalParamEvents(ts, data, mk), nil
	default:
		return nil, fmt.Errorf("unsupported event step %s", step.Type)
	}
}

func (s *compileState) globalParamEvents(ts time.Time, data *omap.Map, mk func(map[string]any) simulationEvent) []simulationEvent {
	type globalRow struct {
		id    string
		value string
		shape string
		named bool
	}
	var rows []globalRow
	for _, item := range data.GetList("rows") {
		row, ok := item.(*omap.Map)
		if !ok {
			continue
		}
		id := row.GetStrOr("id", row.GetStrOr("key", row.GetStrOr("name", "")))
		if id == "" {
			continue
		}
		value := row.GetStrOr("init_value", row.GetStrOr("value", ""))
		rows = append(rows, globalRow{
			id:    id,
			value: formatValue(value),
			shape: row.GetStrOr("shape", "StringShape()"),
			named: row.Has("id"),
		})
	}
	if len(rows) == 0 && data.GetStrOr("name", "") != "" {
		rows = append(rows, globalRow{
			id:    data.GetStrOr("name", ""),
			value: formatValue(data.GetStrOr("value", "")),
			shape: "StringShape()",
		})
	}
	raw := strings.ToLower(data.GetStrOr("raw_text", ""))
	create := strings.Contains(raw, "create") || strings.Contains(raw, "init")
	if len(rows) > 0 && rows[0].named {
		create = true
	}
	// A single un-named row with an explicit timestamp is a value update, not a definition.
	// "Create global parameter with start '...' parameter ID '...'" should use create_global_parameter_value.
	if len(rows) == 1 && !rows[0].named && !ts.IsZero() {
		create = false
	}
	var out []simulationEvent
	for _, row := range rows {
		if create {
			out = append(out, mk(globalParameterEventWithShape(row.id, row.value, row.shape, row.named)))
		} else {
			out = append(out, mk(map[string]any{"create_global_parameter_value": map[string]any{
				"global_parameter_id": row.id,
				"value":               row.value,
				"effective_timestamp": rfc3339UTC(ts),
			}}))
		}
	}
	return out
}

func (s *compileState) buildRequest(start, end time.Time) map[string]any {
	var smartContracts []any
	for _, pc := range s.productOrder {
		smartContracts = append(smartContracts, map[string]any{
			"code":                      pc.ContractContents,
			"smart_contract_param_vals": pc.TemplateParams,
			"smart_contract_version_id": pc.VersionID,
		})
	}

	// Build internal accounts using active products' t-side definitions first (priority),
	// then fill remaining accounts from the global defaults.
	// This prevents a product processed earlier in the global order (e.g. salary_advance)
	// from overriding the correct t-side for an account also used by the active product (e.g. loan).
	seenInternal := map[string]bool{}
	var internalAccounts []internalAccount
	for _, pc := range s.productOrder {
		for _, id := range pc.Info.InternalAccountOrder {
			if seenInternal[id] {
				continue
			}
			seenInternal[id] = true
			tside := pc.Info.InternalAccounts[id]
			if tside == "" {
				tside = "LIABILITY"
			}
			internalAccounts = append(internalAccounts, internalAccount{ID: id, TSide: tside})
		}
	}
	for _, acc := range s.defs.allInternalAccounts() {
		if seenInternal[acc.ID] {
			continue
		}
		seenInternal[acc.ID] = true
		internalAccounts = append(internalAccounts, acc)
	}

	var internalEvents []simulationEvent
	for _, acc := range internalAccounts {
		versionID := internalVersionID(acc.ID)
		code := s.defs.EmptyLiabilityContractV4
		if acc.TSide == "ASSET" {
			code = s.defs.EmptyAssetContractV4
		}
		smartContracts = append(smartContracts, map[string]any{
			"code":                      code,
			"smart_contract_param_vals": map[string]string{},
			"smart_contract_version_id": versionID,
		})
		internalEvents = append(internalEvents, simulationEvent{
			Time:  start,
			Event: createAccountEvent(acc.ID, versionID, map[string]string{}),
		})
	}

	// Setup phase (always at start, order preserved as appended):
	//   1. Per-product default global parameters (from embedded products_defaults.json)
	//   2. Zero-time s.events  — concept-file global params (must precede account creation)
	//   3. Customer accounts   — after all global parameters are established
	//
	// Timed events (posting batches, param updates, etc.) come after the setup phase,
	// sorted by their actual timestamps.  Even when a timed event's timestamp equals
	// start it must still follow account creation, so the two groups are kept separate.
	var setupEvents []simulationEvent
	for _, pc := range s.productOrder {
		for k, v := range pc.Info.GlobalParameters {
			setupEvents = append(setupEvents, simulationEvent{Time: start, Event: globalParameterEvent(k, v)})
		}
	}
	for _, ev := range s.events {
		if ev.Time.IsZero() {
			ev.Time = start
			setupEvents = append(setupEvents, ev)
		}
	}
	for _, pc := range s.productOrder {
		for _, acc := range pc.AccountConfigs {
			setupEvents = append(setupEvents, simulationEvent{
				Time:  start,
				Event: createAccountEvent(acc.AccountID, pc.VersionID, acc.InstanceParams),
			})
		}
	}

	var timedEvents []simulationEvent
	for _, ev := range s.events {
		if !ev.Time.IsZero() {
			timedEvents = append(timedEvents, ev)
		}
	}
	sort.SliceStable(timedEvents, func(i, j int) bool {
		if timedEvents[i].Time.Equal(timedEvents[j].Time) {
			return timedEvents[i].Order < timedEvents[j].Order
		}
		return timedEvents[i].Time.Before(timedEvents[j].Time)
	})

	allEvents := append(internalEvents, setupEvents...)
	allEvents = append(allEvents, timedEvents...)
	instructions := make([]any, 0, len(allEvents))
	for _, ev := range allEvents {
		instruction := map[string]any{"timestamp": rfc3339UTC(ev.Time)}
		for k, v := range ev.Event {
			instruction[k] = v
		}
		instructions = append(instructions, instruction)
	}

	return map[string]any{
		"start_timestamp":      rfc3339UTC(start),
		"end_timestamp":        rfc3339UTC(end),
		"smart_contracts":      smartContracts,
		"supervisor_contracts": []any{},
		"contract_modules":     []any{},
		"instructions":         instructions,
		"outputs":              s.outputs(),
	}
}

func (s *compileState) outputs() []any {
	var out []any
	for _, check := range s.checks {
		if check.Kind != "derived_parameters" && check.Kind != "derived_parameter_dict" {
			continue
		}
		tsRaw, _ := check.Data["timestamp"].(string)
		ts, err := parseScenarioTime(tsRaw, s.timezone)
		if err != nil {
			continue
		}
		accountID, _ := check.Data["account_id"].(string)
		out = append(out, map[string]any{
				"timestamp":     rfc3339UTC(ts),
				"derived_params": map[string]any{"account_id": accountID},
			})
	}
	return out
}

func createAccountEvent(accountID, productVersionID string, instanceParams map[string]string) map[string]any {
	return map[string]any{"create_account": map[string]any{
		"id":                          accountID,
		"product_version_id":          productVersionID,
		"permitted_denominations":     []any{},
		"status":                      "ACCOUNT_STATUS_UNKNOWN",
		"stakeholder_ids":             []any{},
		"instance_param_vals":         instanceParams,
		"derived_instance_param_vals": map[string]string{},
		"details":                     map[string]string{},
	}}
}

func globalParameterEvent(id, initialValue string) map[string]any {
	return globalParameterEventWithShape(id, initialValue, "StringShape()", false)
}

func globalParameterEventWithShape(id, initialValue, shape string, named bool) map[string]any {
	displayName := ""
	description := ""
	if named {
		displayName = id
		description = id
	}
	strShape := any(map[string]any{})
	numberShape := any(nil)
	switch {
	case strings.Contains(shape, "NumberShape"):
		strShape = nil
		numberShape = map[string]any{"min_value": nil, "max_value": nil, "step": nil}
	case strings.Contains(shape, "StringShape"):
		strShape = map[string]any{}
	}
	return map[string]any{"create_global_parameter": map[string]any{
		"global_parameter": map[string]any{
			"id":           id,
			"display_name": displayName,
			"description":  description,
			"number":       numberShape,
			"str":          strShape,
			"denomination": nil,
			"date":         nil,
		},
		"initial_value": initialValue,
	}}
}

func artifactDir(specPath string) string {
	return filepath.Join(settings.SmartContractsDir(), ".gauge", "simulation", filepath.Dir(specPath), strings.TrimSuffix(filepath.Base(specPath), ".spec"))
}
