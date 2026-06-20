
import type { ParticipantStatus } from '../../shared/types';

interface RadialGaugeProps {
  score: number;
  status: ParticipantStatus;
  size?: number;
}

export function RadialGauge({ score, status, size = 56 }: RadialGaugeProps) {
  const radius      = (size - 8) / 2;   // 4px stroke on each side
  const circumference = 2 * Math.PI * radius;
  const offset      = circumference - (score / 100) * circumference;

  const strokeColor = statusToColor(status);

  return (
    <div className="dg-gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Track */}
        <circle
          className="dg-gauge-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
        />
        {/* Fill */}
        <circle
          className="dg-gauge-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={strokeColor}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            filter: `drop-shadow(0 0 4px ${strokeColor}80)`,
          }}
        />
      </svg>
      <div className="dg-gauge-text" style={{ color: strokeColor }}>
        {score}
      </div>
    </div>
  );
}

function statusToColor(status: ParticipantStatus): string {
  switch (status) {
    case 'REAL':             return '#10b981';
    case 'SUSPICIOUS':       return '#f59e0b';
    case 'LIKELY_SYNTHETIC': return '#ef4444';
    case 'NO_FACE':          return '#6b7280';
    default:                 return '#3b82f6';
  }
}
