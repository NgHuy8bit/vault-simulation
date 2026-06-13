package simengine

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"viewer/internal/settings"
)

type vaultEnvironment struct {
	CoreAPIURL  string `json:"core_api_url"`
	AccessToken string `json:"access_token"`
}

type frameworkConfig struct {
	Sim struct {
		EnvironmentName string `json:"environment_name"`
	} `json:"sim"`
}

func simulate(ctx context.Context, request map[string]any) ([]map[string]any, error) {
	env, name, err := loadVaultEnvironment()
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(env.CoreAPIURL) == "" {
		return nil, fmt.Errorf("simulation environment %q has no core_api_url", name)
	}
	if strings.TrimSpace(env.AccessToken) == "" {
		return nil, fmt.Errorf("simulation environment %q has no access_token", name)
	}

	body, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(env.CoreAPIURL, "/")+"/v1/contracts:simulate", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Auth-Token", env.AccessToken)
	req.Header.Set("grpc-timeout", "360S")

	client := &http.Client{Timeout: 6 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
		return nil, vaultErrorFromBody(raw, resp.Status)
	}

	var out []map[string]any
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 1024*1024), 64*1024*1024)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var item map[string]any
		if err := json.Unmarshal(line, &item); err != nil {
			return nil, fmt.Errorf("invalid simulator stream line: %w", err)
		}
		if errPayload, ok := item["error"]; ok && errPayload != nil {
			return out, vaultErrorFromValue(errPayload)
		}
		if _, ok := item["vault_error_code"]; ok {
			return out, vaultErrorFromValue(item)
		}
		out = append(out, item)
	}
	if err := scanner.Err(); err != nil {
		return out, err
	}
	return out, nil
}

func loadVaultEnvironment() (vaultEnvironment, string, error) {
	base := settings.SmartContractsDir()
	name := settings.SimEnvironment()
	if name == "" {
		var cfg frameworkConfig
		if err := readJSON(filepath.Join(base, "config", "framework_config.json"), &cfg); err == nil {
			name = strings.TrimSpace(cfg.Sim.EnvironmentName)
		}
	}
	if name == "" {
		name = "sim"
	}

	envs := map[string]vaultEnvironment{}
	if err := readJSON(filepath.Join(base, "config", "environment_config.json"), &envs); err != nil {
		return vaultEnvironment{}, name, err
	}
	env, ok := envs[name]
	if !ok {
		return vaultEnvironment{}, name, fmt.Errorf("simulation environment %q not found in config/environment_config.json", name)
	}
	return env, name, nil
}

func readJSON(path string, dst any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, dst)
}

func vaultErrorFromBody(raw []byte, status string) error {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return fmt.Errorf("Vault simulator HTTP error: %s", status)
	}
	return vaultErrorFromValue(json.RawMessage(raw))
}

func vaultErrorFromValue(value any) error {
	var decoded map[string]any
	switch t := value.(type) {
	case json.RawMessage:
		if err := json.Unmarshal(t, &decoded); err != nil {
			return fmt.Errorf("Vault simulator error: %s", string(t))
		}
	case map[string]any:
		decoded = t
	default:
		return fmt.Errorf("Vault simulator error: %v", value)
	}
	code, _ := decoded["vault_error_code"].(string)
	msg, _ := decoded["message"].(string)
	if msg == "" {
		if e, ok := decoded["error"].(map[string]any); ok {
			code, _ = e["vault_error_code"].(string)
			msg, _ = e["message"].(string)
		}
	}
	if msg == "" {
		raw, _ := json.Marshal(decoded)
		return fmt.Errorf("Vault simulator error: %s", string(raw))
	}
	if code == "" {
		return fmt.Errorf("Vault simulator error: %s", msg)
	}
	return fmt.Errorf("Vault simulator error %s: %s", code, msg)
}
