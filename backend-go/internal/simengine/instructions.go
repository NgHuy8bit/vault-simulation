package simengine

import (
	"crypto/rand"
	"fmt"
	"strings"
	"time"

	"viewer/internal/omap"
)

const defaultPostingClientID = "AsyncCreatePostingInstructionBatch"

func (s *compileState) transactionEvent(kind string, data *omap.Map) map[string]any {
	var instructionKind string
	switch kind {
	case "inbound":
		instructionKind = "inbound_hard_settlement"
	case "outbound":
		instructionKind = "outbound_hard_settlement"
	case "inbound_auth":
		instructionKind = "inbound_authorisation"
	case "outbound_auth":
		instructionKind = "outbound_authorisation"
	}

	_, instructionDetails, batchDetails, clientTransactionID, clientBatchID := splitInstructionParams(data.GetList("instruction_detail"))
	targetAccountID := data.GetStrOr("customer_account_id", "")
	internalAccountID := data.GetStrOr("internal_account_id", "")
	if kind == "inbound" {
		targetAccountID = data.GetStrOr("to_account", "")
		internalAccountID = data.GetStrOr("from_account", "")
	}
	if kind == "outbound" {
		targetAccountID = data.GetStrOr("from_account", "")
		internalAccountID = data.GetStrOr("to_account", "")
	}
	if v := data.GetStrOr("client_transaction_id", ""); v != "" {
		clientTransactionID = v
	}

	payload := map[string]any{
		"amount":              formatValue(data.GetStrOr("amount", "0")),
		"denomination":        data.GetStrOr("denomination", ""),
		"target_account":      map[string]any{"account_id": targetAccountID},
		"internal_account_id": internalAccountID,
		"advice":              false,
		"instruction_details": nil,
	}
	pi := postingInstructionFromPayload(instructionKind, payload, clientTransactionID, instructionDetails)
	return postingBatch(s.mustTimestamp(data), []map[string]any{pi}, "", nil, batchDetails, clientBatchID)
}

func (s *compileState) transferEvent(data *omap.Map) map[string]any {
	_, instructionDetails, batchDetails, clientTransactionID, clientBatchID := splitInstructionParams(data.GetList("instruction_detail"))
	payload := map[string]any{
		"amount":                  formatValue(data.GetStrOr("amount", "0")),
		"denomination":            data.GetStrOr("denomination", ""),
		"debtor_target_account":   map[string]any{"account_id": data.GetStrOr("debtor_account_id", "")},
		"creditor_target_account": map[string]any{"account_id": data.GetStrOr("creditor_account_id", "")},
		"instruction_details":     nil,
	}
	pi := postingInstructionFromPayload("transfer", payload, clientTransactionID, instructionDetails)
	return postingBatch(s.mustTimestamp(data), []map[string]any{pi}, "", nil, batchDetails, clientBatchID)
}

func (s *compileState) settlementEvent(data *omap.Map) map[string]any {
	params, instructionDetails, batchDetails, clientTransactionID, clientBatchID := splitInstructionParams(data.GetList("instruction_detail"))
	if v := data.GetStrOr("client_transaction_id", ""); v != "" {
		clientTransactionID = v
	}
	payload := map[string]any{
		"amount":                             formatValue(data.GetStrOr("amount", "0")),
		"final":                              toBool(params["final"], false),
		"require_pre_posting_hook_execution": toBool(params["require_pre_posting_hook_execution"], true),
		"instruction_details":                nil,
	}
	pi := postingInstructionFromPayload("settlement", payload, clientTransactionID, instructionDetails)
	return postingBatch(s.mustTimestamp(data), []map[string]any{pi}, "", nil, batchDetails, clientBatchID)
}

func (s *compileState) releaseEvent(data *omap.Map) map[string]any {
	params, instructionDetails, batchDetails, clientTransactionID, clientBatchID := splitInstructionParams(data.GetList("instruction_detail"))
	if v := data.GetStrOr("client_transaction_id", ""); v != "" {
		clientTransactionID = v
	}
	payload := map[string]any{
		"require_pre_posting_hook_execution": toBool(params["require_pre_posting_hook_execution"], false),
		"instruction_details":                nil,
	}
	pi := postingInstructionFromPayload("release", payload, clientTransactionID, instructionDetails)
	return postingBatch(s.mustTimestamp(data), []map[string]any{pi}, "", nil, batchDetails, clientBatchID)
}

func (s *compileState) customInstructionEvent(data *omap.Map) map[string]any {
	_, instructionDetails, batchDetails, clientTransactionID, clientBatchID := splitInstructionParams(data.GetList("instruction_detail"))
	amount := formatValue(data.GetStrOr("amount", "0"))
	denomination := data.GetStrOr("denomination", "")
	payload := map[string]any{
		"postings": []any{
			posting(data.GetStrOr("debtor_account_id", ""), amount, false, denomination, "", data.GetStrOr("debtor_account_address", ""), ""),
			posting(data.GetStrOr("creditor_account_id", ""), amount, true, denomination, "", data.GetStrOr("creditor_account_address", ""), ""),
		},
		"instruction_details": nil,
	}
	pi := postingInstructionFromPayload("custom_instruction", payload, clientTransactionID, instructionDetails)
	return postingBatch(s.mustTimestamp(data), []map[string]any{pi}, "", nil, batchDetails, clientBatchID)
}

func (s *compileState) postingInstructionBatchEvent(ts time.Time, data *omap.Map) map[string]any {
	var postingInstructions []map[string]any
	for _, item := range data.GetList("instructions") {
		row, ok := item.(*omap.Map)
		if !ok {
			continue
		}
		postingType := row.GetStrOr("instruction_type", row.GetStrOr("posting_type", row.GetStrOr("type", "")))
		amount := formatValue(row.GetStrOr("amount", "0"))

		// Map spec column names to the attrs expected by postingInstruction.
		// debtor_account_id / creditor_account_id are the spec-level names; from/to are the postingInstruction names.
		// NOTE: Python's make_posting_batch maps from_address → creditor (credit=True) and to_address → debtor (credit=False),
		// which is the reverse of what the column names suggest. We mirror that here.
		attrs := map[string]string{
			"amount":               amount,
			"denomination":         row.GetStrOr("denomination", ""),
			"from_account_id":      row.GetStrOr("debtor_account_id", row.GetStrOr("from_account_id", "")),
			"to_account_id":        row.GetStrOr("creditor_account_id", row.GetStrOr("to_account_id", "")),
			"from_account_address": row.GetStrOr("to_address", row.GetStrOr("from_account_address", "")),
			"to_account_address":   row.GetStrOr("from_address", row.GetStrOr("to_account_address", "")),
			"target_account_id":    row.GetStrOr("target_account_id", ""),
			"internal_account_id":  row.GetStrOr("internal_account_id", ""),
			"final":                row.GetStrOr("final", ""),
			"advice":               row.GetStrOr("advice", ""),
		}
		// Fallback: also parse instruction_attribute JSON blob if present (older spec format).
		if raw := row.GetStrOr("instruction_attribute", ""); raw != "" {
			for k, v := range jsonStringToMap(raw) {
				if attrs[k] == "" {
					attrs[k] = v
				}
			}
		}

		// instruction_details (plural) is the spec column; fall back to singular.
		details := map[string]string{}
		if raw := row.GetStrOr("instruction_details", row.GetStrOr("instruction_detail", "")); raw != "" {
			details = jsonStringToMap(raw)
		}

		clientTransactionID := row.GetStrOr("client_transaction_id", "")
		postingInstructions = append(postingInstructions, postingInstruction(postingType, amount, attrs, clientTransactionID, details))
	}
	return postingBatch(ts, postingInstructions, "", nil, nil, "")
}

func postingBatch(ts time.Time, postingInstructions []map[string]any, clientTransactionID string, instructionDetails, batchDetails map[string]string, clientBatchID string) map[string]any {
	if clientBatchID == "" {
		clientBatchID = newUUID()
	}
	if batchDetails == nil {
		batchDetails = map[string]string{}
	}
	if len(postingInstructions) == 0 {
		postingInstructions = []map[string]any{
			postingInstructionFromPayload("custom_instruction", map[string]any{"postings": []any{}, "instruction_details": nil}, clientTransactionID, instructionDetails),
		}
	}
	return map[string]any{"create_posting_instruction_batch": map[string]any{
		"client_id":            defaultPostingClientID,
		"client_batch_id":      clientBatchID,
		"posting_instructions": postingInstructions,
		"batch_details":        batchDetails,
		"value_timestamp":      rfc3339UTC(ts),
	}}
}

func postingInstruction(kind, amount string, attrs map[string]string, clientTransactionID string, instructionDetails map[string]string) map[string]any {
	kind = normalizePostingType(kind)
	amount = formatValue(amount)
	if attrs == nil {
		attrs = map[string]string{}
	}

	var payload map[string]any
	switch kind {
	case "inbound_hard_settlement", "outbound_hard_settlement", "inbound_authorisation", "outbound_authorisation":
		payload = map[string]any{
			"amount":              amount,
			"denomination":        attrs["denomination"],
			"target_account":      map[string]any{"account_id": attrs["target_account_id"]},
			"internal_account_id": attrs["internal_account_id"],
			"advice":              toBool(attrs["advice"], false),
			"instruction_details": nil,
		}
	case "transfer":
		payload = map[string]any{
			"amount":                  amount,
			"denomination":            attrs["denomination"],
			"debtor_target_account":   map[string]any{"account_id": attrs["from_account_id"]},
			"creditor_target_account": map[string]any{"account_id": attrs["to_account_id"]},
			"instruction_details":     nil,
		}
	case "settlement":
		payload = map[string]any{
			"amount":                             amount,
			"final":                              toBool(attrs["final"], false),
			"require_pre_posting_hook_execution": toBool(attrs["require_pre_posting_hook_execution"], false),
			"instruction_details":                nil,
		}
	case "release":
		payload = map[string]any{
			"require_pre_posting_hook_execution": toBool(attrs["require_pre_posting_hook_execution"], false),
			"instruction_details":                nil,
		}
	case "authorisation_adjustment":
		payload = map[string]any{
			"amount":              amount,
			"advice":              toBool(attrs["advice"], false),
			"instruction_details": nil,
		}
	default:
		payload = map[string]any{
			"postings": []any{
				posting(attrs["from_account_id"], amount, false, attrs["denomination"], attrs["asset"], attrs["from_account_address"], attrs["phase"]),
				posting(attrs["to_account_id"], amount, true, attrs["denomination"], attrs["asset"], attrs["to_account_address"], attrs["phase"]),
			},
			"instruction_details": nil,
		}
		kind = "custom_instruction"
	}
	return postingInstructionFromPayload(kind, payload, clientTransactionID, instructionDetails)
}

func postingInstructionFromPayload(kind string, payload map[string]any, clientTransactionID string, instructionDetails map[string]string) map[string]any {
	if clientTransactionID == "" {
		clientTransactionID = newUUID()
	}
	if instructionDetails == nil {
		instructionDetails = map[string]string{}
	}
	// Mirror instruction_details inside the payload itself (Vault expects it in both places).
	if len(instructionDetails) > 0 {
		payload["instruction_details"] = instructionDetails
	}
	out := map[string]any{
		"client_transaction_id": clientTransactionID,
		"instruction_details":   instructionDetails,
		"override":              map[string]any{},
	}
	out[kind] = payload
	return out
}

func posting(accountID, amount string, credit bool, denomination, asset, accountAddress, phase string) map[string]any {
	if denomination == "" {
		denomination = "GBP"
	}
	if asset == "" {
		asset = "COMMERCIAL_BANK_MONEY"
	}
	if accountAddress == "" {
		accountAddress = "DEFAULT"
	}
	if phase == "" {
		phase = "POSTING_PHASE_COMMITTED"
	}
	return map[string]any{
		"account_id":      accountID,
		"amount":          amount,
		"denomination":    denomination,
		"asset":           asset,
		"account_address": accountAddress,
		"phase":           phase,
		"credit":          credit,
	}
}

func normalizePostingType(kind string) string {
	kind = strings.TrimSpace(kind)
	switch kind {
	case "InboundHardSettlement":
		return "inbound_hard_settlement"
	case "OutboundHardSettlement":
		return "outbound_hard_settlement"
	case "InboundAuthorisation", "InboundAuthorization":
		return "inbound_authorisation"
	case "OutboundAuthorisation", "OutboundAuthorization":
		return "outbound_authorisation"
	case "Transfer":
		return "transfer"
	case "Settlement":
		return "settlement"
	case "Release":
		return "release"
	case "AuthorisationAdjustment", "AuthorizationAdjustment":
		return "authorisation_adjustment"
	case "CustomInstruction":
		return "custom_instruction"
	default:
		return strings.ToLower(kind)
	}
}

func (s *compileState) mustTimestamp(data *omap.Map) time.Time {
	ts, err := parseScenarioTime(data.GetStrOr("timestamp", ""), s.timezone)
	if err == nil {
		return ts
	}
	return time.Time{}
}

func newUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("00000000-0000-4000-8000-%012d", time.Now().UnixNano()%1_000_000_000_000)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
