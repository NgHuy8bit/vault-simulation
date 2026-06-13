package omap

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
)

// Map is an insertion-ordered string-keyed map. Python dicts preserve
// insertion order and the spec serializer derives table column order from
// `list(rows[0].keys())`, so ordering is semantically significant — a plain
// Go map would scramble saved spec tables.
type Map struct {
	keys   []string
	values map[string]any
}

func NewMap() *Map {
	return &Map{values: map[string]any{}}
}

func (m *Map) Len() int {
	if m == nil {
		return 0
	}
	return len(m.keys)
}

func (m *Map) Keys() []string {
	if m == nil {
		return nil
	}
	return m.keys
}

func (m *Map) Has(key string) bool {
	if m == nil {
		return false
	}
	_, ok := m.values[key]
	return ok
}

// Get returns (value, present). A present key with JSON null returns (nil, true).
func (m *Map) Get(key string) (any, bool) {
	if m == nil {
		return nil, false
	}
	v, ok := m.values[key]
	return v, ok
}

func (m *Map) Set(key string, value any) {
	if _, exists := m.values[key]; !exists {
		m.keys = append(m.keys, key)
	}
	m.values[key] = value
}

// GetStr mirrors Python's `data.get(key, default)` rendered through str():
// missing key → default; present-but-null → "None" (Python str(None)).
func (m *Map) GetStr(key, def string) string {
	v, ok := m.Get(key)
	if !ok {
		return def
	}
	return PyStr(v)
}

// GetStrOr mirrors `data.get(key) or default` — falsy values (None, "", 0,
// False) fall back to the default.
func (m *Map) GetStrOr(key, def string) string {
	v, ok := m.Get(key)
	if !ok || !Truthy(v) {
		return def
	}
	return PyStr(v)
}

// GetList returns a []any value, or nil.
func (m *Map) GetList(key string) []any {
	v, _ := m.Get(key)
	l, _ := v.([]any)
	return l
}

func Truthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case string:
		return t != ""
	case float64:
		return t != 0
	case json.Number:
		f, err := t.Float64()
		return err != nil || f != 0
	case []any:
		return len(t) > 0
	case *Map:
		return t.Len() > 0
	default:
		return true
	}
}

// PyStr renders a JSON-decoded value the way Python's str() would.
func PyStr(v any) string {
	switch t := v.(type) {
	case nil:
		return "None"
	case string:
		return t
	case bool:
		if t {
			return "True"
		}
		return "False"
	case json.Number:
		return t.String()
	case float64:
		return strconv.FormatFloat(t, 'g', -1, 64)
	default:
		b, err := json.Marshal(t)
		if err != nil {
			return fmt.Sprintf("%v", t)
		}
		return string(b)
	}
}

// ── JSON encoding/decoding ───────────────────────────────────────────────────

func (m *Map) MarshalJSON() ([]byte, error) {
	if m == nil {
		return []byte("null"), nil
	}
	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, k := range m.keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		kb, err := json.Marshal(k)
		if err != nil {
			return nil, err
		}
		buf.Write(kb)
		buf.WriteByte(':')
		vb, err := json.Marshal(m.values[k])
		if err != nil {
			return nil, err
		}
		buf.Write(vb)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

func (m *Map) UnmarshalJSON(data []byte) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	v, err := decodeOrdered(dec)
	if err != nil {
		return err
	}
	om, ok := v.(*Map)
	if !ok {
		return fmt.Errorf("expected JSON object, got %T", v)
	}
	*m = *om
	return nil
}

// DecodeOrdered parses JSON preserving object key order: objects become *Map,
// arrays []any, numbers json.Number.
func DecodeOrdered(data []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	return decodeOrdered(dec)
}

func decodeOrdered(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	return decodeValue(dec, tok)
}

func decodeValue(dec *json.Decoder, tok json.Token) (any, error) {
	switch t := tok.(type) {
	case json.Delim:
		switch t {
		case '{':
			m := NewMap()
			for dec.More() {
				keyTok, err := dec.Token()
				if err != nil {
					return nil, err
				}
				key, ok := keyTok.(string)
				if !ok {
					return nil, fmt.Errorf("expected object key, got %v", keyTok)
				}
				valTok, err := dec.Token()
				if err != nil {
					return nil, err
				}
				val, err := decodeValue(dec, valTok)
				if err != nil {
					return nil, err
				}
				m.Set(key, val)
			}
			if _, err := dec.Token(); err != nil { // consume '}'
				return nil, err
			}
			return m, nil
		case '[':
			var arr []any
			for dec.More() {
				valTok, err := dec.Token()
				if err != nil {
					return nil, err
				}
				val, err := decodeValue(dec, valTok)
				if err != nil {
					return nil, err
				}
				arr = append(arr, val)
			}
			if _, err := dec.Token(); err != nil { // consume ']'
				return nil, err
			}
			if arr == nil {
				arr = []any{}
			}
			return arr, nil
		}
		return nil, fmt.Errorf("unexpected delimiter %v", t)
	default:
		return tok, nil // string, json.Number, bool, nil
	}
}
