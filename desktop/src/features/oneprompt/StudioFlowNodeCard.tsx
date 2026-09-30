import { studioFlowStateLabels } from "./onePromptTypes";
import type { StudioFlowMediaPreview, StudioFlowNode } from "./onePromptTypes";

export function StudioFlowNodeCard({ node, onAction, onPreview, disabled }: { node: StudioFlowNode; onAction?: () => void; onPreview?: (preview: StudioFlowMediaPreview) => void; disabled?: boolean }) {
  return <article className={`studio-flow-node studio-flow-node-${node.state}`} data-node-id={node.id}>
    <div className="studio-flow-node-top"><span className="studio-flow-node-dot" /><span>{node.eyebrow}</span><b>{studioFlowStateLabels[node.state]}</b></div>
    <h4>{node.title}</h4>
    <p>{node.detail}</p>
    {node.preview && <button type="button" className="studio-flow-node-preview" onClick={() => onPreview?.(node.preview!)} aria-label={`Mở preview ${node.preview.title}`}><span className="studio-flow-node-preview-media">{node.preview.kind === "video" ? <video muted preload="metadata" src={node.preview.url} /> : <img src={node.preview.url} alt={node.preview.title} />}</span><span className="studio-flow-node-preview-caption"><b>▶ Xem preview</b><small>{node.preview.title}</small></span></button>}
    {node.actionLabel && onAction && <button type="button" className="studio-flow-node-action" onClick={onAction} disabled={disabled}>{disabled ? "⏳ Đang xử lý…" : node.actionLabel}</button>}
    <span className="studio-flow-node-port studio-flow-node-port-in" aria-hidden="true" />
    <span className="studio-flow-node-port studio-flow-node-port-out" aria-hidden="true" />
  </article>;
}
