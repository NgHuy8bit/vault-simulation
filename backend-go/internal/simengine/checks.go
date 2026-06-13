package simengine

import (
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
	"time"

	"viewer/internal/omap"
	"viewer/internal/specdoc"
)

func buildScenarioReport(compiled compiledScenario, response []map[string]any, runErr error) scenarioReport {
	failures := map[string]string{}
	for _, notice := range compiled.CompileNotices {
		key := stepKey(specdoc.Step{Raw: notice.Text, Line: notice.Line})
		if notice.ErrorMessage != nil {
			failures[key] = *notice.ErrorMessage
		}
	}
	if runErr != nil {
		if len(compiled.Scenario.Steps) > 0 {
			failures[stepKey(compiled.Scenario.Steps[0])] = runErr.Error()
		} else {
			failures[compiled.Scenario.Name] = runErr.Error()
		}
	} else {
		for _, check := range compiled.Checks {
			if err := evaluateCheck(compiled, response, check); err != nil {
				failures[stepKey(check.Step)] = err.Error()
			}
		}
	}

	steps := append([]stepResult{}, compiled.CompileNotices...)
	for _, step := range compiled.Scenario.Steps {
		key := stepKey(step)
		if msg, ok := failures[key]; ok {
			steps = append(steps, failResult(step, msg))
		} else {
			steps = append(steps, passResult(step))
		}
	}
	status := "passed"
	for _, step := range steps {
		if step.Status == "failed" {
			status = "failed"
			break
		}
	}
	return scenarioReport{
		Heading:     compiled.Scenario.Name,
		Status:      status,
		Steps:       steps,
		HookFailure: nil,
	}
}

func stepKey(step specdoc.Step) string {
	if step.Line != nil {
		return fmt.Sprintf("line:%d", *step.Line)
	}
	return "raw:" + step.Raw
}

func evaluateCheck(compiled compiledScenario, response []map[string]any, check expectation) error {
	switch check.Kind {
	case "balance_check", "balance_check_multi":
		return checkBalances(compiled, response, check.Step)
	case "instruction_detail_check":
		return checkPostingInstructionDetails(compiled, response, check.Step)
	case "batch_detail_check":
		return checkBatchDetails(compiled, response, check.Step)
	case "notification":
		return checkNotification(compiled, response, check.Step)
	case "no_notifications":
		return checkNoNotifications(response)
	case "derived_parameters":
		return checkDerivedParameters(compiled, response, check.Step)
	case "derived_parameter_dict":
		return checkDerivedParameterDict(compiled, response, check.Step)
	case "accepted":
		return checkPostingStatus(compiled, response, check.Step, true)
	case "rejected", "parameter_rejected":
		return checkPostingStatus(compiled, response, check.Step, false)
	case "schedule":
		return fmt.Errorf("native checker does not support schedule checks yet")
	default:
		return nil
	}
}

func checkBalances(compiled compiledScenario, response []map[string]any, step specdoc.Step) error {
	var errs []string
	for _, item := range step.Data.GetList("rows") {
		row, ok := item.(*omap.Map)
		if !ok {
			continue
		}
		ts, err := parseScenarioTime(row.GetStrOr("timestamp", ""), compiled.Timezone)
		if err != nil {
			errs = append(errs, err.Error())
			continue
		}
		accountID := row.GetStrOr("account_id", "")
		// Use time-series semantics: find latest balance entry for this account at or before ts,
		// scanning backwards so intermediate events (e.g. template param changes) with no balance
		// data don't shadow earlier results that do have balance data.
		balances := latestBalancesForAccount(response, accountID, ts)
		if len(balances) == 0 {
			if _, ok := resultAtOrBefore(response, ts); !ok {
				errs = append(errs, fmt.Sprintf("no simulator result at or before %s", rfc3339UTC(ts)))
				continue
			}
		}
		address := row.GetStrOr("address", "")
		if address == "" {
			address = "DEFAULT"
		}
		expected := row.GetStrOr("balance", "0")
		found := false
		for _, bal := range balances {
			if strValue(bal["account_address"]) != address {
				continue
			}
			if strValue(bal["denomination"]) != row.GetStrOr("denomination", "") {
				continue
			}
			if strValue(bal["phase"]) != row.GetStrOr("phase", "POSTING_PHASE_COMMITTED") {
				continue
			}
			if strValue(bal["asset"]) != row.GetStrOr("asset", "COMMERCIAL_BANK_MONEY") {
				continue
			}
			found = true
			if !decimalEqual(strValue(bal["amount"]), expected) {
				errs = append(errs, fmt.Sprintf("balance mismatch for %s/%s: expected %s, got %s", accountID, address, expected, strValue(bal["amount"])))
			}
			break
		}
		if !found && !decimalEqual(expected, "0") {
			errs = append(errs, fmt.Sprintf("balance dimensions not found for account %q address %q", accountID, address))
		}
	}
	if len(errs) == 0 {
		return nil
	}
	return fmt.Errorf("%s", strings.Join(errs, "\n"))
}

func checkPostingInstructionDetails(compiled compiledScenario, response []map[string]any, step specdoc.Step) error {
	ts, err := parseScenarioTime(step.Data.GetStrOr("timestamp", ""), compiled.Timezone)
	if err != nil {
		return err
	}
	expected := rowsToMap(step.Data.GetList("rows"))
	if len(expected) == 0 {
		return nil
	}
	result, ok := resultAtOrBefore(response, ts)
	if !ok {
		return fmt.Errorf("no simulator result at or before %s", rfc3339UTC(ts))
	}
	for _, pib := range postingBatches(result) {
		for _, pi := range sliceOfMaps(pib["posting_instructions"]) {
			if mapContainsStringMap(asMap(pi["instruction_details"]), expected) {
				return nil
			}
		}
	}
	return fmt.Errorf("posting instruction details not found: %v", expected)
}

func checkBatchDetails(compiled compiledScenario, response []map[string]any, step specdoc.Step) error {
	ts, err := parseScenarioTime(step.Data.GetStrOr("timestamp", ""), compiled.Timezone)
	if err != nil {
		return err
	}
	expected := rowsToMap(step.Data.GetList("rows"))
	if len(expected) == 0 {
		return nil
	}
	result, ok := resultAtOrBefore(response, ts)
	if !ok {
		return fmt.Errorf("no simulator result at or before %s", rfc3339UTC(ts))
	}
	for _, pib := range postingBatches(result) {
		if mapContainsStringMap(asMap(pib["batch_details"]), expected) {
			return nil
		}
	}
	return fmt.Errorf("batch details not found: %v", expected)
}

func checkNotification(compiled compiledScenario, response []map[string]any, step specdoc.Step) error {
	ts, err := parseScenarioTime(step.Data.GetStrOr("timestamp", ""), compiled.Timezone)
	if err != nil {
		return err
	}
	accountID := step.Data.GetStrOr("account_id", "")
	notificationType := step.Data.GetStrOr("notification_type", "")
	expectedDetails := rowsToMap(step.Data.GetList("notification_details"))
	expected, _ := step.Data.Get("expected")
	shouldExist, _ := expected.(bool)
	// Scan ALL result items at or before ts — the notification may appear in an earlier
	// item at the same timestamp while a later item at the same timestamp only has balances.
	found := false
	for _, item := range response {
		result := resultMap(item)
		rt, err := parseResponseTime(strValue(result["timestamp"]))
		if err != nil || rt.After(ts) {
			continue
		}
		for _, notification := range notificationsForAccount(result, accountID) {
			if strValue(notification["notification_type"]) != notificationType {
				continue
			}
			if !mapContainsStringMap(asMap(notification["notification_details"]), expectedDetails) {
				continue
			}
			found = true
			break
		}
		if found {
			break
		}
	}
	if shouldExist && !found {
		return fmt.Errorf("notification %q not found for account %q", notificationType, accountID)
	}
	if !shouldExist && found {
		return fmt.Errorf("unexpected notification %q found for account %q", notificationType, accountID)
	}
	return nil
}

func checkNoNotifications(response []map[string]any) error {
	for _, item := range response {
		result := resultMap(item)
		for accountID, raw := range asMap(result["contract_notification_events"]) {
			events := sliceOfMaps(asMap(raw)["contract_notification_events"])
			if len(events) > 0 {
				return fmt.Errorf("unexpected notifications for account %s", accountID)
			}
		}
	}
	return nil
}

func checkDerivedParameters(compiled compiledScenario, response []map[string]any, step specdoc.Step) error {
	ts, err := parseScenarioTime(step.Data.GetStrOr("timestamp", ""), compiled.Timezone)
	if err != nil {
		return err
	}
	accountID := step.Data.GetStrOr("account_id", "")
	result, ok := latestDerivedParamsForAccount(response, accountID, ts)
	if !ok {
		return fmt.Errorf("no simulator result with derived parameters for account %q at or before %s", accountID, rfc3339UTC(ts))
	}
	values := derivedValues(result, accountID)
	for key, expected := range rowsToMap(step.Data.GetList("rows")) {
		actual := strValue(values[key])
		if actual != expected {
			return fmt.Errorf("derived parameter %q mismatch: expected %s, got %s", key, expected, actual)
		}
	}
	return nil
}

func checkDerivedParameterDict(compiled compiledScenario, response []map[string]any, step specdoc.Step) error {
	ts, err := parseScenarioTime(step.Data.GetStrOr("timestamp", ""), compiled.Timezone)
	if err != nil {
		return err
	}
	accountID := step.Data.GetStrOr("account_id", "")
	result, ok := latestDerivedParamsForAccount(response, accountID, ts)
	if !ok {
		return fmt.Errorf("no simulator result with derived parameters for account %q at or before %s", accountID, rfc3339UTC(ts))
	}
	param := step.Data.GetStrOr("param_name", "")
	actualRaw := strValue(derivedValues(result, accountID)[param])
	actualMap := jsonStringToMap(actualRaw)
	expected := rowsToMap(step.Data.GetList("rows"))
	if !mapContainsStringMap(anyMapToStringMap(actualMap), expected) {
		return fmt.Errorf("derived parameter %q mismatch: expected subset %v, got %s", param, expected, actualRaw)
	}
	return nil
}

func checkPostingStatus(compiled compiledScenario, response []map[string]any, step specdoc.Step, accepted bool) error {
	ts, err := parseScenarioTime(step.Data.GetStrOr("timestamp", ""), compiled.Timezone)
	if err != nil {
		return err
	}
	result, ok := resultAtOrBefore(response, ts)
	if !ok {
		return fmt.Errorf("no simulator result at or before %s", rfc3339UTC(ts))
	}
	pibs := postingBatches(result)
	if len(pibs) == 0 {
		if accepted {
			return fmt.Errorf("no posting instruction batch found")
		}
		return nil
	}
	for _, pib := range pibs {
		status := strValue(pib["status"])
		hasErr := pib["error"] != nil && strValue(pib["error"]) != ""
		if accepted && (strings.Contains(status, "ACCEPTED") || status == "") && !hasErr {
			return nil
		}
		if !accepted && (strings.Contains(status, "REJECTED") || hasErr) {
			reason := step.Data.GetStrOr("rejection_reason", "")
			if reason == "" || strings.Contains(strValue(pib["error"]), reason) {
				return nil
			}
		}
	}
	if accepted {
		return fmt.Errorf("posting batch was not accepted")
	}
	return fmt.Errorf("posting batch was not rejected")
}

func resultAtOrBefore(response []map[string]any, ts time.Time) (map[string]any, bool) {
	var best map[string]any
	var bestTime time.Time
	for _, item := range response {
		result := resultMap(item)
		rt, err := parseResponseTime(strValue(result["timestamp"]))
		if err != nil {
			continue
		}
		if rt.After(ts) {
			continue
		}
		if best == nil || rt.After(bestTime) || rt.Equal(bestTime) {
			best = result
			bestTime = rt
		}
	}
	return best, best != nil
}

func resultMap(item map[string]any) map[string]any {
	if result, ok := item["result"].(map[string]any); ok {
		return result
	}
	return map[string]any{}
}

func balancesForAccount(result map[string]any, accountID string) []map[string]any {
	account := asMap(asMap(result["balances"])[accountID])
	return sliceOfMaps(account["balances"])
}

// latestBalancesForAccount finds the most recent non-empty balance list for accountID
// at or before ts, scanning backwards through results. This handles the case where
// intermediate events (e.g. parameter changes) produce result objects with no balance
// data for the account — those would shadow earlier results that do have data.
func latestBalancesForAccount(response []map[string]any, accountID string, ts time.Time) []map[string]any {
	var bestBals []map[string]any
	var bestTime time.Time
	for _, item := range response {
		result := resultMap(item)
		rt, err := parseResponseTime(strValue(result["timestamp"]))
		if err != nil || rt.After(ts) {
			continue
		}
		bals := balancesForAccount(result, accountID)
		if len(bals) == 0 {
			continue
		}
		if bestBals == nil || rt.After(bestTime) || rt.Equal(bestTime) {
			bestBals = bals
			bestTime = rt
		}
	}
	return bestBals
}

// latestDerivedParamsForAccount finds the most recent result with non-empty derived_params
// for accountID at or before ts. Multiple response items can share the same timestamp but
// only some contain derived_params — this skips empty ones so the correct item wins.
func latestDerivedParamsForAccount(response []map[string]any, accountID string, ts time.Time) (map[string]any, bool) {
	var best map[string]any
	var bestTime time.Time
	for _, item := range response {
		result := resultMap(item)
		rt, err := parseResponseTime(strValue(result["timestamp"]))
		if err != nil || rt.After(ts) {
			continue
		}
		vals := derivedValues(result, accountID)
		if len(vals) == 0 {
			continue
		}
		if best == nil || rt.After(bestTime) || rt.Equal(bestTime) {
			best = result
			bestTime = rt
		}
	}
	return best, best != nil
}

func postingBatches(result map[string]any) []map[string]any {
	return sliceOfMaps(result["posting_instruction_batches"])
}

func notificationsForAccount(result map[string]any, accountID string) []map[string]any {
	account := asMap(asMap(result["contract_notification_events"])[accountID])
	return sliceOfMaps(account["contract_notification_events"])
}

func derivedValues(result map[string]any, accountID string) map[string]any {
	account := asMap(asMap(result["derived_params"])[accountID])
	return asMap(account["values"])
}

func asMap(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func sliceOfMaps(v any) []map[string]any {
	raw, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		if m, ok := item.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func strValue(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case json.Number:
		return t.String()
	case float64:
		return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.10f", t), "0"), ".")
	case bool:
		if t {
			return "true"
		}
		return "false"
	default:
		raw, _ := json.Marshal(t)
		return string(raw)
	}
}

func decimalEqual(a, b string) bool {
	ar, aok := new(big.Rat).SetString(strings.ReplaceAll(a, "_", ""))
	br, bok := new(big.Rat).SetString(strings.ReplaceAll(b, "_", ""))
	if !aok || !bok {
		return a == b
	}
	return ar.Cmp(br) == 0
}

func mapContainsStringMap(actual map[string]any, expected map[string]string) bool {
	for key, value := range expected {
		if strValue(actual[key]) != value {
			return false
		}
	}
	return true
}

func anyMapToStringMap(in map[string]string) map[string]any {
	out := map[string]any{}
	for k, v := range in {
		out[k] = v
	}
	return out
}
