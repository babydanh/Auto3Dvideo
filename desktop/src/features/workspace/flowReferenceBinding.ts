import type { FlowImageCard, ShotReferenceBinding, ShotReferenceFlowPreflight } from "../oneprompt/onePromptTypes";

export type FlowCardSelection =
  | { kind: "ready"; card: FlowImageCard }
  | { kind: "invalid_media_id" }
  | { kind: "missing" }
  | { kind: "ambiguous"; matches: number }
  | { kind: "unselectable" }
  | { kind: "preview_unavailable" };

const SAFE_MEDIA_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,255}$/;

// A media ID is bindable only when exactly one discovered card carries it and
// that card carries a preview the human can actually compare. Everything else
// stays unresolved rather than being resolved to the nearest-looking card.
export function resolveFlowCardSelection(cards: readonly FlowImageCard[], mediaId: string): FlowCardSelection {
  const requested = mediaId.trim();
  if (!SAFE_MEDIA_ID.test(requested)) return { kind: "invalid_media_id" };
  const matches = cards.filter((card) => card.mediaId === requested);
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length > 1) return { kind: "ambiguous", matches: matches.length };
  const [card] = matches;
  if (!card.selectable) return { kind: "unselectable" };
  if (!card.previewAvailable || !card.preview) return { kind: "preview_unavailable" };
  return { kind: "ready", card };
}

// A thumbnail the webview could not decode was never a comparable picture. The
// card stays listed, but unselectable, so the manual gate closes again instead
// of confirming an image nobody actually saw.
export function flowCardsAfterPreviewFailure(cards: readonly FlowImageCard[], mediaId: string): FlowImageCard[] {
  return cards.map((card) => (card.mediaId === mediaId
    ? {
        ...card,
        preview: null,
        previewAvailable: false,
        selectable: false,
        previewNote: "The Flow card image could not be decoded in this window, so it cannot be compared.",
      }
    : card));
}

export type FlowBindingBlocker =
  | "no_local_binding"
  | "preflight_failed"
  | "preflight_identity_mismatch"
  | "no_flow_project"
  | "project_mismatch"
  | "cards_not_read"
  | "card_missing"
  | "card_ambiguous"
  | "card_not_selectable"
  | "card_preview_unavailable"
  | "reference_changed"
  | "not_confirmed";

// Everything that has to name the same local thing for a preflight, a card
// read, and a saved binding to belong to one comparison. A Flow media ID is
// only ever attached to this identity, never to a nearby one.
export type FlowBindingIdentity = {
  projectId: string;
  segmentId: string;
  referenceSetId: string;
  assignmentId: string;
  assetId: string;
  assetSha256: string;
  role: string;
};

export function flowBindingIdentity(binding: ShotReferenceBinding, projectId: string): FlowBindingIdentity {
  return {
    projectId,
    segmentId: binding.segmentId,
    referenceSetId: binding.referenceSetId,
    assignmentId: binding.assignmentId,
    assetId: binding.assetId,
    assetSha256: binding.assetSha256,
    role: binding.role,
  };
}

export function sameFlowBindingIdentity(left: FlowBindingIdentity | null, right: FlowBindingIdentity | null): boolean {
  if (!left || !right) return false;
  return left.projectId === right.projectId
    && left.segmentId === right.segmentId
    && left.referenceSetId === right.referenceSetId
    && left.assignmentId === right.assignmentId
    && left.assetId === right.assetId
    && left.assetSha256 === right.assetSha256
    && left.role === right.role;
}

export type FlowBindingContext = {
  projectId: string;
  binding: ShotReferenceBinding | null;
  preflight: ShotReferenceFlowPreflight | null;
  selectedFlowProjectId: string;
  discoveredFlowProjectId: string;
  cards: readonly FlowImageCard[];
  selectedMediaId: string;
  // Identity captured when the cards were read, so a reference that changed
  // mid-comparison cannot be confirmed against a stale preview.
  discoveredFor: FlowBindingIdentity | null;
};

export const flowBindingBlockerMessages: Record<FlowBindingBlocker, string> = {
  no_local_binding: "Shot này chưa có reference local nào được gán.",
  preflight_failed: "Shot reference chưa qua kiểm tra cục bộ (asset, quyền, hash, assignment).",
  preflight_identity_mismatch: "Kết quả kiểm tra cục bộ không thuộc đúng reference của shot này; kiểm tra lại từ đầu.",
  no_flow_project: "Chưa chọn project Flow đang dùng để liên kết card ảnh.",
  project_mismatch: "Card được đọc từ project Flow khác với project đang chọn.",
  cards_not_read: "Chưa đọc được card ảnh nào trong project Flow hiện tại.",
  card_missing: "Không tìm thấy card ảnh đúng media ID đã chọn trong project Flow hiện tại.",
  card_ambiguous: "Có nhiều card cùng media ID đã chọn; không tự chọn card nào.",
  card_not_selectable: "Card đã chọn không thể dùng để gán cho shot này.",
  card_preview_unavailable: "Card đã chọn không có thumbnail đọc được để so sánh bằng mắt.",
  reference_changed: "Reference của shot đã đổi sau khi đọc card; cần đọc lại card Flow.",
  not_confirmed: "Chưa có xác nhận trực quan của người dùng cho card này.",
};

// The single gate the UI and the confirmation share. Returning the first
// blocker (rather than a boolean) keeps the reason visible, which is what
// actually stops a wrong card from being persisted.
export function resolveFlowBindingBlocker(context: FlowBindingContext): FlowBindingBlocker | null {
  const { binding, preflight } = context;
  if (!binding) return "no_local_binding";
  if (!preflight?.ready) return "preflight_failed";
  const identity = flowBindingIdentity(binding, context.projectId);
  if (!sameFlowBindingIdentity(context.discoveredFor, identity)) return "reference_changed";
  // A ready preflight is a claim about one exact local reference. Another
  // project, shot, set, assignment, asset, hash, or role means the check that
  // passed never described the reference that is about to be confirmed, and a
  // Flow media ID may never be attached on that basis.
  if (!sameFlowBindingIdentity(
    {
      projectId: preflight.projectId,
      segmentId: preflight.segmentId,
      referenceSetId: preflight.referenceSetId,
      assignmentId: preflight.assignmentId,
      assetId: preflight.assetId,
      assetSha256: preflight.assetSha256,
      role: preflight.role,
    },
    identity,
  )) {
    return "preflight_identity_mismatch";
  }
  if (!context.selectedFlowProjectId) return "no_flow_project";
  if (context.discoveredFlowProjectId !== context.selectedFlowProjectId) return "project_mismatch";
  if (!context.cards.length) return "cards_not_read";
  const selection = resolveFlowCardSelection(context.cards, context.selectedMediaId);
  if (selection.kind === "invalid_media_id") return "card_missing";
  if (selection.kind === "missing") return "card_missing";
  if (selection.kind === "ambiguous") return "card_ambiguous";
  if (selection.kind === "unselectable") return "card_not_selectable";
  if (selection.kind === "preview_unavailable") return "card_preview_unavailable";
  return null;
}

export type ConfirmedFlowBindingInput = FlowBindingContext & {
  confirmed: boolean;
  confirmedAt: string;
};

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

// Persisting the manual binding is a one-way claim about identity, so it is
// built here and nowhere else: every gate above must already be clear, and the
// result only adds the four Flow fields to the unchanged local identity.
export function buildConfirmedFlowBinding(input: ConfirmedFlowBindingInput): ShotReferenceBinding | null {
  const blocker = resolveFlowBindingBlocker(input);
  if (blocker) return null;
  if (!input.confirmed) return null;
  if (!ISO_INSTANT.test(input.confirmedAt)) return null;
  const binding = input.binding;
  if (!binding) return null;
  return {
    ...binding,
    flowProjectId: input.selectedFlowProjectId,
    flowMediaId: input.selectedMediaId.trim(),
    confirmedAt: input.confirmedAt,
    confirmationKind: "manual_visual",
  };
}
