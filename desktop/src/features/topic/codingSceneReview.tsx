import { useEffect, useState } from "react";
import type { CodingLesson, CodingSceneNode, CodingSceneState, CodingTeachingScene } from "../shared/scriptTypes";

const KIND_LABEL: Record<CodingTeachingScene["kind"], string> = {
  array: "Mảng / con trỏ",
  architecture: "Kiến trúc / dòng dữ liệu",
  code: "Mã nguồn hiển thị",
  summary: "Tổng kết",
};

const DIAGRAM_WIDTH = 640;
const NODE_BOX_WIDTH = 132;
const NODE_BOX_HEIGHT = 44;
const NODE_HALF_WIDTH = NODE_BOX_WIDTH / 2;
const NODE_HALF_HEIGHT = NODE_BOX_HEIGHT / 2;
const NODE_COLUMN_STEP = 152;
const NODE_ROW_STEP = 68;
const NODE_ORIGIN_X = 16;
const ARRAY_BAND_HEIGHT = 100;
const NODE_BAND_TOP_WITHOUT_ARRAY = 40;

function nodeCenter(node: CodingSceneNode) {
  return {
    x: NODE_ORIGIN_X + node.column * NODE_COLUMN_STEP + NODE_HALF_WIDTH,
    y: 0,
  };
}

type Point = { x: number; y: number };

/** Distance from the node center to its border along the edge direction. */
function borderDistance(direction: Point) {
  const horizontal = direction.x === 0 ? Infinity : NODE_HALF_WIDTH / Math.abs(direction.x);
  const vertical = direction.y === 0 ? Infinity : NODE_HALF_HEIGHT / Math.abs(direction.y);
  return Math.min(horizontal, vertical);
}

function shift(point: Point, direction: Point, distance: number): Point {
  return { x: point.x + direction.x * distance, y: point.y + direction.y * distance };
}

function fitLabel(label: string, limit: number) {
  return label.length > limit ? `${label.slice(0, limit - 1).trimEnd()}…` : label;
}

function ArrowHead() {
  return (
    <defs>
      <marker id="coding-scene-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-bright)" />
      </marker>
    </defs>
  );
}

function ArrayRow({ state }: { state: CodingSceneState }) {
  const count = state.values.length;
  if (count === 0) return null;
  const gap = 8;
  const width = Math.max(18, Math.min(46, (DIAGRAM_WIDTH - 32 - gap * (count - 1)) / count));
  return (
    <g>
      {state.values.map((value, index) => {
        const active = state.activeIndices.includes(index);
        const x = 16 + index * (width + gap);
        return (
          <g key={`cell-${index}`}>
            <rect
              x={x}
              y={22}
              width={width}
              height={44}
              rx={6}
              fill={active ? "rgba(143,232,218,0.18)" : "rgba(255,255,255,0.05)"}
              stroke={active ? "var(--cyan)" : "var(--border-strong)"}
              strokeWidth={active ? 2 : 1}
            />
            <text x={x + width / 2} y={50} textAnchor="middle" fontSize="15" fontFamily="'Cascadia Mono', Consolas, monospace" fill={active ? "var(--cyan)" : "var(--text)"}>
              {String(value)}
            </text>
            <text x={x + width / 2} y={82} textAnchor="middle" fontSize="10" fill="var(--muted)">{`[${index}]`}</text>
          </g>
        );
      })}
    </g>
  );
}

type EdgeGeometry = {
  index: number;
  path: string;
  labelPoint: Point;
  label: string;
  active: boolean;
};

function EdgeLayer({ scene, state, nodeTop }: { scene: CodingTeachingScene; state: CodingSceneState; nodeTop: number }) {
  const byId = new Map(scene.nodes.map((node) => [node.id, node]));
  const geometries: EdgeGeometry[] = [];
  scene.edges.forEach((edge, index) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return;
    const startCenter = { ...nodeCenter(from), y: nodeTop + from.row * NODE_ROW_STEP + NODE_HALF_HEIGHT };
    const endCenter = { ...nodeCenter(to), y: nodeTop + to.row * NODE_ROW_STEP + NODE_HALF_HEIGHT };
    const delta = { x: endCenter.x - startCenter.x, y: endCenter.y - startCenter.y };
    const length = Math.hypot(delta.x, delta.y);
    if (length === 0) return;
    const direction = { x: delta.x / length, y: delta.y / length };
    const start = shift(startCenter, direction, borderDistance(direction));
    const end = shift(endCenter, { x: -direction.x, y: -direction.y }, borderDistance(direction));
    const sameRow = from.row === to.row;
    const span = Math.abs(to.column - from.column);
    // Collinear nodes are the common case in architecture lessons, so bow those
    // edges over or under the row instead of drawing them through sibling boxes.
    if (sameRow && span > 0) {
      const above = index % 2 === 0;
      const lift = 20 + 13 * (span - 1) + NODE_HALF_HEIGHT + 8;
      const apexY = (start.y + end.y) / 2 + (above ? -lift : lift);
      geometries.push({
        index,
        path: `M ${start.x} ${start.y} C ${start.x} ${apexY}, ${end.x} ${apexY}, ${end.x} ${end.y}`,
        labelPoint: { x: (start.x + end.x) / 2, y: apexY + 4 },
        label: edge.label,
        active: state.activeEdges.includes(index),
      });
      return;
    }
    const lane = 18 + 8 * (index % 3);
    const side = (index % 2 === 0 ? 1 : -1) * (direction.x >= 0 ? 1 : -1);
    const control = {
      x: (start.x + end.x) / 2 - direction.y * lane * side,
      y: (start.y + end.y) / 2 + direction.x * lane * side,
    };
    geometries.push({
      index,
      path: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
      labelPoint: { x: (start.x + 2 * control.x + end.x) / 4, y: (start.y + 2 * control.y + end.y) / 4 },
      label: edge.label,
      active: state.activeEdges.includes(index),
    });
  });
  return (
    <g>
      {geometries.map((geometry) => (
        <path
          key={`edge-${geometry.index}`}
          d={geometry.path}
          fill="none"
          stroke={geometry.active ? "var(--cyan)" : "var(--muted-bright)"}
          strokeWidth={geometry.active ? 2.4 : 1.2}
          markerEnd="url(#coding-scene-arrow)"
        />
      ))}
      {geometries.filter((geometry) => geometry.label).map((geometry) => {
        const width = Math.min(150, geometry.label.length * 5.4 + 10);
        return (
          <g key={`edge-label-${geometry.index}`}>
            <rect x={geometry.labelPoint.x - width / 2} y={geometry.labelPoint.y - 8} width={width} height={16} rx={4} fill="var(--panel-raised)" opacity={0.94} />
            <text x={geometry.labelPoint.x} y={geometry.labelPoint.y + 4} textAnchor="middle" fontSize="10" fill={geometry.active ? "var(--cyan)" : "var(--muted-bright)"}>
              {fitLabel(geometry.label, 26)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function NodeLayer({ scene, state, nodeTop }: { scene: CodingTeachingScene; state: CodingSceneState; nodeTop: number }) {
  return (
    <g>
      {scene.nodes.map((node) => {
        const center = { x: nodeCenter(node).x, y: nodeTop + node.row * NODE_ROW_STEP + NODE_HALF_HEIGHT };
        const active = state.activeNodes.includes(node.id);
        return (
          <g key={`node-${node.id}`}>
            <rect
              x={center.x - NODE_HALF_WIDTH}
              y={center.y - NODE_HALF_HEIGHT}
              width={NODE_BOX_WIDTH}
              height={NODE_BOX_HEIGHT}
              rx={8}
              fill={active ? "rgba(143,232,218,0.16)" : "rgba(255,255,255,0.04)"}
              stroke={active ? "var(--cyan)" : "var(--border-strong)"}
              strokeWidth={active ? 2 : 1}
            />
            <title>{node.label}</title>
            <text x={center.x} y={center.y + 4} textAnchor="middle" fontSize="13" fill={active ? "var(--cyan)" : "var(--text)"}>
              {fitLabel(node.label, 16)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/**
 * Renders the reviewed snapshot straight from scene data so a reviewer can check
 * the trace, pointers and packet flow without launching the native renderer. It
 * never claims a native render succeeded.
 */
export function CodingSceneReview({ scene }: { scene: CodingTeachingScene }) {
  const [stateIndex, setStateIndex] = useState(0);
  useEffect(() => setStateIndex(0), [scene]);
  const state = scene.states[Math.min(stateIndex, scene.states.length - 1)] ?? scene.states[0];
  const hasArray = state.values.length > 0;
  const nodeRows = scene.nodes.reduce((rows, node) => Math.max(rows, node.row + 1), 0);
  // Collinear edges bow out of the node band, so the grid is offset far enough
  // down that no arc or edge label is clipped at either end of the diagram.
  const widestSpan = scene.nodes.reduce(
    (widest, node) => Math.max(widest, ...scene.nodes.map((other) => (other.row === node.row ? Math.abs(other.column - node.column) : 0))),
    0,
  );
  const arcRoom = 20 + 13 * Math.max(0, widestSpan - 1) + NODE_HALF_HEIGHT + 8 + 14;
  const nodeTop = (hasArray ? ARRAY_BAND_HEIGHT : NODE_BAND_TOP_WITHOUT_ARRAY) + (scene.nodes.length > 0 ? arcRoom : 0);
  const diagramHeight = scene.nodes.length > 0
    ? nodeTop + nodeRows * NODE_ROW_STEP + arcRoom + 12
    : hasArray ? ARRAY_BAND_HEIGHT + 16 : 120;

  return (
    <div className="coding-scene-review">
      <div className="coding-scene-head">
        <span className="coding-kind-badge">{KIND_LABEL[scene.kind]}</span>
        <strong>{state.label}</strong>
        <span className="coding-state-count">Trạng thái {stateIndex + 1}/{scene.states.length}</span>
      </div>

      <div className="coding-state-track" role="group" aria-label="Chọn trạng thái của cảnh">
        {scene.states.map((entry, index) => (
          <button
            key={`${entry.label}-${index}`}
            type="button"
            className={`coding-state-dot ${index === stateIndex ? "selected" : ""}`}
            aria-pressed={index === stateIndex}
            aria-label={`Trạng thái ${index + 1}: ${entry.label}`}
            onClick={() => setStateIndex(index)}
          >
            {index + 1}
          </button>
        ))}
      </div>

      <svg
        className="coding-scene-svg"
        viewBox={`0 0 ${DIAGRAM_WIDTH} ${diagramHeight}`}
        role="img"
        aria-label={`Sơ đồ trạng thái ${state.label}`}
      >
        <title>{`Trạng thái: ${state.label}`}</title>
        <desc>{`${scene.nodes.length} node, ${scene.edges.length} cạnh, ${state.values.length} giá trị, ${state.activeNodes.length} node đang hoạt động.`}</desc>
        <ArrowHead />
        <ArrayRow state={state} />
        <EdgeLayer scene={scene} state={state} nodeTop={nodeTop} />
        <NodeLayer scene={scene} state={state} nodeTop={nodeTop} />
      </svg>

      <dl className="coding-variables">
        {state.variables.length === 0 ? <div className="coding-variable empty">Không có biến theo dõi</div> : null}
        {state.variables.map((variable) => (
          <div className="coding-variable" key={variable.name}>
            <dt>{variable.name}</dt>
            <dd>{variable.value}</dd>
          </div>
        ))}
      </dl>

      {scene.note ? <p className="coding-scene-note">{scene.note}</p> : null}

      {scene.code.length > 0 ? (
        <pre className="coding-code" aria-label="Mã nguồn hiển thị của cảnh">
          {scene.code.map((line, index) => (
            <code key={`code-${index}`} className={index === state.activeLine ? "active-line" : ""}>
              {`${String(index + 1).padStart(2, " ")}  ${line}`}
            </code>
          ))}
        </pre>
      ) : null}
    </div>
  );
}

export function CodingLessonReview({ lesson }: { lesson: CodingLesson }) {
  return (
    <div className="coding-lesson-review">
      <div className="coding-lesson-badges">
        <span className="coding-kind-badge">{lesson.track === "algorithm" ? "Thuật toán" : "Thiết kế hệ thống"}</span>
        <span className="coding-kind-badge subtle">{lesson.planner === "local-catalog" ? "Catalog local · không mạng" : "Gateway đã cấu hình"}</span>
        <span className="coding-kind-badge subtle">{lesson.topicKey}</span>
      </div>
      <section>
        <h4>Mục tiêu học</h4>
        <ul>{lesson.learningObjectives.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
      <section>
        <h4>Giả định & giới hạn</h4>
        <ul>{lesson.assumptions.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
      <section>
        <h4>Độ phức tạp</h4>
        <p>{lesson.complexity}</p>
      </section>
      <section>
        <h4>Kiểm tra được</h4>
        <ul>{lesson.checks.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
      {lesson.sources.length > 0 ? (
        <section>
          <h4>Nguồn tham chiếu</h4>
          <ul>{lesson.sources.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}