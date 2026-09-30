import assert from "node:assert/strict";
import {
  FLOW_NEWEST_MEDIA_ID,
  flowExactMediaMessage,
  flowProjectIdFromProjectUrl,
  isSafeFlowMediaId,
  isSafeFlowMediaIdArgument,
  MAX_FLOW_CARD_LABEL,
  normalizeFlowImageCards,
  resolveFlowCardSelection,
  sanitizeFlowCardPreview,
  verifyExactMediaPresence,
  verifyExplicitIngredientChip,
  verifyFlowIngredientChip,
} from "./flow_exact_media.mjs";
import { BrowserOsFlow } from "./browseros_flow_worker.mjs";
import { attachConfirmedMediaForAnimation, runAction } from "./playwright_flow_worker.mjs";
import { buildConfirmedFlowBinding, flowBindingIdentity, flowCardsAfterPreviewFailure, resolveFlowBindingBlocker } from "../desktop/src/features/workspace/flowReferenceBinding.ts";

// Real inline image bytes. "QUJD" decodes to "ABC", which is not any image.
const JPEG_PREVIEW = "data:image/jpeg;base64,/9j/4AAQSkZJRgAB";
const PNG_PREVIEW = "data:image/png;base64,iVBORw0KGgo=";
const WEBP_PREVIEW = "data:image/webp;base64,UklGRiQAAABXRUJQ";
const PREVIEW = JPEG_PREVIEW;
const MEDIA = "media-alpha";

// --- discovered cards are bounded, sanitized and never auto-selected -------
const normalized = normalizeFlowImageCards([
  { mediaId: MEDIA, label: "  hero\r\nshot  ", preview: PREVIEW },
  { mediaId: "media-beta", label: "remote only", preview: "https://lh3.googleusercontent.com/secret" },
  { mediaId: MEDIA, label: "duplicate", preview: PREVIEW },
  { mediaId: "not a media id", label: "malformed", preview: PREVIEW },
  { mediaId: "not-an-image", label: "wrong kind", preview: "data:image/svg+xml;base64,QUJD" },
]);
assert.deepEqual(normalized.cards.map((card) => card.mediaId), [MEDIA, "media-beta", MEDIA, "not-an-image"]);
assert.deepEqual(normalized.duplicateMediaIds, [MEDIA], "a repeated media ID is reported, never merged away");
assert.equal(normalized.cards[0].selectable, false, "the surviving first copy of a repeated media ID is not bindable");
assert.equal(normalized.cards[2].selectable, false, "the second copy of a repeated media ID is not bindable either");
assert.equal(normalized.cards[0].previewAvailable, true, "a duplicate is a comparable preview, it just is not unique");
assert.equal(normalized.cards[3].previewAvailable, false, "an SVG payload is not a comparable image preview");
assert.equal(normalized.cards[3].selectable, false);
assert.equal(normalized.cards[1].previewAvailable, false, "a card the page could not read is never comparable");
assert.equal(normalized.cards[1].preview, null, "a remote preview URL never reaches the UI");
assert.equal(resolveFlowCardSelection(normalized.cards, MEDIA).kind, "ambiguous", "a repeated media ID stays ambiguous");
assert.equal(resolveFlowCardSelection(normalized.cards, "media-beta").kind, "not_selectable", "a card with no readable thumbnail is never selectable");
assert.equal(resolveFlowCardSelection(normalized.cards, "media-missing").kind, "missing");
assert.equal(resolveFlowCardSelection(normalized.cards, "not a media id").kind, "invalid_media_id");
assert.equal(resolveFlowCardSelection([...normalized.cards, normalized.cards[0]], MEDIA).kind, "ambiguous");
assert.equal(normalizeFlowImageCards([{ mediaId: MEDIA, label: "x".repeat(400), preview: PREVIEW }]).cards[0].label.length, MAX_FLOW_CARD_LABEL);
assert.equal(flowProjectIdFromProjectUrl("https://flow.google.com/project/proj-9/tools"), "proj-9");
assert.equal(isSafeFlowMediaId("media-alpha"), true);
assert.equal(isSafeFlowMediaId("media alpha"), false);

// A repeat outside the bounded slice still disambiguates the copy that stayed.
const bounded = normalizeFlowImageCards(
  [...Array.from({ length: 24 }, (_unused, index) => ({ mediaId: `card-${index}`, preview: PREVIEW })),
   { mediaId: "card-0", preview: PREVIEW }],
  { limit: 24 },
);
assert.equal(bounded.cards.length, 24);
assert.equal(bounded.truncated, true);
assert.equal(bounded.cards[0].selectable, false, "a repeat that fell outside the bound still disambiguates card-0");

// A read that stopped early is not a shorter list, it is an unfinished one: the
// copy that would disambiguate a media ID may be in the part nobody read, so
// nothing sampled from it is bindable.
const overflowedRead = normalizeFlowImageCards(
  Array.from({ length: 25 }, (_unused, index) => ({ mediaId: `card-${index}`, preview: PREVIEW })),
  { limit: 24 },
);
assert.equal(overflowedRead.cards.length, 24);
assert.equal(overflowedRead.truncated, true);
assert.equal(
  overflowedRead.cards.every((card) => card.selectable === false),
  true,
  "a unique-looking card inside an overflowing grid may still have a twin nobody read",
);
assert.equal(resolveFlowCardSelection(overflowedRead.cards, "card-3").kind, "not_selectable");

// The caller's own read can answer that it was cut short even when what it
// handed over happens to fit the bound, and that answer is the one that counts.
const declaredTruncated = normalizeFlowImageCards([{ mediaId: MEDIA, label: "hero", preview: PREVIEW }], {
  limit: 24,
  truncated: true,
});
assert.equal(declaredTruncated.truncated, true);
assert.equal(declaredTruncated.cards[0].selectable, false, "a self-declared incomplete read is never bindable");
assert.equal(resolveFlowCardSelection(declaredTruncated.cards, MEDIA).kind, "not_selectable");

// --- a preview is a picture, not just a well-formed data URL ---------------
assert.equal(sanitizeFlowCardPreview(PNG_PREVIEW)?.mime, "image/png");
assert.equal(sanitizeFlowCardPreview(JPEG_PREVIEW)?.mime, "image/jpeg");
assert.equal(sanitizeFlowCardPreview(WEBP_PREVIEW)?.mime, "image/webp");
assert.equal(sanitizeFlowCardPreview("data:image/jpeg;base64,QUJD"), null, "base64 syntax alone is not a picture");
assert.equal(sanitizeFlowCardPreview("data:image/png;base64,/9j/4AAQSkZJRgAB"), null, "a JPEG header declared as PNG is rejected");
assert.equal(sanitizeFlowCardPreview("data:image/jpeg;base64,QUJ"), null, "a payload that is not decodable base64 is rejected");
assert.equal(sanitizeFlowCardPreview("https://cdn/media-alpha.jpg"), null, "a remote URL is never a preview");
assert.equal(sanitizeFlowCardPreview(`data:image/jpeg;base64,${"A".repeat(262_145)}`), null, "an oversized payload is dropped");

// --- an exact media ID must be visible and unique before Animate -----------
assert.equal(verifyExactMediaPresence({ matchCount: 1, visibleCount: 1 }, MEDIA).ok, true);
assert.equal(verifyExactMediaPresence({ matchCount: 0, visibleCount: 0 }, MEDIA).reason, "media_absent");
assert.equal(verifyExactMediaPresence({ matchCount: 2, visibleCount: 2 }, MEDIA).reason, "media_duplicate");
assert.equal(verifyExactMediaPresence({ matchCount: 1, visibleCount: 0 }, MEDIA).reason, "media_not_visible");

// --- the ingredient chip must be exactly the confirmed media --------------
const chip = (mediaId, source = "") => ({ mediaId, source });
assert.equal(verifyExplicitIngredientChip({ editorFound: true, chips: [chip(MEDIA)] }, MEDIA).ready, true);
assert.equal(
  verifyExplicitIngredientChip({ editorFound: true, chips: [chip("", `https://cdn/${MEDIA}.jpg`)] }, MEDIA).reason,
  "mismatched_ingredient_chip",
  "a source URL alone is not exact media identity",
);
assert.equal(
  verifyExplicitIngredientChip({ editorFound: true, chips: [chip("", `https://cdn/${MEDIA}-copy.jpg`)] }, MEDIA).reason,
  "mismatched_ingredient_chip",
  "a URL prefix collision does not prove exact media identity",
);
assert.equal(verifyExplicitIngredientChip({ editorFound: true, chips: [] }, MEDIA).reason, "no_ingredient_chip");
assert.equal(verifyExplicitIngredientChip({ editorFound: true, chips: [chip("media-other")] }, MEDIA).reason, "mismatched_ingredient_chip");
assert.equal(
  verifyExplicitIngredientChip({ editorFound: true, chips: [chip(MEDIA), chip("media-other")] }, MEDIA).reason,
  "multiple_ingredient_chips",
  "a second visible chip is a swapped ingredient even when the first one matches",
);
assert.equal(verifyExplicitIngredientChip({ editorFound: false, chips: [chip(MEDIA)] }, MEDIA).reason, "prompt_editor_not_found");
// The unbound legacy route keeps its historical first-chip behaviour.
assert.equal(verifyFlowIngredientChip({ editorFound: true, ingredientCount: 1, sourceMediaId: MEDIA, chipSource: "" }, MEDIA, { explicit: false }).ready, true);
assert.equal(verifyFlowIngredientChip({ editorFound: true, ingredientCount: 1, sourceMediaId: "other" }, MEDIA, { explicit: false }).reason, "mismatched_ingredient_chip");
assert.equal(
  verifyFlowIngredientChip({ editorFound: "false", ingredientCount: "1", sourceMediaId: MEDIA }, MEDIA, { explicit: true }).ready,
  false,
  "coercible malformed DOM fields cannot prove an explicit chip",
);
assert.equal(
  verifyFlowIngredientChip({ editorFound: true, chips: [{ mediaId: 7, source: "" }] }, MEDIA, { explicit: true }).reason,
  "invalid_ingredient_state",
  "malformed chip fields are distinguished from an absent chip",
);
assert.match(flowExactMediaMessage("invalid_ingredient_state"), /trạng thái ingredient/i);

// --- BrowserOS worker: an explicit binding never falls back to a label -----
function browserOsFlowWith(responses) {
  const flow = new BrowserOsFlow("http://127.0.0.1:9000/mcp", "unused-session.json", process.cwd());
  flow.state = { pageId: 7, pageUrl: "https://flow.google.com/project/proj-9" };
  const calls = { evaluate: [], tool: [], generateClicks: 0 };
  flow.evaluate = async (_page, code) => {
    calls.evaluate.push(code);
    for (const [marker, reply] of responses) {
      if (code.includes(marker)) return typeof reply === "function" ? reply() : reply;
    }
    return {};
  };
  flow.snapshot = async () => ({ refs: [{ role: "menuitem", label: "Animate" }] });
  flow.click = async (_page, ref) => { calls.tool.push(`click:${ref}`); };
  flow.tool = async (name) => { calls.tool.push(name); return { content: [] }; };
  flow.clickGenerate = async () => { calls.generateClicks += 1; return { status: "ready", generateClicked: true }; };
  return { flow, calls };
}

const NO_GENERATE = "no Generate click may be issued by Animate";
const emptyComposer = { editorFound: true, ingredientCount: 0, chips: [] };
const visibleCard = { found: true, matchCount: 1, visibleCount: 1, needsClick: false, rect: { x: 1, y: 2, width: 10, height: 10 } };

// The confirmed media is gone from the page: the run must stop, and it must
// not go looking for a historical card by shot/revision label.
{
  const { flow, calls } = browserOsFlowWith([
    ["flow-image-ingredient-chip", emptyComposer],
    ["matchCount", { found: false, matchCount: 0, visibleCount: 0, reason: "not found" }],
  ]);
  await assert.rejects(
    flow.animate(7, "SHOT-002", "rev-001", MEDIA),
    /media ID đã xác nhận/,
  );
  assert.equal(calls.generateClicks, 0, NO_GENERATE);
  assert.equal(
    calls.evaluate.some((code) => code.includes("candidateCount")),
    false,
    "an explicit media ID that is absent must never fall back to the shot/revision label route",
  );
}

// A stale ingredient from another card is refused before anything is clicked.
{
  const { flow, calls } = browserOsFlowWith([
    ["flow-image-ingredient-chip", { editorFound: true, ingredientCount: 1, chips: [chip("media-other", "https://cdn/media-other.jpg")] }],
    ["matchCount", visibleCard],
  ]);
  await assert.rejects(flow.animate(7, "SHOT-002", "rev-001", MEDIA), /ingredient ảnh khác/);
  assert.equal(calls.generateClicks, 0, NO_GENERATE);
  assert.equal(calls.tool.length, 0, "a mismatched ingredient stops before any Flow control is clicked");
}

// Two cards wearing the confirmed media ID are ambiguous, not a free choice.
{
  const { flow, calls } = browserOsFlowWith([
    ["flow-image-ingredient-chip", emptyComposer],
    ["matchCount", { ...visibleCard, matchCount: 2, visibleCount: 2 }],
  ]);
  await assert.rejects(flow.animate(7, "SHOT-002", "rev-001", MEDIA), /nhiều card cùng media ID/);
  assert.equal(calls.generateClicks, 0, NO_GENERATE);
}

// Success: the exact card is animated and the exact media ID is verified back.
{
  let chipReads = 0;
  const { flow, calls } = browserOsFlowWith([
    ["flow-image-ingredient-chip", () => {
      chipReads += 1;
      return chipReads === 1 ? emptyComposer : { editorFound: true, ingredientCount: 1, chips: [chip(MEDIA, `https://cdn/${MEDIA}.jpg`)] };
    }],
    ["matchCount", visibleCard],
  ]);
  const result = await flow.animate(7, "SHOT-002", "rev-001", MEDIA);
  assert.equal(result.status, "ready");
  assert.equal(result.referenceAttached, true);
  assert.equal(result.sourceMediaId, MEDIA, "the report carries the exact media ID that was confirmed");
  assert.equal(result.explicitMedia, true);
  assert.equal(calls.generateClicks, 0, NO_GENERATE);
}

// An unbound legacy shot still resolves its historical card by label.
{
  let chipReads = 0;
  const { flow, calls } = browserOsFlowWith([
    ["flow-image-ingredient-chip", () => {
      chipReads += 1;
      return chipReads === 1 ? emptyComposer : { editorFound: true, ingredientCount: 1, chips: [chip("media-legacy", "https://cdn/media-legacy.jpg")] };
    }],
    ["matchCount", visibleCard],
    ["candidateCount", () => ({ found: true, mediaId: "media-legacy" })],
  ]);
  const result = await flow.animate(7, "SHOT-002", "rev-001", null);
  assert.equal(result.status, "ready");
  assert.equal(result.sourceMediaId, "media-legacy");
  assert.equal(result.explicitMedia, false);
  assert.ok(
    calls.evaluate.some((code) => code.includes("candidateCount")),
    "a shot without an explicit binding keeps the shot/revision label route",
  );
  assert.equal(calls.generateClicks, 0, NO_GENERATE);
}

// --- the paid prompt and Generate re-verify the confirmed chip -----------
// Animate proves the chip once, but the run can then wait for batch approval
// and take snapshots. The chip that survives to the paid prompt and to the
// paid Generate must still be the exact media the human confirmed, read fresh
// at that moment, or the shot stops with nothing typed and nothing clicked.
const VIDEO_PROMPT = "AUTO3DVIDEO SHOT SUBMISSION\nSHOT_ID: SHOT-002 | REVISION_ID: rev-001-part-01 | RUN_ID: flow-test";
const VIDEO_COST = 20;
const VIDEO_PROJECT = "https://flow.google.com/project/proj-9/tools";
const VIDEO_COMPOSER = {
  videoModeFound: true,
  promptEditorFound: true,
  selectedModel: "Omni 1.1 Flash",
  selectedSettingsEvidence: ["16:9", "720p", "8s"],
  visibleCreditTexts: [`${VIDEO_COST} credits`],
  promptText: VIDEO_PROMPT,
};
const exactChip = { editorFound: true, ingredientCount: 1, chips: [chip(MEDIA, `https://cdn/${MEDIA}.jpg`)] };
const clicked = { clicked: true, label: "Bắt đầu tạo", actualCost: VIDEO_COST, model: "Omni 1.1 Flash", settings: ["16:9", "720p", "8s"] };

function browserOsVideoFlowWith(chipState) {
  const flow = new BrowserOsFlow("http://127.0.0.1:9000/mcp", "unused-session.json", process.cwd());
  flow.state = { pageId: 7, pageUrl: "https://flow.google.com/project/proj-9" };
  const calls = { chipReads: 0, generateScripts: 0, typingScripts: 0 };
  flow.evaluate = async (_page, code) => {
    if (code.includes("flow-image-ingredient-chip")) {
      calls.chipReads += 1;
      return typeof chipState === "function" ? chipState() : chipState;
    }
    if (code.includes("video-editor-not-unique")) {
      calls.generateScripts += 1;
      return clicked;
    }
    if (code.includes("accepted: false")) {
      calls.typingScripts += 1;
      return { found: true, accepted: true, charCount: VIDEO_PROMPT.length };
    }
    return VIDEO_COMPOSER;
  };
  return { flow, calls };
}

for (const [label, state] of [
  ["the chip is gone", { editorFound: true, ingredientCount: 0, chips: [] }],
  ["the chip names another card", { editorFound: true, ingredientCount: 1, chips: [chip("media-other", "https://cdn/media-other.jpg")] }],
  ["a second chip sits beside the right one", { editorFound: true, ingredientCount: 2, chips: [chip(MEDIA, `https://cdn/${MEDIA}.jpg`), chip("media-other", "https://cdn/media-other.jpg")] }],
  ["the composer has no prompt editor", { editorFound: false, ingredientCount: 1, chips: [chip(MEDIA, `https://cdn/${MEDIA}.jpg`)] }],
]) {
  const prompt = browserOsVideoFlowWith(state);
  await assert.rejects(
    prompt.flow.typeVideoPrompt(7, VIDEO_PROMPT, VIDEO_PROJECT, VIDEO_COST, "Omni 1.1 Flash", MEDIA),
    /BLOCKED_VIDEO_REFERENCE/,
    `the paid prompt must be refused: ${label}`,
  );
  assert.equal(prompt.calls.typingScripts, 0, `nothing is typed when the chip is wrong: ${label}`);
  const generate = browserOsVideoFlowWith(state);
  await assert.rejects(
    generate.flow.clickVideoGenerate(7, VIDEO_PROMPT, VIDEO_PROJECT, VIDEO_COST, "Omni 1.1 Flash", MEDIA),
    /BLOCKED_VIDEO_REFERENCE/,
    `the paid Generate must be refused: ${label}`,
  );
  assert.equal(generate.calls.generateScripts, 0, `no Generate is clicked when the chip is wrong: ${label}`);
}

// The exact chip the human confirmed passes both gates, and both re-read it.
{
  const { flow, calls } = browserOsVideoFlowWith(exactChip);
  const typed = await flow.typeVideoPrompt(7, VIDEO_PROMPT, VIDEO_PROJECT, VIDEO_COST, "Omni 1.1 Flash", MEDIA);
  assert.equal(typed.status, "ready");
  assert.equal(typed.referenceVerified, true, "the report carries the fresh chip verification");
  assert.equal(typed.referenceSourceMediaId, MEDIA);
  const generated = await flow.clickVideoGenerate(7, VIDEO_PROMPT, VIDEO_PROJECT, VIDEO_COST, "Omni 1.1 Flash", MEDIA);
  assert.equal(generated.generateClicked, true);
  assert.equal(generated.referenceVerified, true, "Generate reports the same fresh verification");
  assert.equal(generated.referenceSourceMediaId, MEDIA);
  assert.equal(calls.chipReads, 2, "prompt entry and Generate each re-read the ingredient chips");
}

// A legacy text-only shot has no binding, so it keeps its historical shape:
// no chip is demanded and the report claims no verified reference.
{
  const { flow, calls } = browserOsVideoFlowWith({ editorFound: true, ingredientCount: 0, chips: [] });
  const typed = await flow.typeVideoPrompt(7, VIDEO_PROMPT, VIDEO_PROJECT, VIDEO_COST, "Omni 1.1 Flash", null);
  assert.equal(typed.status, "ready");
  assert.equal(typed.referenceVerified, null, "an unbound shot claims no verified reference");
  const generated = await flow.clickVideoGenerate(7, VIDEO_PROMPT, VIDEO_PROJECT, VIDEO_COST, "Omni 1.1 Flash", null);
  assert.equal(generated.generateClicked, true, "an unbound legacy shot still generates");
  assert.equal(calls.chipReads, 0, "an unbound shot never reads the ingredient chips");
}

// --- Playwright worker: the same rule, mirrored ---------------------------
function fakePage(tiles, chips, editorVisible = true) {
  const generateRequests = [];
  const animateRequests = [];
  const locatorFor = (selector, parent) => {
    const make = (item) => ({
      ...item,
      first: () => make(item),
      nth: (index) => make(item.list ? item.list[index] ?? { visible: false, attributes: {} } : item),
      count: async () => (item.list ? item.list.length : 1),
      isVisible: async () => Boolean(item.visible),
      getAttribute: async (name) => item.attributes?.[name] ?? null,
      scrollIntoViewIfNeeded: async () => {},
      hover: async () => {},
      click: async () => {},
      locator: (nested) => locatorFor(nested, item),
      getByRole: (_role, options) => {
        if (/animate/i.test(String(options?.name ?? ""))) return { isVisible: async () => Boolean(item.animateMenu), click: async () => { animateRequests.push(String(options?.name)); } };
        if (/more options/i.test(String(options?.name ?? ""))) return { isVisible: async () => Boolean(item.moreMenu), click: async () => {} };
        if (/generate/i.test(String(options?.name ?? ""))) { generateRequests.push(String(options?.name)); return { isVisible: async () => false, click: async () => {} }; }
        return { isVisible: async () => false, click: async () => {} };
      },
    });
    if (selector === "flow-grid-tile-container") {
      return make({ list: tiles, visible: true });
    }
    if (selector === "flow-image-ingredient-chip") {
      return make({ list: chips, visible: true });
    }
    if (selector.includes("ProseMirror")) {
      return make({ list: [{ visible: editorVisible }] });
    }
    if (selector === "img") {
      const mediaId = parent?.mediaId ?? "";
      return make({ visible: true, attributes: mediaId ? { "data-media-id": mediaId, src: `https://cdn/${mediaId}.jpg` } : {} });
    }
    return make({ visible: false });
  };
  return {
    locator: (selector) => locatorFor(selector, null),
    generateRequests,
    animateRequests,
    getByRole: (_role, options) => {
      if (/animate/i.test(String(options?.name ?? ""))) {
        const anyTileOpensAnimate = tiles.some((tile) => tile.animateMenu);
        return { isVisible: async () => anyTileOpensAnimate, click: async () => { animateRequests.push(String(options?.name)); } };
      }
      if (/generate/i.test(String(options?.name ?? ""))) {
        generateRequests.push(String(options?.name));
        return { isVisible: async () => false, click: async () => {} };
      }
      return { isVisible: async () => false, click: async () => {} };
    },
    waitForTimeout: async () => {},
  };
}

{
  const page = fakePage([{ mediaId: MEDIA, visible: true, moreMenu: true, animateMenu: true }], [{ mediaId: "media-other", visible: true }]);
  await assert.rejects(attachConfirmedMediaForAnimation(page, MEDIA), /ingredient ảnh khác/);
  assert.deepEqual(page.generateRequests, [], NO_GENERATE);
}
{
  const page = fakePage([{ mediaId: MEDIA, visible: true, moreMenu: true, animateMenu: true }], [{ mediaId: MEDIA, visible: true }]);
  const attached = await attachConfirmedMediaForAnimation(page, MEDIA);
  assert.equal(attached.referenceAttached, true);
  assert.equal(attached.sourceMediaId, MEDIA, "the Playwright route reports the exact confirmed media ID");
  assert.deepEqual(page.generateRequests, [], NO_GENERATE);
}

// A composer holding more ingredient chips than the bounded scan may read must
// be refused outright. Reading only the first entries would report "one exact
// chip" for a composer that is also holding a different ingredient.
{
  const overLong = Array.from({ length: 17 }, (_unused, index) => ({
    mediaId: index === 0 ? MEDIA : `media-filler-${index}`,
    visible: true,
  }));
  const page = fakePage([{ mediaId: MEDIA, visible: true, moreMenu: true, animateMenu: true }], overLong);
  await assert.rejects(attachConfirmedMediaForAnimation(page, MEDIA), /quá nhiều ingredient ảnh/);
  assert.deepEqual(page.generateRequests, [], NO_GENERATE);
  assert.deepEqual(page.animateRequests, [], "a truncated scan never reaches Animate, let alone Generate");
}

// A grid with more tiles than the scan may read is refused before anything is
// attached: "exactly one tile wears this media ID" is not a fact the route can
// establish when a second copy may sit just past the cut.
{
  const crowded = [
    ...Array.from({ length: 128 }, (_unused, index) => ({ mediaId: `media-filler-${index}`, visible: true })),
    { mediaId: MEDIA, visible: true, moreMenu: true, animateMenu: true },
  ];
  const page = fakePage(crowded, [{ mediaId: MEDIA, visible: true }]);
  await assert.rejects(attachConfirmedMediaForAnimation(page, MEDIA), /quá nhiều card ảnh/);
  assert.deepEqual(page.generateRequests, [], NO_GENERATE);
  assert.deepEqual(page.animateRequests, [], "an unread grid never reaches Animate, let alone Generate");
}
{
  // The bound itself is still readable: a full grid is a complete grid.
  const full = Array.from({ length: 128 }, (_unused, index) => ({ mediaId: `media-filler-${index}`, visible: true }));
  const page = fakePage(full, [{ mediaId: MEDIA, visible: true }]);
  await assert.rejects(attachConfirmedMediaForAnimation(page, MEDIA), /media ID đã xác nhận/);
}

// --- the saved binding is only produced from a real comparison -------------
const binding = {
  segmentId: "segment-002",
  referenceSetId: "set-1",
  assignmentId: "assignment-1",
  assetId: "asset-1",
  assetSha256: "a".repeat(64),
  role: "start_frame",
};
// The preflight answers about one exact identity and about the bytes that are
// on disk right now, so it carries the whole local claim back.
const preflight = {
  ready: true,
  projectId: "project-test",
  segmentId: "segment-002",
  referenceSetId: "set-1",
  assignmentId: "assignment-1",
  assetId: "asset-1",
  assetSha256: binding.assetSha256,
  role: "start_frame",
  relativePath: "assets/references/a.png",
  currentSha256: binding.assetSha256,
  assetStatus: "ready",
  rightsStatus: "licensed",
  assignmentApproved: true,
  referenceSetStatus: "active",
  reasons: [],
  message: "ok",
};
const cards = [{ mediaId: MEDIA, label: "hero", preview: PREVIEW, previewAvailable: true, previewNote: "", selectable: true }];
const ready = {
  projectId: "project-test",
  binding,
  preflight,
  selectedFlowProjectId: "proj-9",
  discoveredFlowProjectId: "proj-9",
  cards,
  selectedMediaId: MEDIA,
  discoveredFor: flowBindingIdentity(binding, "project-test"),
};

assert.equal(resolveFlowBindingBlocker(ready), null, "a fully checked, same-project, previewed card is bindable");
const confirmed = buildConfirmedFlowBinding({ ...ready, confirmed: true, confirmedAt: "2026-09-28T10:00:00.000Z" });
assert.equal(confirmed.flowProjectId, "proj-9");
assert.equal(confirmed.flowMediaId, MEDIA);
assert.equal(confirmed.confirmationKind, "manual_visual");
assert.equal(confirmed.confirmedAt, "2026-09-28T10:00:00.000Z");
assert.equal(confirmed.assignmentId, "assignment-1", "the local identity is carried through unchanged");

assert.equal(buildConfirmedFlowBinding({ ...ready, confirmed: false, confirmedAt: "2026-09-28T10:00:00.000Z" }), null, "nothing is saved without the human comparison");
assert.equal(buildConfirmedFlowBinding({ ...ready, confirmed: true, confirmedAt: "not-a-time" }), null);
assert.equal(resolveFlowBindingBlocker({ ...ready, binding: null }), "no_local_binding");
assert.equal(resolveFlowBindingBlocker({ ...ready, preflight: { ...preflight, ready: false } }), "preflight_failed");
assert.equal(resolveFlowBindingBlocker({ ...ready, selectedFlowProjectId: "" }), "no_flow_project");
assert.equal(resolveFlowBindingBlocker({ ...ready, discoveredFlowProjectId: "other-project" }), "project_mismatch");
assert.equal(resolveFlowBindingBlocker({ ...ready, cards: [] }), "cards_not_read");
assert.equal(resolveFlowBindingBlocker({ ...ready, selectedMediaId: "media-missing" }), "card_missing");
assert.equal(resolveFlowBindingBlocker({ ...ready, cards: [...cards, ...cards] }), "card_ambiguous");
assert.equal(
  resolveFlowBindingBlocker({ ...ready, cards: [{ ...cards[0], previewAvailable: false, preview: null }] }),
  "card_preview_unavailable",
  "an unreadable thumbnail blocks the manual comparison",
);

// The card list the UI actually receives from a truncated read: nothing in it
// can be selected, so nothing in it can be confirmed either.
const truncatedCards = normalizeFlowImageCards(
  [{ mediaId: MEDIA, label: "hero", preview: PREVIEW }, { mediaId: "media-gamma", label: "later", preview: PREVIEW }],
  { limit: 1 },
).cards;
assert.equal(
  resolveFlowBindingBlocker({ ...ready, cards: truncatedCards, selectedMediaId: MEDIA }),
  "card_not_selectable",
  "a card read out of an incomplete list closes the manual gate",
);
assert.equal(
  buildConfirmedFlowBinding({ ...ready, cards: truncatedCards, confirmed: true, confirmedAt: "2026-09-28T10:00:00.000Z" }),
  null,
  "no Flow media ID is saved from a card list that was cut short",
);

// A preflight that described some other local reference never authorises this
// one, whatever it answered about.
const identityDrift = [
  { field: "projectId", value: "project-other" },
  { field: "segmentId", value: "segment-003" },
  { field: "referenceSetId", value: "set-2" },
  { field: "assignmentId", value: "assignment-2" },
  { field: "assetId", value: "asset-2" },
  { field: "assetSha256", value: "b".repeat(64) },
  { field: "role", value: "identity" },
];
for (const { field, value } of identityDrift) {
  assert.equal(
    resolveFlowBindingBlocker({ ...ready, preflight: { ...preflight, [field]: value } }),
    "preflight_identity_mismatch",
    `a preflight whose ${field} names another reference is not this shot's check`,
  );
}
assert.equal(
  buildConfirmedFlowBinding({ ...ready, preflight: { ...preflight, role: "identity" }, confirmed: true, confirmedAt: "2026-09-28T10:00:00.000Z" }),
  null,
  "no Flow media ID is saved on a preflight that named another role",
);

// The cards were read for one identity; confirming against another is refused.
for (const { field, value } of identityDrift) {
  assert.equal(
    resolveFlowBindingBlocker({ ...ready, discoveredFor: { ...ready.discoveredFor, [field]: value } }),
    "reference_changed",
    `cards read for another ${field} cannot be confirmed against this reference`,
  );
}
assert.equal(resolveFlowBindingBlocker({ ...ready, discoveredFor: null }), "reference_changed");

// A thumbnail the webview could not decode is no longer comparable, so the
// manual gate closes again instead of confirming an unseen image.
const afterDecodeError = flowCardsAfterPreviewFailure(cards, MEDIA);
assert.equal(afterDecodeError[0].previewAvailable, false);
assert.equal(afterDecodeError[0].preview, null);
assert.equal(afterDecodeError[0].selectable, false);
assert.equal(
  resolveFlowBindingBlocker({ ...ready, cards: afterDecodeError }),
  "card_not_selectable",
  "a card whose image failed to decode can no longer be confirmed",
);
assert.equal(
  resolveFlowBindingBlocker({ ...ready, cards: afterDecodeError, selectedMediaId: "" }),
  "card_missing",
  "clearing the selection of a failed preview blocks the confirmation",
);
assert.deepEqual(
  flowCardsAfterPreviewFailure(cards, "media-other"),
  cards,
  "a decode failure only revokes the card that actually failed",
);


// --- a raw scan that stopped early closes the manual gate -----------------
// The worker reads one card past the bound, so the raw page can hold a tile
// nobody looked at. That fact has to reach normalization: a malformed ID in
// the sample is dropped, so counting the *kept* cards would let a grid that
// still had unread tiles look complete and leave a sampled card confirmable.
{
  const rawOverflow = normalizeFlowImageCards(
    [
      { mediaId: MEDIA, label: "hero", preview: PREVIEW },
      { mediaId: "not a media id", label: "malformed", preview: PREVIEW },
    ],
    { limit: 1, truncated: true },
  );
  assert.equal(rawOverflow.cards.length, 1);
  assert.equal(rawOverflow.truncated, true, "a declared raw overflow survives normalization");
  assert.equal(
    rawOverflow.cards[0].selectable,
    false,
    "a card sampled from a grid whose tail was never read is not bindable",
  );
  assert.equal(resolveFlowCardSelection(rawOverflow.cards, MEDIA).kind, "not_selectable");
}

// The same fact arriving through the real worker path: the page reports more
// visible media than the scan returned, so the report is cut short even though
// the kept cards happen to fit the bound.
{
  const { flow } = browserOsFlowWith([
    [
      "visibleMediaCount",
      { found: true, visibleMediaCount: 5, cards: [{ mediaId: MEDIA, label: "hero", preview: PREVIEW }] },
    ],
  ]);
  const listed = await flow.listImageCards(7, 24);
  assert.equal(listed.truncated, true, "an unread page tail is reported as truncated: " + JSON.stringify(listed));
  assert.equal(listed.cards[0].selectable, false, "a card from an incompletely read grid is never selectable");
}

// --- the exact-media argument accepts the whole shared ID contract ---------
// Cards, the session schema and Rust all allow a 256-char media ID, so the
// route that attaches one must not be stricter than the gate that discovered
// and saved it. The `__newest__` sentinel is the one non-card value the
// download route still sends.
{
  const longId = `media-${"a".repeat(250)}`;
  assert.equal(isSafeFlowMediaId(longId), true, "the shared card contract allows a 256-char media ID");
  assert.equal(isSafeFlowMediaIdArgument(longId), true, "the request guard accepts what the card contract accepts");
  assert.equal(isSafeFlowMediaIdArgument("__newest__"), true, "the newest-media sentinel is still a valid request value");
  assert.equal(isSafeFlowMediaIdArgument("has space"), false);
  assert.equal(isSafeFlowMediaIdArgument(""), false);
  assert.equal(FLOW_NEWEST_MEDIA_ID, "__newest__");
}

// --- the Playwright route enforces that contract on both media modes -------
{
  const page = fakePage([{ mediaId: MEDIA, visible: true, moreMenu: true, animateMenu: true }], [{ mediaId: MEDIA, visible: true }]);
  const longId = `media-${"a".repeat(250)}`;
  await assert.rejects(
    runAction(page, null, { mode: "animate_image", runId: "auto-testrun1", mediaId: longId }, "."),
    /media ID đã xác nhận/,
    "a 256-char ID reaches the attach step instead of being rejected by a shorter local cap",
  );
  await assert.rejects(
    runAction(page, null, { mode: "download_image", runId: "auto-testrun1", shotId: "SHOT-002", revisionId: "rev-001", mediaId: "bad id" }, "."),
    /mediaId/,
    "a malformed media ID is still refused before any Flow control is touched",
  );
  assert.deepEqual(page.generateRequests, [], NO_GENERATE);
}

console.log("Flow exact-media binding checks passed.");
