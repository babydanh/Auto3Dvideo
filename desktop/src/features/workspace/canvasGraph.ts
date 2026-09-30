export type CanvasGraphNode =
  | { id: string; kind: "shot"; segmentId: string; x: number; y: number }
  | { id: string; kind: "asset"; assetId: string; x: number; y: number };

export type CanvasGraphEdge = { id: string; from: string; to: string };

export type CanvasGraph = {
  version: 1;
  sessionId: string;
  nodes: CanvasGraphNode[];
  edges: CanvasGraphEdge[];
  viewport: { x: number; y: number; zoom: number };
};
export type CanvasGraphSessionSaveOptions = {
  explicitSave?: boolean;
  layoutDirty?: boolean;
  persistedGraph?: CanvasGraph | null;
};

export function withCanvasGraphForSessionSave<T extends { sessionId?: string | null; canvasGraph?: CanvasGraph | null }>(
  input: T,
  candidateGraph: CanvasGraph | null | undefined,
  options: CanvasGraphSessionSaveOptions = {},
): T {
  const sessionId = input.sessionId;
  if (!sessionId || candidateGraph?.sessionId !== sessionId) return input;

  const hasPersistedGraph = options.persistedGraph?.sessionId === sessionId;
  if (!options.explicitSave && !options.layoutDirty && !hasPersistedGraph) return input;

  return { ...input, canvasGraph: candidateGraph };
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const coordinateLimit = 10_000;
const maxNodes = 128;
const maxEdges = 256;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= coordinateLimit;
}

export function isCanvasGraphValid(value: unknown, expectedSessionId?: string): value is CanvasGraph {
  if (!isRecord(value) || !hasOnlyKeys(value, ["version", "sessionId", "nodes", "edges", "viewport"])) return false;
  if (value.version !== 1 || !isIdentifier(value.sessionId)) return false;
  if (expectedSessionId !== undefined && (!isIdentifier(expectedSessionId) || value.sessionId !== expectedSessionId)) return false;
  if (!Array.isArray(value.nodes) || value.nodes.length > maxNodes || !Array.isArray(value.edges) || value.edges.length > maxEdges) return false;
  if (!isRecord(value.viewport) || !hasOnlyKeys(value.viewport, ["x", "y", "zoom"])) return false;
  if (!isCoordinate(value.viewport.x) || !isCoordinate(value.viewport.y)
    || typeof value.viewport.zoom !== "number" || !Number.isFinite(value.viewport.zoom)
    || value.viewport.zoom < 0.25 || value.viewport.zoom > 4) return false;

  const nodeIds = new Set<string>();
  const nodeIdentities = new Set<string>();
  for (const node of value.nodes) {
    if (!isRecord(node) || !isIdentifier(node.id) || !isCoordinate(node.x) || !isCoordinate(node.y)) return false;
    if (nodeIds.has(node.id)) return false;
    nodeIds.add(node.id);

    if (node.kind === "shot") {
      if (!hasOnlyKeys(node, ["id", "kind", "segmentId", "x", "y"]) || !isIdentifier(node.segmentId)) return false;
      const identity = `shot:${node.segmentId}`;
      if (nodeIdentities.has(identity)) return false;
      nodeIdentities.add(identity);
    } else if (node.kind === "asset") {
      if (!hasOnlyKeys(node, ["id", "kind", "assetId", "x", "y"]) || !isIdentifier(node.assetId)) return false;
      const identity = `asset:${node.assetId}`;
      if (nodeIdentities.has(identity)) return false;
      nodeIdentities.add(identity);
    } else {
      return false;
    }
  }

  const edgeIds = new Set<string>();
  const edgePairs = new Set<string>();
  for (const edge of value.edges) {
    if (!isRecord(edge) || !hasOnlyKeys(edge, ["id", "from", "to"])
      || !isIdentifier(edge.id) || !isIdentifier(edge.from) || !isIdentifier(edge.to)) return false;
    if (edgeIds.has(edge.id) || edge.from === edge.to || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) return false;
    const pair = `${edge.from}\u0000${edge.to}`;
    if (edgePairs.has(pair)) return false;
    edgeIds.add(edge.id);
    edgePairs.add(pair);
  }

  return true;
}

export function createCanvasGraphForSegments(
  sessionId: string,
  segmentIds: readonly string[],
  existing?: unknown,
): CanvasGraph {
  if (!isIdentifier(sessionId)) throw new Error("Canvas session ID is invalid");
  if (segmentIds.length > maxNodes) throw new Error("Canvas graph exceeds the shot-node limit");

  const seenSegments = new Set<string>();
  for (const segmentId of segmentIds) {
    if (!isIdentifier(segmentId)) throw new Error("Canvas segment ID is invalid");
    if (seenSegments.has(segmentId)) throw new Error(`Duplicate canvas segment ID: ${segmentId}`);
    seenSegments.add(segmentId);
  }

  const previous = isCanvasGraphValid(existing, sessionId) ? existing : null;
  const previousShots = new Map(
    previous?.nodes.filter((node): node is Extract<CanvasGraphNode, { kind: "shot" }> => node.kind === "shot")
      .map((node) => [node.segmentId, node]) ?? [],
  );
  const assets = previous?.nodes.filter((node): node is Extract<CanvasGraphNode, { kind: "asset" }> => node.kind === "asset") ?? [];
  const retainedAssets = assets.slice(0, Math.max(0, maxNodes - segmentIds.length));
  const usedIds = new Set([
    ...retainedAssets.map((node) => node.id),
    ...segmentIds.flatMap((segmentId) => {
      const node = previousShots.get(segmentId);
      return node ? [node.id] : [];
    }),
  ]);

  const nodes: CanvasGraphNode[] = segmentIds.map((segmentId, index) => {
    const previousNode = previousShots.get(segmentId);
    if (previousNode) return { ...previousNode };

    const preferredId = `shot:${segmentId}`;
    let id = preferredId.length <= 128 && !usedIds.has(preferredId) ? preferredId : "";
    let suffix = 0;
    while (!id) {
      const tail = `-${(index + suffix).toString(36)}`;
      const candidate = `shot-${segmentId.slice(0, 128 - 5 - tail.length)}${tail}`;
      if (!usedIds.has(candidate)) id = candidate;
      suffix += 1;
    }
    usedIds.add(id);
    return {
      id,
      kind: "shot",
      segmentId,
      x: 32 + (index % 4) * 300,
      y: 32 + Math.floor(index / 4) * 260,
    };
  });

  nodes.push(...retainedAssets.map((node) => ({ ...node })));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (previous?.edges ?? []).filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));

  return {
    version: 1,
    sessionId,
    nodes,
    edges,
    viewport: previous ? { ...previous.viewport } : { x: 0, y: 0, zoom: 1 },
  };
}
