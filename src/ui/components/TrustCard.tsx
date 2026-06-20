/**
 * DeepGuard — TrustCard Component
 *
 * The main overlay card displayed beside each participant video tile.
 * Shows status badge, overall trust score (radial gauge), and expandable
 * sub-score details.
 */

import { useState, useCallback } from 'react';
import type { Participant, TrustReport, ParticipantStatus } from '../../shared/types';
import { RadialGauge } from './RadialGauge';
import { ScoreBar } from './ScoreBar';
import { StatusBadge } from './StatusBadge';

interface TrustCardProps {
  participant: Participant;
  report: TrustReport | null;
}

export function TrustCard({ participant, report }: TrustCardProps) {
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const status: ParticipantStatus = report?.status ?? 'ANALYZING';
  const trustScore  = report?.overallTrustScore ?? 0;
  const scores      = report?.scores;
  const flags       = report?.avatarFlags;
  const latency     = report?.analysisLatencyMs;

  const activeFlags = flags
    ? Object.entries(flags)
        .filter(([, v]) => v)
        .map(([k]) => k.replace(/_/g, ' '))
    : [];

  return (
    <div
      className={`dg-card ${expanded ? 'expanded' : 'collapsed'}`}
      onClick={toggle}
      role="button"
      aria-label={`DeepGuard analysis for ${participant.displayName}`}
      title="Click to expand details"
    >
      {/* Header row */}
      <div className="dg-header">
        <span className="dg-name" title={participant.displayName}>
          {participant.displayName}
        </span>
        <StatusBadge status={status} />
      </div>

      {/* Score row */}
      {status === 'ANALYZING' || !report ? (
        <div className="dg-analyzing-pulse">
          <div className="dg-pulse-dot" />
          <div className="dg-pulse-dot" />
          <div className="dg-pulse-dot" />
          <span style={{ fontSize: 10, color: '#6b7280' }}>Analyzing...</span>
        </div>
      ) : (
        <div className="dg-score-row">
          <div>
            <div className="dg-score-label">Trust Score</div>
            <div className={`dg-score-value ${statusClass(status)}`}>
              {trustScore}%
            </div>
          </div>
          <RadialGauge score={trustScore} status={status} />
        </div>
      )}

      {/* Expanded details */}
      {expanded && scores && (
        <div className="dg-details">
          <ScoreBar
            label="Face Authenticity"
            value={scores.faceAuthenticity}
            color={scoreColor(scores.faceAuthenticity)}
          />
          <ScoreBar
            label="Temporal Consistency"
            value={scores.temporalConsistency}
            color={scoreColor(scores.temporalConsistency)}
          />
          <ScoreBar
            label="Lip Sync"
            value={scores.lipSync}
            color={scoreColor(scores.lipSync)}
          />
          <ScoreBar
            label="Avatar Risk"
            value={scores.avatarRisk}
            color={scoreColor(scores.avatarRisk)}
          />

          {activeFlags.length > 0 && (
            <div className="dg-flags">
              {activeFlags.map((flag) => (
                <span key={flag} className="dg-flag">⚠ {flag}</span>
              ))}
            </div>
          )}

          {latency !== undefined && (
            <div className="dg-latency">
              {`${latency.toFixed(0)}ms`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function statusClass(status: ParticipantStatus): string {
  switch (status) {
    case 'REAL':             return 'real';
    case 'SUSPICIOUS':       return 'suspicious';
    case 'LIKELY_SYNTHETIC': return 'synthetic';
    default:                 return 'analyzing';
  }
}

function scoreColor(score: number): string {
  if (score >= 80) return '#10b981';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}
