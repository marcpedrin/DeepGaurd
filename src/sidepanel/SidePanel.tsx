/**
 * DeepGuard — Side Panel
 *
 * Full session report: all participants, score history chart,
 * settings toggles, and export button.
 */

import { useEffect, useState, useCallback } from 'react';
import type { TrustReport, ParticipantStatus, DeepGuardSettings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';

interface LiveData {
  reports: Record<string, TrustReport>;
  participants: Record<string, { displayName: string }>;
}

export function SidePanel() {
  const [liveData, setLiveData]     = useState<LiveData>({ reports: {}, participants: {} });
  const [settings, setSettings]     = useState<DeepGuardSettings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab]   = useState<'live' | 'settings'>('live');
  const [exporting, setExporting]   = useState(false);
  const [onMeet, setOnMeet]         = useState(false);

  // Polling for live data
  useEffect(() => {
    const load = async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        setOnMeet(tab?.url?.includes('meet.google.com') ?? false);

        const settingsResp = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
        if (settingsResp) setSettings({ ...DEFAULT_SETTINGS, ...settingsResp });

        if (tab?.id && tab.url?.includes('meet.google.com')) {
          const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_ALL_REPORTS' });
          if (resp?.payload) setLiveData(resp.payload);
        }
      } catch {/* not on Meet */}
    };

    load();
    const interval = setInterval(load, 1500);
    return () => clearInterval(interval);
  }, []);

  const exportJson = useCallback(async () => {
    setExporting(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        const resp = await chrome.runtime.sendMessage({ type: 'GET_SESSION_REPORT' });
        if (resp) {
          const blob = new Blob([JSON.stringify(resp, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `deepguard-session-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
        }
      }
    } finally {
      setExporting(false);
    }
  }, []);

  const updateSetting = useCallback(async (patch: Partial<DeepGuardSettings>) => {
    const newSettings = { ...settings, ...patch };
    setSettings(newSettings);
    await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', payload: newSettings });
  }, [settings]);

  const participantEntries = Object.entries(liveData.participants);

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerTop}>
          <span style={s.headerIcon}>🛡</span>
          <div>
            <div style={s.headerTitle}>DeepGuard</div>
            <div style={s.headerSub}>Real-time deepfake detection</div>
          </div>
        </div>
        <div style={s.tabs}>
          {(['live', 'settings'] as const).map((tab) => (
            <button
              key={tab}
              id={`tab-${tab}`}
              style={{ ...s.tab, ...(activeTab === tab ? s.tabActive : {}) }}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'live' ? '📊 Live' : '⚙️ Settings'}
            </button>
          ))}
        </div>
      </div>

      {/* Live Tab */}
      {activeTab === 'live' && (
        <div style={s.content}>
          {!onMeet ? (
            <EmptyState emoji="📹" text="Open a Google Meet call to begin analysis" />
          ) : participantEntries.length === 0 ? (
            <EmptyState emoji="👀" text="Waiting for participants to join..." />
          ) : (
            <>
              {participantEntries.map(([id, { displayName }]) => {
                const report = liveData.reports[id] ?? null;
                return (
                  <ParticipantCard
                    key={id}
                    displayName={displayName}
                    report={report}
                  />
                );
              })}
            </>
          )}

          {/* Export button */}
          {onMeet && participantEntries.length > 0 && (
            <div style={s.exportRow}>
              <button
                style={{ ...s.exportBtn, opacity: exporting ? 0.6 : 1 }}
                onClick={exportJson}
                disabled={exporting}
                id="export-json"
              >
                {exporting ? 'Exporting...' : '📥 Export Session (JSON)'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div style={s.content}>
          <div style={s.settingsSection}>Analysis</div>

          <ToggleSetting
            id="setting-enabled"
            label="Enable DeepGuard"
            description="Pause/resume all analysis"
            value={settings.enabled}
            onChange={(v) => updateSetting({ enabled: v })}
          />
          <ToggleSetting
            id="setting-overlay"
            label="Show Overlay"
            description="Display overlay cards in Meet"
            value={settings.showOverlay}
            onChange={(v) => updateSetting({ showOverlay: v })}
          />
          <ToggleSetting
            id="setting-temporal"
            label="Temporal Analysis"
            description="Detect flickering and warping artifacts"
            value={settings.enableTemporalAnalysis}
            onChange={(v) => updateSetting({ enableTemporalAnalysis: v })}
          />
          <ToggleSetting
            id="setting-lipsync"
            label="Lip Sync Analysis"
            description="Compare mouth movement with audio"
            value={settings.enableLipSync}
            onChange={(v) => updateSetting({ enableLipSync: v })}
          />
          <ToggleSetting
            id="setting-avatar"
            label="AI Avatar Detection"
            description="Detect Synthesia, HeyGen, face-swap"
            value={settings.enableAvatarDetection}
            onChange={(v) => updateSetting({ enableAvatarDetection: v })}
          />

          <div style={s.settingsSection}>Capture Rate</div>
          <div style={s.settingRow}>
            <div>
              <div style={s.settingLabel}>Frames Per Second</div>
              <div style={s.settingDesc}>Higher = more accurate but more CPU usage</div>
            </div>
            <select
              id="setting-fps"
              style={s.select}
              value={settings.targetFps}
              onChange={(e) => updateSetting({ targetFps: Number(e.target.value) as 1 | 2 })}
            >
              <option value={1}>1 FPS</option>
              <option value={2}>2 FPS</option>
            </select>
          </div>

          <div style={s.settingsSection}>Alert Threshold</div>
          <div style={s.settingRow}>
            <div>
              <div style={s.settingLabel}>Alert when trust score drops below</div>
              <div style={s.settingDesc}>{settings.alertThreshold}%</div>
            </div>
            <input
              id="setting-threshold"
              type="range"
              min={20}
              max={90}
              step={5}
              value={settings.alertThreshold}
              onChange={(e) => updateSetting({ alertThreshold: Number(e.target.value) })}
              style={{ width: 80 }}
            />
          </div>

          <div style={s.privacyNote}>
            🔒 All analysis is performed <strong>100% locally</strong> on your device.
            No video frames, audio, or participant data ever leave your browser.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ParticipantCard({
  displayName,
  report,
}: {
  displayName: string;
  report: TrustReport | null;
}) {
  const status: ParticipantStatus = report?.status ?? 'ANALYZING';
  const score = report?.overallTrustScore ?? 0;

  const statusStyles: Record<ParticipantStatus, { border: string; glow: string }> = {
    REAL:             { border: 'rgba(16,185,129,0.3)',  glow: 'rgba(16,185,129,0.1)' },
    SUSPICIOUS:       { border: 'rgba(245,158,11,0.3)',  glow: 'rgba(245,158,11,0.1)' },
    LIKELY_SYNTHETIC: { border: 'rgba(239,68,68,0.3)',   glow: 'rgba(239,68,68,0.1)' },
    ANALYZING:        { border: 'rgba(59,130,246,0.2)',  glow: 'transparent' },
    NO_FACE:          { border: 'rgba(75,85,99,0.3)',    glow: 'transparent' },
  };

  const { border, glow } = statusStyles[status] ?? statusStyles.ANALYZING;
  const scoreColor = score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div style={{ ...s.card, borderColor: border, background: `linear-gradient(135deg, ${glow} 0%, rgba(17,24,39,0.9) 100%)` }}>
      <div style={s.cardHeader}>
        <div style={s.cardName}>{displayName}</div>
        <div style={{ ...s.cardStatus, color: scoreColor }}>
          {status.replace('_', ' ')}
        </div>
      </div>

      {report ? (
        <>
          <div style={s.cardScore}>
            <span style={{ ...s.cardScoreNum, color: scoreColor }}>{score}%</span>
            <span style={s.cardScoreLabel}>Trust Score</span>
          </div>

          <div style={s.scoreGrid}>
            {[
              { label: 'Face Auth', value: report.scores.faceAuthenticity },
              { label: 'Temporal', value: report.scores.temporalConsistency },
              { label: 'Lip Sync', value: report.scores.lipSync },
              { label: 'Avatar Risk', value: report.scores.avatarRisk },
            ].map(({ label, value }) => (
              <div key={label} style={s.scoreItem}>
                <div style={s.scoreItemLabel}>{label}</div>
                <div style={{
                  ...s.scoreItemBar,
                  background: value >= 80 ? '#10b981' : value >= 50 ? '#f59e0b' : '#ef4444',
                  width: `${value}%`,
                }} />
                <div style={s.scoreItemValue}>{value}%</div>
              </div>
            ))}
          </div>

          {report.analysisLatencyMs > 0 && (
            <div style={s.latency}>{report.analysisLatencyMs.toFixed(0)}ms latency</div>
          )}
        </>
      ) : (
        <div style={s.analyzing}>Analyzing...</div>
      )}
    </div>
  );
}

function ToggleSetting({
  id,
  label,
  description,
  value,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div style={s.settingRow}>
      <div>
        <div style={s.settingLabel}>{label}</div>
        <div style={s.settingDesc}>{description}</div>
      </div>
      <button
        id={id}
        style={{
          ...s.toggle,
          background: value ? 'linear-gradient(135deg, #059669, #10b981)' : 'rgba(255,255,255,0.1)',
        }}
        onClick={() => onChange(!value)}
      >
        <div style={{
          ...s.toggleThumb,
          transform: value ? 'translateX(20px)' : 'translateX(0)',
        }} />
      </button>
    </div>
  );
}

function EmptyState({ emoji, text }: { emoji: string; text: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: '#6b7280' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>{emoji}</div>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>{text}</div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'linear-gradient(180deg, #0d1117 0%, #0a0e1a 100%)',
    color: '#f9fafb',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  header: {
    padding: '16px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    background: 'linear-gradient(135deg, rgba(59,130,246,0.08) 0%, transparent 100%)',
    flexShrink: 0,
  },
  headerTop: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  headerIcon: { fontSize: 28 },
  headerTitle: {
    fontSize: 18,
    fontWeight: 700,
    background: 'linear-gradient(90deg, #60a5fa, #a78bfa)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  headerSub: { fontSize: 10, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.05em' },
  tabs: { display: 'flex', gap: 4 },
  tab: {
    flex: 1,
    padding: '6px 0',
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
    transition: 'all 0.2s',
  },
  tabActive: {
    background: 'rgba(59,130,246,0.15)',
    borderColor: 'rgba(59,130,246,0.4)',
    color: '#60a5fa',
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px',
  },
  card: {
    border: '1px solid',
    borderRadius: 12,
    padding: '14px',
    marginBottom: 10,
    transition: 'all 0.3s',
  },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardName: { fontSize: 14, fontWeight: 600, color: '#e5e7eb' },
  cardStatus: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' },
  cardScore: { display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 },
  cardScoreNum: { fontSize: 28, fontWeight: 700, lineHeight: 1 },
  cardScoreLabel: { fontSize: 11, color: '#6b7280' },
  scoreGrid: { display: 'flex', flexDirection: 'column', gap: 6 },
  scoreItem: { display: 'flex', alignItems: 'center', gap: 8 },
  scoreItemLabel: { fontSize: 10, color: '#9ca3af', width: 72, flexShrink: 0 },
  scoreItemBar: {
    height: 3,
    borderRadius: 999,
    transition: 'width 0.6s ease',
    maxWidth: 'calc(100% - 120px)',
  },
  scoreItemValue: { fontSize: 10, color: '#d1d5db', marginLeft: 'auto', flexShrink: 0 },
  latency: { marginTop: 8, fontSize: 10, color: '#374151', textAlign: 'right' },
  analyzing: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  exportRow: { padding: '8px 0 4px' },
  exportBtn: {
    width: '100%',
    padding: '10px',
    background: 'rgba(59,130,246,0.15)',
    border: '1px solid rgba(59,130,246,0.4)',
    borderRadius: 10,
    color: '#60a5fa',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    transition: 'all 0.2s',
  },
  settingsSection: {
    fontSize: 10,
    color: '#4b5563',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontWeight: 600,
    padding: '12px 0 6px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    marginBottom: 4,
  },
  settingRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '10px 0',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  settingLabel: { fontSize: 13, fontWeight: 500, color: '#e5e7eb' },
  settingDesc: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  toggle: {
    width: 44,
    height: 24,
    borderRadius: 12,
    border: 'none',
    cursor: 'pointer',
    position: 'relative',
    flexShrink: 0,
    transition: 'background 0.2s',
    padding: 0,
  },
  toggleThumb: {
    position: 'absolute',
    top: 2,
    left: 2,
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: '#fff',
    transition: 'transform 0.2s',
    boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
  },
  select: {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: '#e5e7eb',
    padding: '4px 8px',
    fontSize: 12,
    cursor: 'pointer',
  },
  privacyNote: {
    marginTop: 20,
    padding: 12,
    background: 'rgba(16,185,129,0.08)',
    border: '1px solid rgba(16,185,129,0.2)',
    borderRadius: 10,
    fontSize: 12,
    color: '#6ee7b7',
    lineHeight: 1.5,
  },
};
