// Package simproc turns a raw simulation response (+request) into the
// ScenarioSummary the frontend consumes — Go port of
// app/services/simulation_processor.py.
package simproc

import (
	"regexp"
	"sort"
	"strconv"
	"strings"

	"viewer/internal/omap"
)

type TimeRange struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

// TimelineEvent mirrors the pydantic model field-for-field.
type TimelineEvent struct {
	ID                  int     `json:"id"`
	Timestamp           string  `json:"timestamp"`
	Type                string  `json:"type"`
	Status              *string `json:"status"`
	RejectionReason     string  `json:"rejection_reason"`
	AccountID           string  `json:"account_id"`
	Postings            []any   `json:"postings"`
	NotificationType    string  `json:"notification_type"`
	NotificationDetails any     `json:"notification_details"`
	Logs                []any   `json:"logs"`
	Summary             string  `json:"summary"`
	HasPostings         bool    `json:"has_postings"`
	HasBalances         bool    `json:"has_balances"`
	IsRejected          bool    `json:"is_rejected"`
	Pibs                []any   `json:"pibs"`
	HookLogs            []any   `json:"hook_logs"`
	Notifications       []any   `json:"notifications"`
}

type Summary struct {
	Events         []TimelineEvent `json:"events"`
	Balances       *omap.Map       `json:"balances"`
	BalanceHistory *omap.Map       `json:"balance_history"`
	AccountHistory *omap.Map       `json:"account_history"`
	Accounts       []string        `json:"accounts"`
	Denominations  []string        `json:"denominations"`
	TimeRange      TimeRange       `json:"time_range"`
}

var (
	rejectedWordRe = regexp.MustCompile(`(?i)\brejected\b`)
	reasonPrefixRe = regexp.MustCompile(`^account "[^"]*" rejected[^"]*reason `)
	reasonQuotedRe = regexp.MustCompile(`reason "([^"]+)"`)
)

func getMap(m *omap.Map, key string) *omap.Map {
	v, _ := m.Get(key)
	mm, _ := v.(*omap.Map)
	return mm
}

func strList(items []any) []string {
	out := make([]string, 0, len(items))
	for _, it := range items {
		out = append(out, omap.PyStr(it))
	}
	return out
}

// Process is the port of process_simulation_response.
func Process(rawData any, requestData any) Summary {
	var events []TimelineEvent
	accountsLatest := omap.NewMap() // account → *omap.Map(key → balance map)
	balanceHistory := omap.NewMap()
	accountHistory := omap.NewMap()
	denomSet := map[string]bool{}
	accountSet := map[string]bool{}

	for idx, itemAny := range simulationItems(rawData) {
		item, _ := itemAny.(*omap.Map)
		if item == nil {
			continue
		}
		result := item
		if r := getMap(item, "result"); r != nil {
			result = r
		}
		timestamp := item.GetStrOr("timestamp", "")
		if timestamp == "" {
			timestamp = result.GetStr("timestamp", "")
		}
		logs := result.GetList("logs")
		batches := result.GetList("posting_instruction_batches")
		balances := getMap(result, "balances")
		hookLogs := result.GetList("hook_execution_logs")
		notifications := extractNotifications(getMap(result, "contract_notification_events"))

		hasPostings := len(batches) > 0
		isRejected := false
		for _, b := range batches {
			bm, _ := b.(*omap.Map)
			if strings.Contains(bm.GetStrOr("status", ""), "REJECTED") {
				isRejected = true
				break
			}
		}
		if !isRejected {
			for _, l := range logs {
				if rejectedWordRe.MatchString(omap.PyStr(l)) {
					isRejected = true
					break
				}
			}
		}

		eventType := eventTypeOf(batches, notifications, logs)
		summary := eventSummary(batches, notifications, logs, isRejected)
		rejectionReason := ""
		if isRejected {
			rejectionReason = findRejectionReason(logs, batches)
		}
		var notification *omap.Map
		if len(notifications) > 0 {
			notification, _ = notifications[0].(*omap.Map)
		}

		var status *string
		if isRejected {
			s := "rejected"
			status = &s
		} else if hasPostings {
			s := "accepted"
			status = &s
		}

		notifType := ""
		var notifDetails any = omap.NewMap()
		if notification != nil {
			notifType = notification.GetStr("notification_type", "")
			if d, ok := notification.Get("notification_details"); ok && d != nil {
				notifDetails = d
			}
		}

		if logs == nil {
			logs = []any{}
		}
		if batches == nil {
			batches = []any{}
		}
		if hookLogs == nil {
			hookLogs = []any{}
		}

		events = append(events, TimelineEvent{
			ID:                  idx,
			Timestamp:           timestamp,
			Type:                eventType,
			Status:              status,
			RejectionReason:     rejectionReason,
			AccountID:           extractAccountID(batches, notifications, balances),
			Postings:            flattenPostingInstructions(batches),
			NotificationType:    notifType,
			NotificationDetails: notifDetails,
			Logs:                logs,
			Summary:             truncateRunes(summary, 90),
			HasPostings:         hasPostings,
			HasBalances:         balances.Len() > 0,
			IsRejected:          isRejected,
			Pibs:                batches,
			HookLogs:            hookLogs,
			Notifications:       notifications,
		})

		collectBalances(timestamp, balances, accountSet, denomSet, accountsLatest, balanceHistory, accountHistory)
	}

	var timestamps []string
	for _, e := range events {
		if e.Timestamp != "" {
			timestamps = append(timestamps, e.Timestamp)
		}
	}
	start, end := "", ""
	if len(timestamps) > 0 {
		start, end = timestamps[0], timestamps[0]
		for _, t := range timestamps[1:] {
			if t < start {
				start = t
			}
			if t > end {
				end = t
			}
		}
	}

	instanceParams, paramHistory := extractInstanceParams(requestData)

	accounts := make([]string, 0, len(accountSet))
	for a := range accountSet {
		accounts = append(accounts, a)
	}
	sort.Strings(accounts)
	denominations := make([]string, 0, len(denomSet))
	for d := range denomSet {
		denominations = append(denominations, d)
	}
	sort.Strings(denominations)

	if events == nil {
		events = []TimelineEvent{}
	}

	return Summary{
		Events:         events,
		Balances:       latestBalances(accountsLatest, instanceParams, paramHistory),
		BalanceHistory: balanceHistory,
		AccountHistory: accountHistory,
		Accounts:       accounts,
		Denominations:  denominations,
		TimeRange:      TimeRange{Start: start, End: end},
	}
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

func simulationItems(rawData any) []any {
	if list, ok := rawData.([]any); ok {
		return list
	}
	m, ok := rawData.(*omap.Map)
	if !ok {
		return nil
	}
	result := m
	if r := getMap(m, "result"); r != nil {
		result = r
	}
	for _, key := range []string{"SmartContractSimulationResults", "smart_contract_simulation_results", "simulation_results"} {
		if v, ok := result.Get(key); ok {
			if list, ok := v.([]any); ok {
				return list
			}
		}
	}
	return nil
}

func eventTypeOf(batches, notifications, logs []any) string {
	if len(batches) > 0 {
		for _, b := range batches {
			bm, _ := b.(*omap.Map)
			if isAccrualBatch(bm) {
				return "accrual"
			}
		}
		return "posting"
	}
	if len(notifications) > 0 {
		return "notification"
	}
	return "setup"
}

func eventSummary(batches, notifications, logs []any, isRejected bool) string {
	if len(notifications) > 0 {
		nm, _ := notifications[0].(*omap.Map)
		return nm.GetStr("notification_type", "")
	}
	if isRejected && len(logs) > 0 {
		line := omap.PyStr(logs[0])
		for _, l := range logs {
			s := omap.PyStr(l)
			if strings.Contains(strings.ToLower(s), "reason") {
				line = s
				break
			}
		}
		return strings.Trim(reasonPrefixRe.ReplaceAllString(line, ""), `"`)
	}
	if len(batches) > 0 {
		bm, _ := batches[0].(*omap.Map)
		if v := bm.GetStrOr("client_batch_id", ""); v != "" {
			return v
		}
		return bm.GetStrOr("id", "")
	}
	if len(logs) > 0 {
		return omap.PyStr(logs[0])
	}
	return ""
}

func findRejectionReason(logs, batches []any) string {
	for _, l := range logs {
		if m := reasonQuotedRe.FindStringSubmatch(omap.PyStr(l)); m != nil {
			return m[1]
		}
	}
	for _, b := range batches {
		bm, _ := b.(*omap.Map)
		if v := bm.GetStrOr("rejection_reason", ""); v != "" {
			return v
		}
	}
	return ""
}

func collectBalances(
	timestamp string,
	balances *omap.Map,
	accountSet map[string]bool,
	denomSet map[string]bool,
	accountsLatest, balanceHistory, accountHistory *omap.Map,
) {
	for _, accountID := range balances.Keys() {
		accountData := getMap(balances, accountID)
		accountSet[accountID] = true
		if !accountsLatest.Has(accountID) {
			accountsLatest.Set(accountID, omap.NewMap())
		}
		if !balanceHistory.Has(accountID) {
			balanceHistory.Set(accountID, omap.NewMap())
		}
		if !accountHistory.Has(accountID) {
			accountHistory.Set(accountID, omap.NewMap())
		}
		latestByKey := getMap(accountsLatest, accountID)
		accHist := getMap(accountHistory, accountID)
		balHist := getMap(balanceHistory, accountID)

		for _, balAny := range accountData.GetList("balances") {
			bal, _ := balAny.(*omap.Map)
			address := bal.GetStr("account_address", "")
			denomination := bal.GetStr("denomination", "")
			asset := bal.GetStr("asset", "")
			amount := bal.GetStr("amount", "0")
			denomSet[denomination] = true

			key := address + "|||" + denomination + "|||" + asset
			latest := omap.NewMap()
			latest.Set("address", address)
			latest.Set("denomination", denomination)
			latest.Set("asset", asset)
			latest.Set("amount", amount)
			latest.Set("total_debit", bal.GetStr("total_debit", "0"))
			latest.Set("total_credit", bal.GetStr("total_credit", "0"))
			latest.Set("timestamp", timestamp)
			latestByKey.Set(key, latest)

			amountFloat := toFloat(amount)
			histEntry := omap.NewMap()
			for _, k := range latest.Keys() {
				v, _ := latest.Get(k)
				histEntry.Set(k, v)
			}
			histEntry.Set("amount_float", amountFloat)
			appendToList(accHist, key, histEntry)

			if asset == "COMMERCIAL_BANK_MONEY" {
				if !balHist.Has(denomination) {
					balHist.Set(denomination, omap.NewMap())
				}
				byDenom := getMap(balHist, denomination)
				point := omap.NewMap()
				point.Set("timestamp", timestamp)
				point.Set("amount", amountFloat)
				appendToList(byDenom, address, point)
			}
		}
	}
}

func appendToList(m *omap.Map, key string, item any) {
	v, ok := m.Get(key)
	list, _ := v.([]any)
	if !ok {
		list = []any{}
	}
	m.Set(key, append(list, item))
}

type paramChange struct {
	Timestamp string `json:"timestamp"`
	Name      string `json:"name"`
	OldValue  string `json:"old_value"`
	NewValue  string `json:"new_value"`
}

func extractInstanceParams(requestData any) (*omap.Map, map[string][]paramChange) {
	history := map[string][]paramChange{}
	result := omap.NewMap() // account → *omap.Map(param → value)
	req, ok := requestData.(*omap.Map)
	if !ok {
		return result, history
	}

	type update struct {
		timestamp string
		accountID string
		params    *omap.Map
	}
	var updates []update

	for _, insAny := range req.GetList("instructions") {
		ins, _ := insAny.(*omap.Map)
		if create := getMap(ins, "create_account"); create != nil {
			accountID := create.GetStrOr("id", "")
			if accountID == "" {
				accountID = create.GetStr("account_id", "")
			}
			params := getMap(create, "instance_param_vals")
			if accountID != "" && params.Len() > 0 {
				copied := omap.NewMap()
				for _, k := range params.Keys() {
					copied.Set(k, params.GetStr(k, ""))
				}
				result.Set(accountID, copied)
			}
			continue
		}
		if upd := getMap(ins, "create_account_update"); upd != nil {
			accountID := upd.GetStr("account_id", "")
			params := getMap(getMap(upd, "instance_param_vals_update"), "instance_param_vals")
			if accountID != "" && params.Len() > 0 {
				updates = append(updates, update{ins.GetStr("timestamp", ""), accountID, params})
			}
		}
	}

	sort.SliceStable(updates, func(i, j int) bool { return updates[i].timestamp < updates[j].timestamp })
	for _, u := range updates {
		current := getMap(result, u.accountID)
		if current == nil {
			current = omap.NewMap()
			result.Set(u.accountID, current)
		}
		for _, name := range u.params.Keys() {
			newValue := u.params.GetStr(name, "")
			history[u.accountID] = append(history[u.accountID], paramChange{
				Timestamp: u.timestamp,
				Name:      name,
				OldValue:  current.GetStr(name, ""),
				NewValue:  newValue,
			})
			current.Set(name, newValue)
		}
	}
	return result, history
}

func latestBalances(accountsLatest, instanceParams *omap.Map, paramHistory map[string][]paramChange) *omap.Map {
	balances := omap.NewMap()
	for _, accountID := range accountsLatest.Keys() {
		byKey := getMap(accountsLatest, accountID)
		monetary := []any{}
		params := []*omap.Map{}
		allBalances := []any{}
		for _, key := range byKey.Keys() {
			balance := getMap(byKey, key)
			allBalances = append(allBalances, balance)
			asset := balance.GetStr("asset", "")
			if asset == "COMMERCIAL_BANK_MONEY" {
				m := omap.NewMap()
				for _, k := range []string{"address", "denomination", "amount", "total_debit", "total_credit", "timestamp"} {
					v, _ := balance.Get(k)
					m.Set(k, v)
				}
				monetary = append(monetary, m)
			} else if asset == "PRODUCT_CONFIGURATION" {
				p := omap.NewMap()
				p.Set("name", balance.GetStr("address", ""))
				p.Set("value", balance.GetStr("amount", ""))
				params = append(params, p)
			}
		}
		if ip := getMap(instanceParams, accountID); ip != nil {
			params = params[:0]
			for _, name := range ip.Keys() {
				p := omap.NewMap()
				p.Set("name", name)
				p.Set("value", ip.GetStr(name, ""))
				params = append(params, p)
			}
		}
		changes := paramHistory[accountID]
		changedNames := map[string]bool{}
		for _, c := range changes {
			changedNames[c.Name] = true
		}
		paramsAny := make([]any, 0, len(params))
		for _, p := range params {
			p.Set("changed", changedNames[p.GetStr("name", "")])
			paramsAny = append(paramsAny, p)
		}
		if changes == nil {
			changes = []paramChange{}
		}

		entry := omap.NewMap()
		entry.Set("monetary", monetary)
		entry.Set("params", paramsAny)
		entry.Set("param_changes", changes)
		entry.Set("all", allBalances)
		balances.Set(accountID, entry)
	}
	return balances
}

func extractNotifications(raw *omap.Map) []any {
	if raw == nil {
		return []any{}
	}
	notifications := []any{}
	for _, accountID := range raw.Keys() {
		payload := getMap(raw, accountID)
		for _, evAny := range payload.GetList("contract_notification_events") {
			ev, _ := evAny.(*omap.Map)
			details := getMap(ev, "notification_details")
			if details == nil {
				details = omap.NewMap()
			}
			accID := details.GetStrOr("account_id", "")
			if accID == "" {
				accID = ev.GetStrOr("resource_id", "")
			}
			if accID == "" {
				accID = accountID
			}
			n := omap.NewMap()
			n.Set("account_id", accID)
			n.Set("notification_type", ev.GetStr("notification_type", ""))
			n.Set("notification_details", details)
			n.Set("resource_id", ev.GetStr("resource_id", ""))
			n.Set("resource_type", ev.GetStr("resource_type", ""))
			notifications = append(notifications, n)
		}
	}
	return notifications
}

func flattenPostingInstructions(batches []any) []any {
	instructions := []any{}
	for _, b := range batches {
		bm, _ := b.(*omap.Map)
		instructions = append(instructions, bm.GetList("posting_instructions")...)
	}
	return instructions
}

func extractAccountID(batches, notifications []any, balances *omap.Map) string {
	for _, n := range notifications {
		nm, _ := n.(*omap.Map)
		if v := nm.GetStrOr("account_id", ""); v != "" {
			return v
		}
	}
	for _, b := range batches {
		bm, _ := b.(*omap.Map)
		for _, p := range postingList(bm) {
			pm, _ := p.(*omap.Map)
			accountID := pm.GetStr("account_id", "")
			if accountID != "" && accountID != "1" {
				return accountID
			}
		}
	}
	if balances.Len() == 1 {
		return balances.Keys()[0]
	}
	return ""
}

func postingList(batch *omap.Map) []any {
	postings := []any{}
	for _, insAny := range batch.GetList("posting_instructions") {
		ins, _ := insAny.(*omap.Map)
		postings = append(postings, ins.GetList("committed_postings")...)
		postings = append(postings, getMap(ins, "custom_instruction").GetList("postings")...)
	}
	return postings
}

func isAccrualBatch(batch *omap.Map) bool {
	haystack := []string{batch.GetStrOr("client_batch_id", ""), batch.GetStrOr("id", "")}
	for _, insAny := range batch.GetList("posting_instructions") {
		ins, _ := insAny.(*omap.Map)
		details := getMap(ins, "instruction_details")
		for _, k := range details.Keys() {
			haystack = append(haystack, details.GetStr(k, ""))
		}
		haystack = append(haystack, ins.GetStrOr("client_transaction_id", ""))
	}
	text := strings.ToUpper(strings.Join(haystack, " "))
	return strings.Contains(text, "ACCRUE") || strings.Contains(text, "ACCRUAL")
}

func toFloat(value string) PyFloat {
	f, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil {
		return 0
	}
	return PyFloat(f)
}

// PyFloat marshals like Python's repr(float): integral values keep a ".0"
// suffix and plain decimal notation is used for typical magnitudes (Go's
// default 'g' format would emit 1.39419e+08 where Python emits 139419000.0).
type PyFloat float64

func (f PyFloat) MarshalJSON() ([]byte, error) {
	s := strconv.FormatFloat(float64(f), 'f', -1, 64)
	if !strings.ContainsAny(s, ".eE") {
		s += ".0"
	}
	return []byte(s), nil
}
