/**
 * DeepGuard — Popup UI
 *
 * Quick-glance status + toggle + settings access + open side panel.
 */

import React, { useEffect, useState, useCallback } from 'react';
import type { TrustReport, ParticipantStatus, DeepGuardSettings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';

interface ParticipantSummary {
  participantId: string;
  displayName: string;
  report: TrustReport | null;
}

export function Popup() {
  const [settings, setSettings] = useState<DeepGuardSettings>(DEFAULT_SETTINGS);
  const [participants, setParticipants] = useState<ParticipantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [onMeet, setOnMeet] = useState(false);

  // Load data
  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 2000);
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    try {
      // Check if current tab is a Meet call
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const isMeet = tab?.url?.includes('meet.google.com') ?? false;
      setOnMeet(isMeet);

      // Fetch settings
      const settingsResp = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (settingsResp) setSettings({ ...DEFAULT_SETTINGS, ...settingsResp });

      if (isMeet) {
        // Fetch latest reports
        const reportsResp = await chrome.tabs.sendMessage(tab!.id!, { type: 'GET_ALL_REPORTS' });
        if (reportsResp?.payload) {
          const { reports, participants: parts } = reportsResp.payload;
          const summaries: ParticipantSummary[] = Object.entries(parts).map(
            ([id, { displayName }]: [string, { displayName: string }]) => ({
              participantId: id,
              displayName,
              report: (reports as Record<string, TrustReport>)[id] ?? null,
            })
          );
          setParticipants(summaries);
        }
      }
    } catch {
      // Extension not active on this page
    } finally {
      setLoading(false);
    }
  }

  const toggleEnabled = useCallback(async () => {
    const newSettings = { ...settings, enabled: !settings.enabled };
    setSettings(newSettings);
    await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', payload: newSettings });
  }, [settings]);

  const openSidePanel = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  }, []);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>🛡</span>
          <div>
            <div style={styles.logoTitle}>DeepGuard</div>
            <div style={styles.logoSubtitle}>Deepfake Detection</div>
          </div>
        </div>
        <button
          style={{
            ...styles.toggleBtn,
            background: settings.enabled
              ? 'linear-gradient(135deg, #059669, #10b981)'
              : 'rgba(255,255,255,0.1)',
          }}
          onClick={toggleEnabled}
          id="toggle-enabled"
        >
          {settings.enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Status bar */}
      <div style={styles.statusBar}>
        <div style={{ ...styles.statusDot, background: onMeet && settings.enabled ? '#10b981' : '#4b5563' }} />
        <span style={styles.statusText}>
          {onMeet
            ? settings.enabled ? 'Active — monitoring call' : 'Paused'
            : 'Waiting for Google Meet'}
        </span>
      </div>

      {/* Participants list */}
      {!loading && onMeet && participants.length > 0 && (
        <div style={styles.participantsList}>
          <div style={styles.sectionTitle}>Participants ({participants.length})</div>
          {participants.map((p) => (
            <ParticipantRow key={p.participantId} summary={p} />
          ))}
        </div>
      )}

      {!loading && onMeet && participants.length === 0 && (
        <div style={styles.emptyState}>
          <span style={{ fontSize: 32 }}>👀</span>
          <div style={styles.emptyText}>Waiting for participants...</div>
        </div>
      )}

      {!onMeet && (
        <div style={styles.emptyState}>
          <span style={{ fontSize: 32 }}>📹</span>
          <div style={styles.emptyText}>Open a Google Meet call to start analysis</div>
        </div>
      )}

      {/* Footer */}
      <div style={styles.footer}>
        <button style={styles.footerBtn} onClick={openSidePanel} id="open-sidepanel">
          📊 Session Report
        </button>
        <div style={styles.versionBadge}>v1.0.0</div>
      </div>
    </div>
  );
}

function ParticipantRow({ summary }: { summary: ParticipantSummary }) {
  const { displayName, report } = summary;
  const status: ParticipantStatus = report?.status ?? 'ANALYZING';
  const score = report?.overallTrustScore ?? 0;

  const statusConfig = {
    REAL:             { emoji: '🟢', color: '#10b981', label: 'Real' },
    SUSPICIOUS:       { emoji: '🟡', color: '#f59e0b', label: 'Suspicious' },
    LIKELY_SYNTHETIC: { emoji: '🔴', color: '#ef4444', label: 'Synthetic' },
    ANALYZING:        { emoji: '⚪', color: '#6b7280', label: 'Analyzing' },
    NO_FACE:          { emoji: '⚫', color: '#374151', label: 'No Face' },
  };

  const cfg = statusConfig[status] ?? statusConfig.ANALYZING;

  return (
    <div style={styles.participantRow}>
      <div style={styles.participantInfo}>
        <span style={{ fontSize: 14 }}>{cfg.emoji}</span>
        <span style={styles.participantName}>{displayName}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...styles.participantLabel, color: cfg.color }}>{cfg.label}</span>
        {report && <span style={styles.participantScore}>{score}%</span>}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 320,
    minHeight: 420,
    background: 'linear-gradient(180deg, #0d1117 0%, #0a0e1a 100%)',
    color: '#f9fafb',
    fontFamily: "'Inter', system-ui, sans-serif",
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 16px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    background: 'linear-gradient(135deg, rgba(59,130,246,0.1) 0%, transparent 100%)',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  logoIcon: {
    fontSize: 28,
  },
  logoTitle: {
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: '-0.02em',
    background: 'linear-gradient(90deg, #60a5fa, #a78bfa)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  logoSubtitle: {
    fontSize: 10,
    color: '#4b5563',
    marginTop: 1,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  toggleBtn: {
    padding: '6px 14px',
    borderRadius: 20,
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '0.05em',
    transition: 'all 0.2s ease',
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    background: 'rgba(255,255,255,0.03)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
    boxShadow: '0 0 6px currentColor',
  },
  statusText: {
    fontSize: 11,
    color: '#9ca3af',
  },
  sectionTitle: {
    fontSize: 10,
    color: '#4b5563',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    padding: '12px 16px 6px',
    fontWeight: 600,
  },
  participantsList: {
    flex: 1,
    overflowY: 'auto',
  },
  participantRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    transition: 'background 0.15s',
  },
  participantInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  participantName: {
    fontSize: 13,
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  participantLabel: {
    fontSize: 11,
    fontWeight: 600,
  },
  participantScore: {
    fontSize: 12,
    fontWeight: 700,
    color: '#6b7280',
    minWidth: 36,
    textAlign: 'right',
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  emptyText: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 1.5,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.02)',
  },
  footerBtn: {
    background: 'rgba(59,130,246,0.1)',
    border: '1px solid rgba(59,130,246,0.3)',
    color: '#60a5fa',
    padding: '6px 12px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 500,
    transition: 'all 0.2s',
  },
  versionBadge: {
    fontSize: 10,
    color: '#374151',
  },
};
