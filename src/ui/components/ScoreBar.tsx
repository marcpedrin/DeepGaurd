

interface ScoreBarProps {
  label: string;
  value: number;   // 0–100
  color: string;
}

export function ScoreBar({ label, value, color }: ScoreBarProps) {
  return (
    <div className="dg-sub-score">
      <div className="dg-sub-header">
        <span className="dg-sub-name">{label}</span>
        <span className="dg-sub-value">{value}%</span>
      </div>
      <div className="dg-bar-track">
        <div
          className="dg-bar-fill"
          style={{
            width: `${Math.max(0, Math.min(100, value))}%`,
            background: color,
            boxShadow: `0 0 6px ${color}60`,
          }}
        />
      </div>
    </div>
  );
}
