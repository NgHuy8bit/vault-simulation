package specdoc

import (
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"
)

func isFreeTextStep(step Step) bool {
	if step.Type != "other" || step.Data == nil {
		return false
	}
	v, _ := step.Data.Get("is_free_text")
	return truthy(v)
}

func serializeStepsTo(steps []Step, lines *[]string) {
	for i, step := range steps {
		*lines = append(*lines, serializeStep(step)...)
		var next *Step
		if i+1 < len(steps) {
			next = &steps[i+1]
		}
		// Skip blank line between two consecutive free-text steps.
		if isFreeTextStep(step) && next != nil && isFreeTextStep(*next) {
			continue
		}
		*lines = append(*lines, "")
	}
}

// Serialize converts the structured spec back into markdown.
func Serialize(spec ParsedSpec) string {
	title := spec.Title
	if title == "" {
		title = "New Spec"
	}
	lines := []string{"# " + title, ""}

	if len(spec.FileTags) > 0 {
		lines = append(lines, "tags: "+strings.Join(spec.FileTags, ", "), "")
	}

	serializeStepsTo(spec.SetupSteps, &lines)

	for _, scenario := range spec.Scenarios {
		name := scenario.Name
		if name == "" {
			name = "Scenario"
		}
		lines = append(lines, "## "+name, "")
		if len(scenario.Tags) > 0 {
			lines = append(lines, "tags: "+strings.Join(scenario.Tags, ", "), "")
		}
		serializeStepsTo(scenario.Steps, &lines)
	}

	return strings.TrimRight(strings.Join(lines, "\n"), " \t\r\n\v\f") + "\n"
}

func serializeStep(step Step) []string {
	data := step.Data
	if data == nil {
		data = NewMap()
	}

	if src := data.GetList("_source_lines"); len(src) > 0 {
		if dirty, _ := data.Get("_dirty"); !truthy(dirty) {
			out := make([]string, len(src))
			for i, l := range src {
				out[i] = PyStr(l)
			}
			return out
		}
	}

	switch step.Type {
	case "config":
		return []string{serializeConfig(data)}
	case "product":
		return serializeProduct(data)
	case "account":
		return serializeAccount(data)
	case "balance_check":
		return serializeBalanceCheck(data)
	case "inbound":
		return serializeHardSettlement(data, true)
	case "outbound":
		return serializeHardSettlement(data, false)
	case "inbound_auth":
		return serializeAuth(data, true)
	case "outbound_auth":
		return serializeAuth(data, false)
	case "transfer":
		return serializeTransfer(data)
	case "settlement":
		return serializeSettlement(data)
	case "release":
		return serializeRelease(data)
	case "custom_instruction":
		return serializeCustomInstruction(data)
	case "posting_instruction_batch":
		return serializePIB(data)
	case "auth_adjustment":
		return []string{fmt.Sprintf(
			`* At "%s", auth adjustment "%s" for client transaction ID "%s".`,
			data.GetStr("timestamp", ""), formatAmount(data.GetStr("amount", "0")),
			data.GetStr("client_transaction_id", ""))}
	case "accepted":
		return []string{fmt.Sprintf(
			`* At "%s", verify that the transaction of account ID "%s" is accepted.`,
			data.GetStr("timestamp", ""), data.GetStr("account_id", ""))}
	case "rejected":
		return serializeRejected(data)
	case "notification":
		return serializeNotification(data)
	case "no_notifications":
		return []string{"* Expect no contract notifications."}
	case "schedule":
		return []string{fmt.Sprintf(
			`* At "%s", verify that the expected schedule of account ID "%s" with event "%s".`,
			data.GetStr("timestamp", ""), data.GetStr("account_id", ""), data.GetStr("event_id", ""))}
	case "parameter_rejected":
		return []string{fmt.Sprintf(
			`* At "%s", verify that the parameter change of account ID "%s" is rejected due to "%s" with reason "%s".`,
			data.GetStr("timestamp", ""), data.GetStr("account_id", ""),
			data.GetStr("rejection_type", "AgainstTermsAndConditions"),
			data.GetStr("rejection_reason", ""))}
	case "derived_parameters":
		return []string{
			fmt.Sprintf(`* At "%s", verify that the parameters of account ID "%s" should be:`,
				data.GetStr("timestamp", ""), data.GetStr("account_id", "")),
			"",
			formatTable([]string{"name", "value"}, data.GetList("rows")),
		}
	case "change_instance_params":
		return []string{
			fmt.Sprintf(`* Change instance parameters account ID "%s":`, data.GetStr("account_id", "")),
			"",
			formatTable([]string{"name", "value"}, data.GetList("params")),
		}
	case "change_template_params":
		return []string{
			fmt.Sprintf(`* Change template parameters product version ID "%s":`, data.GetStr("product_version_id", "")),
			"",
			formatTable([]string{"name", "value"}, data.GetList("params")),
		}
	case "update_account_status":
		return []string{fmt.Sprintf(
			`* At "%s", update the status of account ID "%s" to "%s".`,
			data.GetStr("timestamp", ""), data.GetStr("account_id", ""), data.GetStr("status", ""))}
	case "account_close":
		return []string{fmt.Sprintf(
			`* At "%s", update account status to pending closure for account ID "%s".`,
			data.GetStr("timestamp", ""), data.GetStr("account_id", ""))}
	case "update_account_version":
		return []string{fmt.Sprintf(
			`* At "%s", update account ID "%s" to product version ID "%s".`,
			data.GetStr("timestamp", ""), data.GetStr("account_id", ""), data.GetStr("product_version_id", ""))}
	case "flag_definition":
		return []string{fmt.Sprintf(
			`* At "%s", create a Flag Definition Event for "%s".`,
			data.GetStr("timestamp", ""), data.GetStr("flag_name", ""))}
	case "flag":
		return []string{fmt.Sprintf(
			`* At "%s", set "%s" on customer account ID "%s" with an expiry date of "%s".`,
			data.GetStr("timestamp", ""), data.GetStr("flag_name", ""),
			data.GetStr("account_id", ""), data.GetStr("expiry_timestamp", ""))}
	case "balance_check_multi":
		return serializeBalanceCheckMulti(data)
	case "global_param":
		return serializeGlobalParam(data)
	case "derived_parameter_dict":
		return []string{fmt.Sprintf(
			`* At "%s", verify that the parameter "%s" of account ID "%s" should be "%s".`,
			data.GetStr("timestamp", ""), data.GetStr("param_name", ""),
			data.GetStr("account_id", ""), data.GetStr("value", ""))}
	case "exception_msg":
		return []string{fmt.Sprintf(
			`* Assert an exception when closed account with message "%s".`, data.GetStr("message", ""))}
	case "instruction_detail_check":
		rows := data.GetList("rows")
		return []string{
			fmt.Sprintf(`* At "%s", verify that posting instruction details contain:`, data.GetStr("timestamp", "")),
			"",
			formatTable(rowHeaders(rows, []string{"key", "value"}), rows),
		}
	case "batch_detail_check":
		rows := data.GetList("rows")
		return []string{
			fmt.Sprintf(`* At "%s", check batch details contain the following metadata:`, data.GetStr("timestamp", "")),
			"",
			formatTable(rowHeaders(rows, []string{"key", "value"}), rows),
		}
	}

	raw := step.Raw
	if raw == "" {
		raw = data.GetStrOr("raw_text", "")
	}
	if raw == "" {
		return []string{}
	}
	if v, _ := data.Get("is_free_text"); truthy(v) {
		return []string{raw}
	}
	if strings.HasPrefix(raw, "* ") {
		return []string{raw}
	}
	return []string{"* " + raw}
}

// rowHeaders returns the first row's key order, or the fallback when empty.
func rowHeaders(rows []any, fallback []string) []string {
	if len(rows) > 0 {
		if m, ok := rows[0].(*Map); ok && m.Len() > 0 {
			return m.Keys()
		}
	}
	return fallback
}

// ── Config ───────────────────────────────────────────────────────────────────

func serializeConfig(data *Map) string {
	key := data.GetStr("key", "None")
	value := data.GetStr("value", "")
	switch key {
	case "timezone":
		return fmt.Sprintf(`* Set events time zone "%s".`, value)
	case "start_timestamp":
		return fmt.Sprintf(`* Set start timestamp at "%s".`, value)
	case "end_timestamp":
		return fmt.Sprintf(`* Set end timestamp at "%s".`, value)
	}
	text := value
	if text == "" {
		text = "Set up global environment"
	}
	if strings.HasPrefix(text, "* ") {
		return text
	}
	return "* " + text
}

// ── Product / Account ────────────────────────────────────────────────────────

func serializeProduct(data *Map) []string {
	name := data.GetStrOr("name", "loan")
	versionID := data.GetStrOr("version_id", "1")
	params := data.GetList("params")
	if len(params) > 0 {
		return []string{
			fmt.Sprintf(`* Create a new product name "%s" with product version ID "%s" using the specify template parameter value:`, name, versionID),
			"",
			formatTable([]string{"name", "value"}, params),
		}
	}
	return []string{fmt.Sprintf(
		`* Create a new product name "%s" with product version ID "%s" using the default template parameters.`,
		name, versionID)}
}

func serializeAccount(data *Map) []string {
	accountID := data.GetStrOr("account_id", "ACCOUNT")
	versionID := data.GetStrOr("version_id", "1")
	paramMode := data.GetStrOr("account_param_mode", "instance_params")
	parameterValues := data.GetList("parameter_values")
	params := data.GetList("params")

	if paramMode == "parameter_values" && len(parameterValues) > 0 {
		return []string{
			fmt.Sprintf(`* Create a new account with the ID "%s" with specify parameter values on product version ID "%s":`, accountID, versionID),
			"",
			formatTable([]string{"name", "constraint", "value"}, parameterValues),
		}
	}
	if len(params) > 0 {
		return []string{
			fmt.Sprintf(`* Create a new account with the ID "%s" with specify instance parameter value on product version ID "%s":`, accountID, versionID),
			"",
			formatTable([]string{"name", "value"}, params),
		}
	}
	return []string{fmt.Sprintf(
		`* Create a new account with the ID "%s" with default instance parameter value on product version ID "%s".`,
		accountID, versionID)}
}

// ── Balance checks ───────────────────────────────────────────────────────────

const (
	defPhase = "POSTING_PHASE_COMMITTED"
	defAsset = "COMMERCIAL_BANK_MONEY"
)

func serializeBalanceCheck(data *Map) []string {
	rows := data.GetList("rows")
	denomination := data.GetStrOr("denomination", "")
	if denomination == "" {
		if len(rows) > 0 {
			if m, ok := rows[0].(*Map); ok {
				denomination = m.GetStr("denomination", "")
			}
		} else {
			denomination = "VND"
		}
	}

	accountIDs := map[string]bool{}
	for _, r := range rows {
		m, _ := r.(*Map)
		accountIDs[m.GetStr("account_id", "")] = true
	}

	hasPhase := anyNonDefault(rows, "phase", defPhase)

	if len(accountIDs) == 1 && !accountIDs[""] {
		var accountID string
		for id := range accountIDs {
			accountID = id
		}
		compact := make([]any, 0, len(rows))
		for _, r := range rows {
			m, _ := r.(*Map)
			c := NewMap()
			c.Set("timestamp", m.GetStr("timestamp", ""))
			c.Set("address", m.GetStr("address", ""))
			c.Set("balance", m.GetStr("balance", "0"))
			if hasPhase {
				v, _ := m.Get("phase")
				c.Set("phase", v)
			}
			compact = append(compact, c)
		}
		headers := []string{"timestamp", "address", "balance"}
		if hasPhase {
			headers = append(headers, "phase")
		}
		return []string{
			fmt.Sprintf(`* Check the balances of account "%s" and denomination "%s" with address:`, accountID, denomination),
			"",
			formatTable(headers, compact),
		}
	}

	hasAsset := anyNonDefault(rows, "asset", defAsset)
	headers := []string{"timestamp", "account_id", "address", "denomination", "balance"}
	if hasPhase {
		headers = append(headers, "phase")
	}
	if hasAsset {
		headers = append(headers, "asset")
	}
	normalized := make([]any, 0, len(rows))
	for _, r := range rows {
		m, _ := r.(*Map)
		c := NewMap()
		c.Set("timestamp", m.GetStr("timestamp", ""))
		c.Set("account_id", m.GetStr("account_id", ""))
		c.Set("address", m.GetStr("address", ""))
		c.Set("denomination", m.GetStr("denomination", denomination))
		c.Set("balance", m.GetStr("balance", "0"))
		if hasPhase {
			v, _ := m.Get("phase")
			c.Set("phase", v)
		}
		if hasAsset {
			v, _ := m.Get("asset")
			c.Set("asset", v)
		}
		normalized = append(normalized, c)
	}
	return []string{
		"* Check the balances with address and denomination:",
		"",
		formatTable(headers, normalized),
	}
}

func anyNonDefault(rows []any, key, def string) bool {
	for _, r := range rows {
		m, _ := r.(*Map)
		v := m.GetStr(key, def)
		if v != "" && v != def {
			return true
		}
	}
	return false
}

func serializeBalanceCheckMulti(data *Map) []string {
	denomination := data.GetStrOr("denomination", "VND")
	rows := data.GetList("rows")

	hasMultiDenom := false
	for _, r := range rows {
		m, _ := r.(*Map)
		if m.GetStr("denomination", denomination) != denomination {
			hasMultiDenom = true
			break
		}
	}
	hasPhase := anyNonDefault(rows, "phase", defPhase)
	hasAsset := anyNonDefault(rows, "asset", defAsset)

	headers := []string{"timestamp", "account_id", "address", "balance"}
	if hasMultiDenom {
		headers = append(headers, "denomination")
	}
	if hasPhase {
		headers = append(headers, "phase")
	}
	if hasAsset {
		headers = append(headers, "asset")
	}

	return []string{
		fmt.Sprintf(`* Check the balances denomination "%s" with multiple account and address:`, denomination),
		"",
		formatTable(headers, rows),
	}
}

// ── Posting instructions ─────────────────────────────────────────────────────

func serializeHardSettlement(data *Map, inbound bool) []string {
	timestamp := data.GetStr("timestamp", "")
	amount := formatAmount(data.GetStr("amount", "0"))
	denomination := data.GetStrOr("denomination", "VND")
	fromAccount := data.GetStr("from_account", "")
	toAccount := data.GetStr("to_account", "")
	details := data.GetList("instruction_detail")

	var step string
	if inbound {
		step = fmt.Sprintf(
			`* At "%s", make an Inbound Hard Settlement of "%s" "%s" from internal account ID "%s" to customer account ID "%s"`,
			timestamp, amount, denomination, fromAccount, toAccount)
	} else {
		step = fmt.Sprintf(
			`* At "%s", make an Outbound Hard Settlement of "%s" "%s" from customer account ID "%s" to internal account ID "%s"`,
			timestamp, amount, denomination, fromAccount, toAccount)
	}
	if len(details) == 0 {
		return []string{step + "."}
	}
	return []string{step + " with parameters:", "", formatTable([]string{"key", "value"}, details)}
}

func serializeAuth(data *Map, inbound bool) []string {
	timestamp := data.GetStr("timestamp", "")
	amount := formatAmount(data.GetStr("amount", "0"))
	denomination := data.GetStrOr("denomination", "VND")
	internal := data.GetStr("internal_account_id", "")
	customer := data.GetStr("customer_account_id", "")
	details := data.GetList("instruction_detail")

	var step string
	if inbound {
		step = fmt.Sprintf(
			`* At "%s", make an Inbound Authorisation of "%s" "%s" from internal account ID "%s" to customer account ID "%s"`,
			timestamp, amount, denomination, internal, customer)
	} else {
		step = fmt.Sprintf(
			`* At "%s", make an Outbound Authorisation of "%s" "%s" from customer account ID "%s" to internal account ID "%s"`,
			timestamp, amount, denomination, customer, internal)
	}
	if len(details) == 0 {
		return []string{step + "."}
	}
	return []string{step + " with parameters:", "", formatTable([]string{"key", "value"}, details)}
}

func serializeTransfer(data *Map) []string {
	step := fmt.Sprintf(
		`* At "%s", make a Transfer of "%s" "%s" from debtor account ID "%s" to creditor account ID "%s"`,
		data.GetStr("timestamp", ""), formatAmount(data.GetStr("amount", "0")),
		data.GetStrOr("denomination", "VND"),
		data.GetStr("debtor_account_id", ""), data.GetStr("creditor_account_id", ""))
	details := data.GetList("instruction_detail")
	if len(details) == 0 {
		return []string{step + "."}
	}
	return []string{step + " with parameters:", "", formatTable([]string{"key", "value"}, details)}
}

func serializeSettlement(data *Map) []string {
	step := fmt.Sprintf(
		`* At "%s", make a Settlement of "%s" with transaction ID "%s"`,
		data.GetStr("timestamp", ""), formatAmount(data.GetStr("amount", "0")),
		data.GetStr("client_transaction_id", ""))
	details := data.GetList("instruction_detail")
	if len(details) == 0 {
		return []string{step + "."}
	}
	return []string{step + " and parameters:", "", formatTable([]string{"key", "value"}, details)}
}

func serializeRelease(data *Map) []string {
	step := fmt.Sprintf(
		`* At "%s", make a release event with transaction ID "%s"`,
		data.GetStr("timestamp", ""), data.GetStr("client_transaction_id", ""))
	details := data.GetList("instruction_detail")
	if len(details) == 0 {
		return []string{step + "."}
	}
	return []string{step + " and instruction detail:", "", formatTable([]string{"key", "value"}, details)}
}

func serializeCustomInstruction(data *Map) []string {
	header := fmt.Sprintf(
		`* At "%s", initiate a Custom Instruction of "%s" "%s" of account ID "%s" from address "%s" to address "%s" with instruction detail:`,
		data.GetStr("timestamp", ""), formatAmount(data.GetStr("amount", "0")),
		data.GetStrOr("denomination", "VND"), data.GetStr("account_id", ""),
		data.GetStr("from_address", ""), data.GetStr("to_address", ""))
	detail := data.GetList("instruction_detail")
	if len(detail) == 0 {
		return []string{header, "", ""}
	}
	return []string{header, "", formatTable(rowHeaders(detail, nil), detail)}
}

func serializePIB(data *Map) []string {
	timestamp := data.GetStr("timestamp", "")
	instructions := data.GetList("instructions")
	variant := data.GetStr("variant", "initiate")

	var headerLine string
	if variant == "initiate" {
		headerLine = fmt.Sprintf(`* At "%s", initiate an instruction batch with:`, timestamp)
	} else {
		headerLine = fmt.Sprintf(`* At "%s", make a posting instruction batch with the following posting instructions:`, timestamp)
	}
	if len(instructions) == 0 {
		return []string{headerLine}
	}
	return []string{headerLine, "", formatTable(rowHeaders(instructions, nil), instructions)}
}

// ── Verification steps ───────────────────────────────────────────────────────

func serializeRejected(data *Map) []string {
	rejectionType := data.GetStrOr("rejection_type", "")
	if rejectionType == "" {
		rejectionType = data.GetStrOr("reason_code", "AgainstTermsAndConditions")
	}
	rejectionReason := data.GetStrOr("rejection_reason", "")
	if rejectionReason == "" {
		rejectionReason = data.GetStrOr("reason_text", "")
	}
	return []string{fmt.Sprintf(
		`* At "%s", verify that the transaction of account ID "%s" is rejected due to "%s" with reason "%s".`,
		data.GetStr("timestamp", ""), data.GetStr("account_id", ""), rejectionType, rejectionReason)}
}

func serializeNotification(data *Map) []string {
	timestamp := data.GetStr("timestamp", "")
	accountID := data.GetStr("account_id", "")
	notificationType := data.GetStr("notification_type", "")
	details := data.GetList("notification_details")

	if v, ok := data.Get("expected"); ok {
		if b, isBool := v.(bool); isBool && !b {
			return []string{fmt.Sprintf(
				`* At "%s", check if the account ID "%s" has no notification type "%s".`,
				timestamp, accountID, notificationType)}
		}
	}
	return []string{
		fmt.Sprintf(`* At "%s", check if the account ID "%s" has notification type "%s" with details:`,
			timestamp, accountID, notificationType),
		"",
		formatTable([]string{"key", "value"}, details),
	}
}

func serializeGlobalParam(data *Map) []string {
	rows := data.GetList("rows")
	timestamp := data.GetStrOr("timestamp", "")
	name := data.GetStrOr("name", "")
	value := data.GetStrOr("value", "")

	if len(rows) > 0 {
		if m, ok := rows[0].(*Map); ok && m.Len() > 0 {
			cols := m.Keys()
			prefix := "* Create multiple global parameter:"
			if timestamp != "" {
				prefix = fmt.Sprintf(`* At "%s", create global parameters with values:`, timestamp)
			}
			return []string{prefix, "", formatTable(cols, rows)}
		}
	}
	if raw := data.GetStrOr("raw_text", ""); raw != "" {
		if strings.HasPrefix(raw, "* ") {
			return []string{raw}
		}
		return []string{"* " + raw}
	}
	if timestamp != "" {
		return []string{fmt.Sprintf(`* At "%s", create global parameter "%s" with value "%s"`, timestamp, name, value)}
	}
	return []string{fmt.Sprintf(`* Create global parameter with start "", parameter ID "%s", value "%s".`, name, value)}
}

// ── Table / amount formatting ────────────────────────────────────────────────

func formatTable(headers []string, rows []any) string {
	if len(rows) == 0 {
		return ""
	}
	cells := func(row any, header string) string {
		m, ok := row.(*Map)
		if !ok {
			return ""
		}
		return m.GetStr(header, "")
	}

	// Python len() counts characters, not bytes — match it for non-ASCII cells.
	widths := make([]int, len(headers))
	for i, h := range headers {
		widths[i] = max(utf8.RuneCountInString(h), 3)
	}
	for _, row := range rows {
		for i, h := range headers {
			if l := utf8.RuneCountInString(cells(row, h)); l > widths[i] {
				widths[i] = l
			}
		}
	}

	formatRow := func(values []string) string {
		parts := make([]string, len(values))
		for i, v := range values {
			parts[i] = v + strings.Repeat(" ", widths[i]-utf8.RuneCountInString(v))
		}
		return "  | " + strings.Join(parts, " | ") + " |"
	}

	out := []string{formatRow(headers)}
	sep := make([]string, len(widths))
	for i, w := range widths {
		sep[i] = strings.Repeat("-", w)
	}
	out = append(out, "  | "+strings.Join(sep, " | ")+" |")
	for _, row := range rows {
		values := make([]string, len(headers))
		for i, h := range headers {
			values[i] = cells(row, h)
		}
		out = append(out, formatRow(values))
	}
	return strings.Join(out, "\n")
}

// formatAmount renders integers with "_" thousands separators (Python
// f"{n:,}" with "," → "_"); non-integers pass through unchanged.
func formatAmount(value string) string {
	raw := strings.NewReplacer("_", "", ",", "").Replace(value)
	if raw == "" {
		raw = "0"
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return raw
	}
	neg := n < 0
	if neg {
		n = -n
	}
	s := strconv.FormatInt(n, 10)
	var groups []string
	for len(s) > 3 {
		groups = append([]string{s[len(s)-3:]}, groups...)
		s = s[:len(s)-3]
	}
	groups = append([]string{s}, groups...)
	out := strings.Join(groups, "_")
	if neg {
		return "-" + out
	}
	return out
}
