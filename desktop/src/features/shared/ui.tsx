export function HealthRow({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className="health-row"><span>{label}</span><span className={`health-value ${tone}`}><i />{value}</span></div>;
}

export function MetricCard({ label, value, note, accent }: { label: string; value: number; note: string; accent: string }) {
  return <div className={`metric-card ${accent}`}><span className="metric-label">{label}</span><strong>{value.toString().padStart(2, "0")}</strong><span className="metric-note">{note}</span></div>;
}

export function EmptyState({ label, detail }: { label: string; detail: string }) {
  return <div className="empty-state"><div className="empty-icon">—</div><strong>{label}</strong><span>{detail}</span></div>;
}
