package simengine

import (
	"embed"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

//go:embed products_defaults.json
var productDefaultsFS embed.FS

type productDefaults struct {
	EmptyAssetContractV4     string                 `json:"empty_asset_contract_v4"`
	EmptyLiabilityContractV4 string                 `json:"empty_liability_contract_v4"`
	Products                 map[string]productInfo `json:"products"`
}

type productInfo struct {
	Enum                 string            `json:"enum"`
	Name                 string            `json:"name"`
	ContractRelPath      string            `json:"contract_rel_path"`
	InternalAccounts     map[string]string `json:"internal_accounts"`
	InternalAccountOrder []string          `json:"internal_account_order"`
	RequiredProducts     []string          `json:"required_products"`
	TemplateParameters   map[string]string `json:"template_parameters"`
	InstanceParameters   map[string]string `json:"instance_parameters"`
	GlobalParameters     map[string]string `json:"global_parameters"`
}

type productConfig struct {
	Info             productInfo
	VersionID        string
	TemplateParams   map[string]string
	AccountConfigs   []accountConfig
	ContractContents string
}

type accountConfig struct {
	AccountID      string
	InstanceParams map[string]string
}

func loadProductDefaults() (productDefaults, error) {
	raw, err := productDefaultsFS.ReadFile("products_defaults.json")
	if err != nil {
		return productDefaults{}, err
	}
	var defs productDefaults
	if err := json.Unmarshal(raw, &defs); err != nil {
		return productDefaults{}, err
	}
	return defs, nil
}

func (d productDefaults) product(name string) (productInfo, bool) {
	p, ok := d.Products[strings.ToLower(strings.TrimSpace(name))]
	return p, ok
}

func (d productDefaults) allInternalAccounts() []internalAccount {
	seen := map[string]bool{}
	var out []internalAccount
	for _, name := range productOrder(d.Products) {
		info := d.Products[name]
		for _, id := range info.InternalAccountOrder {
			if seen[id] {
				continue
			}
			seen[id] = true
			tside := info.InternalAccounts[id]
			if tside == "" {
				tside = "LIABILITY"
			}
			out = append(out, internalAccount{ID: id, TSide: tside})
		}
	}
	return out
}

type internalAccount struct {
	ID    string
	TSide string
}

func productOrder(products map[string]productInfo) []string {
	order := []string{
		"current_account", "time_deposit", "salary_advance", "cash_management",
		"general_ledger_asset", "general_ledger_liability", "collateral_management",
		"current_account_v2", "fixed_term_savings", "fisa_beginning", "fisa_end",
		"fisa_periodic", "intermediary_account", "loan", "overdraft",
	}
	var out []string
	seen := map[string]bool{}
	for _, name := range order {
		if _, ok := products[name]; ok {
			out = append(out, name)
			seen[name] = true
		}
	}
	for name := range products {
		if !seen[name] {
			out = append(out, name)
		}
	}
	return out
}

func loadContract(smartContractsDir string, info productInfo, timezone string) (string, error) {
	contractPath := filepath.Join(smartContractsDir, info.ContractRelPath)
	renderedPath := filepath.Join(smartContractsDir, "products", info.Name, "contracts", "rendered_"+info.Name+".py")
	if _, err := os.Stat(renderedPath); err == nil {
		contractPath = renderedPath
	}
	raw, err := os.ReadFile(contractPath)
	if err != nil {
		return "", err
	}
	code := string(raw)
	if timezone != "" {
		re := regexp.MustCompile(`(?m)^events_timezone\s*=\s*(?:"[^"]*"|'[^']*')\s*$`)
		code = re.ReplaceAllString(code, "events_timezone = '"+timezone+"'")
	}
	return removeOldProductVersionConfig(code), nil
}

func removeOldProductVersionConfig(code string) string {
	re1 := regexp.MustCompile(`SmartContractDescriptor\(\n\s*alias="old[\s\S]*?\s\),`)
	re2 := regexp.MustCompile(`"old[\s\S]*?: \[[\s\S]*?\],`)
	code = re1.ReplaceAllString(code, "")
	code = re2.ReplaceAllString(code, "")
	return code
}

func internalVersionID(accountID string) string {
	h := fnv.New64a()
	_, _ = h.Write([]byte(accountID))
	return fmt.Sprintf("%d", int64(h.Sum64()&0x7fffffffffffffff))
}

func normalizeScenarioID(s string) string {
	s = strings.ToLower(s)
	var b strings.Builder
	lastUnderscore := false
	for _, r := range s {
		ok := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_'
		space := r == ' ' || r == '-' || r == '\t' || r == '\n'
		switch {
		case ok:
			b.WriteRune(r)
			lastUnderscore = false
		case space:
			if !lastUnderscore && b.Len() > 0 {
				b.WriteByte('_')
				lastUnderscore = true
			}
		default:
			if !lastUnderscore && b.Len() > 0 {
				b.WriteByte('_')
				lastUnderscore = true
			}
		}
	}
	out := strings.Trim(b.String(), "_")
	if out == "" {
		return "default"
	}
	return out
}
