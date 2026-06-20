
import type { ParticipantStatus } from '../../shared/types';

interface StatusBadgeProps {
  status: ParticipantStatus;
}

const STATUS_CONFIG: Record<ParticipantStatus, { label: string; emoji: string; cssClass: string }> = {
  REAL:             { label: 'REAL',      emoji: '●', cssClass: 'real'      },
  SUSPICIOUS:       { label: 'SUSPICIOUS', emoji: '▲', cssClass: 'suspicious' },
  LIKELY_SYNTHETIC: { label: 'SYNTHETIC',  emoji: '✕', cssClass: 'synthetic'  },
  ANALYZING:        { label: 'ANALYZING',  emoji: '◌', cssClass: 'analyzing'  },
  NO_FACE:          { label: 'NO FACE',    emoji: '○', cssClass: 'no-face'    },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.ANALYZING;

  return (
    <span className={`dg-badge ${config.cssClass}`}>
      <span className="dg-badge-dot" />
      {config.label}
    </span>
  );
}
