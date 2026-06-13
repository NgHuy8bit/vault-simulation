package simengine

import (
	"bytes"
	"encoding/json"
	"math/big"
	"strings"
)

func formatValue(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return value
	}
	// Python code expression: evaluate json_dumps(...) by converting Python literal to JSON.
	if strings.HasPrefix(value, "code:") {
		if evaluated := evalCodeExpr(strings.TrimSpace(value[5:])); evaluated != "" {
			return evaluated
		}
		return value
	}
	numeric := strings.ReplaceAll(value, "_", "")
	if _, ok := new(big.Rat).SetString(numeric); ok {
		return numeric
	}
	var decoded any
	if err := json.Unmarshal([]byte(value), &decoded); err == nil {
		var buf bytes.Buffer
		enc := json.NewEncoder(&buf)
		enc.SetEscapeHTML(false)
		if err := enc.Encode(decoded); err == nil {
			return strings.TrimSpace(buf.String())
		}
	}
	return value
}

// evalCodeExpr handles Python expression strings like "json_dumps({'k': 'v'})".
func evalCodeExpr(expr string) string {
	if strings.HasPrefix(expr, "json_dumps(") && strings.HasSuffix(expr, ")") {
		inner := strings.TrimSpace(expr[len("json_dumps(") : len(expr)-1])
		return pythonLiteralToJSON(inner)
	}
	return ""
}

// pythonLiteralToJSON converts a Python dict/list literal to a JSON string.
// Handles single-quoted strings, True/False/None, and basic nesting.
func pythonLiteralToJSON(pyLiteral string) string {
	var buf strings.Builder
	i := 0
	inSingle := false
	inDouble := false
	for i < len(pyLiteral) {
		ch := pyLiteral[i]
		switch {
		case inSingle:
			if ch == '\\' && i+1 < len(pyLiteral) {
				next := pyLiteral[i+1]
				if next == '\'' {
					// escaped single quote → just write the char (no escaping needed in JSON for ')
					buf.WriteByte('\'')
					i += 2
					continue
				}
				buf.WriteByte('\\')
				buf.WriteByte(next)
				i += 2
				continue
			}
			if ch == '"' {
				buf.WriteString(`\"`) // must escape double-quotes inside the JSON string
				i++
				continue
			}
			if ch == '\'' {
				inSingle = false
				buf.WriteByte('"')
				i++
				continue
			}
			buf.WriteByte(ch)
			i++
		case inDouble:
			if ch == '\\' && i+1 < len(pyLiteral) {
				buf.WriteByte('\\')
				buf.WriteByte(pyLiteral[i+1])
				i += 2
				continue
			}
			if ch == '"' {
				inDouble = false
			}
			buf.WriteByte(ch)
			i++
		default:
			if ch == '\'' {
				inSingle = true
				buf.WriteByte('"')
				i++
			} else if ch == '"' {
				inDouble = true
				buf.WriteByte(ch)
				i++
			} else if ch == 'T' && strings.HasPrefix(pyLiteral[i:], "True") {
				buf.WriteString("true")
				i += 4
			} else if ch == 'F' && strings.HasPrefix(pyLiteral[i:], "False") {
				buf.WriteString("false")
				i += 5
			} else if ch == 'N' && strings.HasPrefix(pyLiteral[i:], "None") {
				buf.WriteString("null")
				i += 4
			} else {
				buf.WriteByte(ch)
				i++
			}
		}
	}
	result := buf.String()
	var decoded any
	if err := json.Unmarshal([]byte(result), &decoded); err != nil {
		return ""
	}
	var out bytes.Buffer
	enc := json.NewEncoder(&out)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(decoded); err != nil {
		return ""
	}
	return strings.TrimSpace(out.String())
}

func rowsToMap(rows []any) map[string]string {
	out := map[string]string{}
	for _, item := range rows {
		row, ok := item.(interface{ GetStr(string, string) string })
		if !ok {
			continue
		}
		key := row.GetStr("key", row.GetStr("name", ""))
		if key == "" {
			continue
		}
		out[key] = formatValue(row.GetStr("value", ""))
	}
	return out
}

func splitInstructionParams(rows []any) (map[string]string, map[string]string, map[string]string, string, string) {
	params := rowsToMap(rows)
	instructionDetails := map[string]string{}
	batchDetails := map[string]string{}
	clientTransactionID := params["client_transaction_id"]
	clientBatchID := params["client_batch_id"]
	if raw := params["instruction_detail"]; raw != "" {
		instructionDetails = jsonStringToMap(raw)
	} else if raw := params["instruction_details"]; raw != "" {
		instructionDetails = jsonStringToMap(raw)
	} else {
		for k, v := range params {
			if k != "client_transaction_id" && k != "client_batch_id" && k != "batch_details" {
				instructionDetails[k] = v
			}
		}
	}
	if raw := params["batch_details"]; raw != "" {
		batchDetails = jsonStringToMap(raw)
	}
	return params, instructionDetails, batchDetails, clientTransactionID, clientBatchID
}

func jsonStringToMap(raw string) map[string]string {
	out := map[string]string{}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return out
	}
	for k, v := range decoded {
		switch t := v.(type) {
		case string:
			out[k] = t
		default:
			b, _ := json.Marshal(t)
			out[k] = string(b)
		}
	}
	return out
}

func toBool(value string, def bool) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "true", "t", "1", "yes", "y":
		return true
	case "false", "f", "0", "no", "n", "none":
		return false
	default:
		return def
	}
}
