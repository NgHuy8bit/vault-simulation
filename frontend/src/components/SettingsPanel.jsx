import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';

export function SettingsPanel({ onClose }) {
  const [settings, setSettings] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [containers, setContainers] = useState([]);
  const [loadingContainers, setLoadingContainers] = useState(false);
  const [containerError, setContainerError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const firstInputRef = useRef(null);

  // Form state
  const [containerName, setContainerName] = useState('');
  const [containerWorkdir, setContainerWorkdir] = useState('');
  const [bunxPath, setBunxPath] = useState('');
  const [smartContractsDir, setSmartContractsDir] = useState('');
  const [runMode, setRunMode] = useState('native');
  const [simConcurrency, setSimConcurrency] = useState('4');
  const [simEnvironment, setSimEnvironment] = useState('');

  useEffect(() => {
    api.getSettings().then(({ settings: s, defaults: d }) => {
      setSettings(s);
      setDefaults(d);
      setContainerName(s.container_name ?? '');
      setContainerWorkdir(s.container_workdir ?? '');
      setBunxPath(s.bunx_path ?? '');
      setSmartContractsDir(s.smart_contracts_dir ?? '');
      setRunMode(s.run_mode ?? 'native');
      setSimConcurrency(s.sim_concurrency ?? '4');
      setSimEnvironment(s.sim_environment ?? '');
    });
    firstInputRef.current?.focus();
  }, []);

  async function detectContainers() {
    setLoadingContainers(true);
    setContainerError('');
    try {
      const { containers: list, error } = await api.listContainers();
      if (error) setContainerError(error);
      setContainers(list || []);
    } finally {
      setLoadingContainers(false);
    }
  }

  async function save() {
    setSaving(true);
    setToast(null);
    try {
      const { settings: updated } = await api.saveSettings({
        container_name: containerName,
        container_workdir: containerWorkdir,
        bunx_path: bunxPath,
        smart_contracts_dir: smartContractsDir,
        run_mode: runMode,
        sim_concurrency: simConcurrency,
        sim_environment: simEnvironment,
      });
      setSettings(updated);
      setToast({ type: 'success', message: 'Settings saved.' });
    } catch (err) {
      setToast({ type: 'error', message: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!window.confirm('Reset all settings to defaults?')) return;
    setSaving(true);
    try {
      const { settings: updated, defaults: d } = await api.resetSettings();
      setSettings(updated);
      setDefaults(d);
      setContainerName(updated.container_name ?? '');
      setContainerWorkdir(updated.container_workdir ?? '');
      setBunxPath(updated.bunx_path ?? '');
      setSmartContractsDir(updated.smart_contracts_dir ?? '');
      setRunMode(updated.run_mode ?? 'native');
      setSimConcurrency(updated.sim_concurrency ?? '4');
      setSimEnvironment(updated.sim_environment ?? '');
      setToast({ type: 'success', message: 'Reset to defaults.' });
    } catch (err) {
      setToast({ type: 'error', message: err.message });
    } finally {
      setSaving(false);
    }
  }

  function placeholder(key) {
    return defaults ? defaults[key] : '';
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>⚙ Settings</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body settings-body">
          {toast && (
            <div className={`settings-toast settings-toast--${toast.type}`}>{toast.message}</div>
          )}

          <section className="settings-section">
            <h3 className="settings-section-title">Simulation engine</h3>

            <label className="settings-label">
              run mode
              <select
                className="settings-input"
                value={runMode}
                onChange={(e) => setRunMode(e.target.value)}
              >
                <option value="native">native Go</option>
                <option value="gauge">Gauge fallback</option>
              </select>
            </label>

            <label className="settings-label">
              native concurrency
              <input
                className="settings-input"
                value={simConcurrency}
                onChange={(e) => setSimConcurrency(e.target.value)}
                placeholder={placeholder('sim_concurrency')}
              />
            </label>

            <label className="settings-label">
              simulation environment
              <input
                className="settings-input"
                value={simEnvironment}
                onChange={(e) => setSimEnvironment(e.target.value)}
                placeholder={placeholder('sim_environment') || '(framework default)'}
              />
            </label>
          </section>

          {/* ── Container ──────────────────────────────────────── */}
          <section className="settings-section">
            <h3 className="settings-section-title">Docker Container</h3>
            <p className="settings-hint">
              Container dùng khi chuyển sang <code>Gauge fallback</code>.
              Để trống → tự động tìm VS Code devcontainer.
            </p>

            <label className="settings-label">
              Container name / ID
              <div className="settings-container-row">
                <input
                  ref={firstInputRef}
                  className="settings-input"
                  value={containerName}
                  onChange={(e) => setContainerName(e.target.value)}
                  placeholder="(auto-detect)"
                />
                <button
                  className="filter"
                  onClick={detectContainers}
                  disabled={loadingContainers}
                >
                  {loadingContainers ? '…' : 'Detect'}
                </button>
              </div>
            </label>

            {containerError && (
              <div className="settings-container-error">{containerError}</div>
            )}

            {containers.length > 0 && (
              <div className="settings-container-list">
                {containers.map((c) => (
                  <button
                    key={c.id}
                    className={`settings-container-item${containerName === c.name ? ' active' : ''}`}
                    onClick={() => setContainerName(c.name)}
                  >
                    <span className="settings-container-name">{c.name}</span>
                    <span className="settings-container-meta muted">{c.image} · {c.status}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* ── Paths inside container ─────────────────────────── */}
          <section className="settings-section">
            <h3 className="settings-section-title">Paths inside container</h3>

            <label className="settings-label">
              smart-contracts workdir
              <input
                className="settings-input"
                value={containerWorkdir}
                onChange={(e) => setContainerWorkdir(e.target.value)}
                placeholder={placeholder('container_workdir')}
              />
            </label>

            <label className="settings-label">
              bunx path
              <input
                className="settings-input"
                value={bunxPath}
                onChange={(e) => setBunxPath(e.target.value)}
                placeholder={placeholder('bunx_path')}
              />
            </label>
          </section>

          {/* ── Host path ──────────────────────────────────────── */}
          <section className="settings-section">
            <h3 className="settings-section-title">Host path</h3>
            <p className="settings-hint">
              Đường dẫn đến thư mục <code>smart-contracts</code> trên máy host (để đọc spec / kết quả).
              Mặc định tự tính từ vị trí của viewer.
            </p>

            <label className="settings-label">
              smart-contracts directory
              <input
                className="settings-input settings-input--mono"
                value={smartContractsDir}
                onChange={(e) => setSmartContractsDir(e.target.value)}
                placeholder={placeholder('smart_contracts_dir')}
              />
            </label>
          </section>
        </div>

        <div className="settings-footer">
          <button className="filter" onClick={reset} disabled={saving}>
            Reset defaults
          </button>
          <div style={{ flex: 1 }} />
          <button className="filter" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
