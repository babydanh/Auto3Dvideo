// DOM-free decisions shared by the BrowserOS and Playwright Google Flow
// workers. Both workers read the same Flow composer through different
// bridges, so the rules that decide whether a shot may be attached to a
// specific image card live here exactly once.
//
// Two routes exist and must never be mixed:
//   * explicit  - a shot carries a manually confirmed `flowMediaId`. Only that
//                 exact visible media ID may be used, and the ingredient chip
//                 must show that same media ID. There is no label fallback.
//   * legacy    - a Flow-origin reference with no explicit binding keeps the
//                 historical shot/revision label lookup.

export const MAX_FLOW_IMAGE_CARDS = 24;
export const MAX_FLOW_CARD_LABEL = 120;
export const MAX_FLOW_CARD_PREVIEW_CHARS = 262_144;

const SAFE_MEDIA_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,255}$/;
const PREVIEW_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;

// A syntactically well-formed data URL is not yet a picture. Flow card
// thumbnails arrive as inline bytes, and a payload whose decoded signature is
// not the image type it claims can never be compared against the local asset,
// so it is rejected here rather than rendered as a broken box.
const IMAGE_SIGNATURES = {
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff],
};
const RIFF_SIGNATURE = "RIFF";
const WEBP_SIGNATURE = "WEBP";

// A list that stopped early is not a shorter list, it is an unfinished one:
// the card that would disambiguate a media ID may be in the part nobody read.
// No sampled card is bindable until the whole visible grid has been listed.
const TRUNCATED_CARD_LIST_NOTE =
  "Danh sách card ảnh bị cắt bớt nên không chứng minh được media ID nào là duy nhất; không chọn card nào.";

// Only the leading bytes are decoded: a bounded thumbnail never needs more,
// and a full decode of a 256 KB payload would allocate for nothing.
function previewBytesAreImage(mime, base64) {
  let head = "";
  try {
    head = atob(base64.slice(0, 16));
  } catch {
    return false;
  }
  const signature = IMAGE_SIGNATURES[mime];
  if (signature) {
    return signature.every((value, index) => head.charCodeAt(index) === value);
  }
  if (mime === "image/webp") {
    return head.slice(0, 4) === RIFF_SIGNATURE && head.slice(8, 12) === WEBP_SIGNATURE;
  }
  return false;
}

const CONTROL_CHARS = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "]+", "g");

export function isSafeFlowMediaId(value) {
  return typeof value === "string" && SAFE_MEDIA_ID.test(value.trim());
}

// The download route still asks for "whichever media is newest" instead of
// naming a card, and that request travels the same channel as a card media ID.
export const FLOW_NEWEST_MEDIA_ID = "__newest__";

// A request that names the media to act on carries either one card media ID or
// that explicit sentinel. Both are checked against the one card contract that
// discovery, the session schema and the Rust parser share, so a card that could
// be discovered and saved can always be attached, and nothing else gets in.
export function isSafeFlowMediaIdArgument(value) {
  if (typeof value !== "string") return false;
  const candidate = value.trim();
  return candidate === FLOW_NEWEST_MEDIA_ID || isSafeFlowMediaId(candidate);
}

// Card labels come straight from Flow's own accessibility text, so they are
// collapsed, control-stripped and bounded before any caller can render them.
export function sanitizeFlowCardLabel(value) {
  return String(value ?? "")
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FLOW_CARD_LABEL);
}

// A preview is only usable when the page could actually read the card pixels
// as an image. A remote URL, a blob handle, an oversized payload, or bytes
// whose decoded signature does not match the declared type is dropped rather
// than forwarded, because an unusable preview must block a manual comparison
// instead of silently showing an empty box.
export function sanitizeFlowCardPreview(value) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_FLOW_CARD_PREVIEW_CHARS) return null;
  const match = candidate.match(PREVIEW_DATA_URL);
  if (!match) return null;
  const mime = candidate.slice(5, candidate.indexOf(";"));
  if (!previewBytesAreImage(mime, match[1])) return null;
  return { mime, base64: match[1] };
}

export function flowProjectIdFromProjectUrl(value) {
  return String(value ?? "").match(/\/project\/([A-Za-z0-9-]+)/i)?.[1] ?? "";
}

// Turns the raw evaluate result into the bounded, sanitized card list the UI
// is allowed to see. Every observed card is kept, including a repeated media
// ID: dropping the second copy would turn an ambiguous card into a
// confidently selectable one, so duplicates survive as unselectable cards.
export function normalizeFlowImageCards(rawCards, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || MAX_FLOW_IMAGE_CARDS, 1), MAX_FLOW_IMAGE_CARDS);
  // The caller's own read may already have been cut short even when what it
  // handed over happens to fit inside the bound, so an explicit truncated
  // answer is honoured as strongly as an overflow here.
  const reportTruncated = options.truncated === true;
  const observed = [];
  let skipped = 0;
  for (const raw of Array.isArray(rawCards) ? rawCards : []) {
    const mediaId = String(raw?.mediaId ?? "").trim();
    if (!isSafeFlowMediaId(mediaId)) {
      skipped += 1;
      continue;
    }
    observed.push({
      mediaId,
      label: sanitizeFlowCardLabel(raw?.label),
      preview: sanitizeFlowCardPreview(raw?.preview),
      selectableByPage: raw?.selectable !== false,
      previewNote: String(raw?.previewNote ?? "Flow did not expose a readable thumbnail for this card.").slice(0, 200),
    });
  }
  // Counts are taken over everything the page showed, not over the bounded
  // slice, so a repeat that fell outside the limit still disambiguates the
  // copy that stayed inside it.
  const counts = new Map();
  for (const card of observed) counts.set(card.mediaId, (counts.get(card.mediaId) ?? 0) + 1);
  const duplicateMediaIds = [...counts.entries()].filter(([, count]) => count > 1).map(([mediaId]) => mediaId);
  const duplicates = new Set(duplicateMediaIds);
  const cards = observed.map((card, index) => {
    const duplicate = duplicates.has(card.mediaId);
    return {
      mediaId: card.mediaId,
      label: card.label || `Flow image card ${index + 1}`,
      preview: card.preview ? `data:${card.preview.mime};base64,${card.preview.base64}` : null,
      previewAvailable: card.preview !== null,
      previewNote: duplicate
        ? "Flow shows more than one card with this media ID, so none of them can be chosen."
        : card.preview ? "" : card.previewNote,
      // Identity and comparability are separate: a card the page could not
      // read pixels for, or one whose media ID is not unique, stays listed but
      // can never be confirmed.
      selectable: !duplicate && card.preview !== null && card.selectableByPage,
    };
  });
  // Counting more cards than the bound keeps is not a detail: the copies left
  // out are exactly the ones that could still duplicate a media ID, so the
  // whole read fails closed instead of letting a sampled card look unique.
  const truncated = reportTruncated || cards.length > limit;
  const kept = cards
    .slice(0, limit)
    .map((card) => (truncated ? { ...card, previewNote: TRUNCATED_CARD_LIST_NOTE, selectable: false } : card));
  return {
    cards: kept,
    duplicateMediaIds,
    truncated,
    skipped,
  };
}

// A media ID is only bindable when exactly one visible card carries it and its
// preview can actually be compared against the local asset.
export function resolveFlowCardSelection(cards, mediaId) {
  const requested = String(mediaId ?? "").trim();
  if (!isSafeFlowMediaId(requested)) return { kind: "invalid_media_id" };
  const matches = (Array.isArray(cards) ? cards : []).filter((card) => card?.mediaId === requested);
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length > 1) return { kind: "ambiguous", matches: matches.length };
  const [card] = matches;
  if (!card.selectable) return { kind: "not_selectable" };
  if (!card.previewAvailable) return { kind: "preview_unavailable" };
  return { kind: "ready", card };
}

// A chip belongs to the selected card only when the composer itself proves the
// media identity; a chip with no readable identity is never treated as a match.
export function chipMatchesMediaId(chip, mediaId) {
  if (!chip || !mediaId) return false;
  if (chip.mediaId && String(chip.mediaId) === mediaId) return true;
  const source = String(chip.source ?? "");
  return Boolean(source) && source.includes(mediaId);
}

function ingredientChips(state) {
  if (Array.isArray(state?.chips)) {
    return state.chips
      .filter((chip) => chip && typeof chip === "object")
      .map((chip) => ({ mediaId: String(chip.mediaId ?? ""), source: String(chip.source ?? "") }));
  }
  const count = Number(state?.ingredientCount ?? 0);
  if (!Number.isFinite(count) || count <= 0) return [];
  return [{ mediaId: String(state?.sourceMediaId ?? ""), source: String(state?.chipSource ?? "") }];
}

// An explicitly bound shot accepts the composer only when exactly one
// ingredient is visible and it is the selected media. A second chip is a
// swapped/stale ingredient even when the first one happens to match.
export function verifyExplicitIngredientChip(state, mediaId) {
  if (!isSafeFlowMediaId(mediaId)) return { ready: false, reason: "invalid_media_id" };
  if (!state || typeof state !== "object" || typeof state.editorFound !== "boolean") {
    return { ready: false, reason: "invalid_ingredient_state" };
  }
  if (!state.editorFound) return { ready: false, reason: "prompt_editor_not_found" };
  if (Array.isArray(state.chips)) {
    if (!state.chips.every((chip) => chip && typeof chip === "object"
      && typeof chip.mediaId === "string" && typeof chip.source === "string")) {
      return { ready: false, reason: "invalid_ingredient_state" };
    }
  } else if (!Number.isSafeInteger(state.ingredientCount) || state.ingredientCount < 0
    || (state.sourceMediaId !== null && typeof state.sourceMediaId !== "string")) {
    return { ready: false, reason: "invalid_ingredient_state" };
  }
  const chips = ingredientChips(state);
  if (chips.length === 0) return { ready: false, reason: "no_ingredient_chip" };
  if (chips.length > 1) return { ready: false, reason: "multiple_ingredient_chips", chipCount: chips.length };
  if (chips[0].mediaId !== mediaId) return { ready: false, reason: "mismatched_ingredient_chip" };
  return { ready: true, reason: "exact_ingredient_chip", sourceMediaId: mediaId };
}

// The legacy label route keeps its historical shape: the first visible chip
// decides, and any leftover image ingredient blocks before Animate.
export function verifyLegacyIngredientChip(state, mediaId) {
  const chips = ingredientChips(state);
  const [first] = chips;
  if (first && state?.editorFound && chipMatchesMediaId(first, mediaId)) {
    return { ready: true, reason: "legacy_ingredient_chip", sourceMediaId: mediaId };
  }
  if (chips.length > 0) return { ready: false, reason: "mismatched_ingredient_chip", chipCount: chips.length };
  return { ready: false, reason: "no_ingredient_chip" };
}

export function verifyFlowIngredientChip(state, mediaId, { explicit }) {
  return explicit
    ? verifyExplicitIngredientChip(state, mediaId)
    : verifyLegacyIngredientChip(state, mediaId);
}

// Before Animate, an explicit binding must be able to see its own card, and it
// must be the only card wearing that media ID. Ambiguity is refused instead of
// resolved by picking the first match.
export function verifyExactMediaPresence(presence, mediaId) {
  if (!isSafeFlowMediaId(mediaId)) return { ok: false, reason: "invalid_media_id" };
  const matchCount = Number(presence?.matchCount ?? 0);
  const visibleCount = Number(presence?.visibleCount ?? 0);
  if (matchCount === 0) return { ok: false, reason: "media_absent" };
  if (matchCount > 1) return { ok: false, reason: "media_duplicate", matchCount };
  if (visibleCount === 0) return { ok: false, reason: "media_not_visible" };
  return { ok: true, reason: "exact_media_visible" };
}

export const flowExactMediaMessages = {
  invalid_ingredient_state: "Flow trả về trạng thái ingredient không đọc được; dừng trước khi nhập prompt hoặc Generate.",
  invalid_media_id: "media ID của binding không hợp lệ.",
  media_absent: "Không tìm thấy card ảnh đúng media ID đã xác nhận trong project Flow hiện tại; không tự chọn card khác.",
  media_duplicate: "Có nhiều card cùng media ID đã xác nhận trong project Flow; không tự chọn.",
  media_not_visible: "Card đúng media ID đã xác nhận không hiển thị trong project Flow hiện tại.",
  media_scan_truncated: "Flow đang hiển thị quá nhiều card ảnh để đọc hết; dừng lại thay vì coi card đầu tiên là card duy nhất.",
  no_ingredient_chip: "Video composer chưa có ingredient ảnh.",
  multiple_ingredient_chips: "Video composer đang có nhiều ingredient ảnh; không gắn nhầm.",
  ingredient_scan_truncated: "Video composer có quá nhiều ingredient ảnh để đọc hết; dừng lại thay vì chỉ kiểm tra vài chip đầu.",
  mismatched_ingredient_chip: "Video composer đang giữ ingredient ảnh khác; dừng trước khi nhập prompt hoặc Generate.",
  prompt_editor_not_found: "Video composer không có ô prompt nên ingredient chưa được xác nhận.",
  exact_ingredient_chip: "Ingredient ảnh đúng media ID đã xác nhận.",
  legacy_ingredient_chip: "Ingredient ảnh đã được gắn từ card lịch sử.",
};

export function flowExactMediaMessage(reason) {
  return flowExactMediaMessages[reason] ?? "Flow chưa xác nhận được card ảnh đã chọn.";
}
