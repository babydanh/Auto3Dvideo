import type { TabGuide } from "./helpTypes";

export function TabGuidePanel({ guide }: { guide: TabGuide }) {
  return <section className="tab-guide" aria-label={`Hướng dẫn ${guide.title}`}><div className="tab-guide-heading"><p className="eyebrow accent">{guide.eyebrow}</p><h3>{guide.title}</h3><p>{guide.purpose}</p></div><div className="tab-guide-steps">{guide.steps.map((step, index) => <div className="tab-guide-step" key={step}><span>{String(index + 1).padStart(2, "0")}</span><p>{step}</p></div>)}</div><div className="tab-guide-note"><strong>Lưu ý</strong><span>{guide.note}</span></div></section>;
}
