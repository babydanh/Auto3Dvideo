import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { readFile, writeFile, mkdir, readdir, stat, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  flowExactMediaMessage,
  isSafeFlowMediaIdArgument,
  verifyFlowIngredientChip,
} from "./flow_exact_media.mjs";

const MAX_PROMPT_CHARS = 12000;
const ACTION_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 20000;
const IMAGE_SUFFIXES = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const UNKNOWN_DOWNLOAD_SUFFIX = ".flow-download";
const SECRET_MARKERS = [
  "api_key=",
  "apikey=",
  "access_token=",
  "authorization=",
  "bearer ",
  "client_secret=",
  "password=",
  "secret=",
  "token=",
];

const require = createRequire(import.meta.url);

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name) {
  const value = arg(name);
  if (!value) throw new Error(`Thiếu ${name}`);
  return value;
}

function safeText(value, field, limit) {
  if (typeof value !== "string" || !value.trim() || value.length > limit || value.includes("\0")) {
    throw new Error(`${field} không hợp lệ`);
  }
  const lowered = value.toLowerCase();
  if (SECRET_MARKERS.some((marker) => lowered.includes(marker))) {
    throw new Error(`${field} có dấu hiệu credential`);
  }
  return value.trim();
}

function safePrompt(value) {
  return safeText(value, "Prompt Flow", MAX_PROMPT_CHARS).replace(/\r\n?/g, "\n");
}

function safeId(value, field, pattern) {
  const text = safeText(value, field, 96);
  if (!pattern.test(text)) throw new Error(`${field} không đúng định dạng`);
  return text;
}

// A request that names the media to act on is checked against the same card
// contract the discovery route, the session schema and the Rust parser use, so
// a card that could be discovered and saved is never refused here for length.
// The one non-card value is the newest-media sentinel the download route sends.
function safeMediaIdArgument(value) {
  const text = safeText(value, "mediaId", 256);
  if (!isSafeFlowMediaIdArgument(text)) throw new Error("mediaId không đúng định dạng");
  return text;
}

function safeProjectUrl(value) {
  const parsed = new URL(safeText(value, "Project URL", 500));
  if (parsed.protocol !== "https:" || parsed.hostname !== "flow.google.com" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
    throw new Error("Flow project URL không hợp lệ");
  }
  const match = parsed.pathname.match(/^\/project\/([A-Za-z0-9-]+)(?:\/.*)?$/);
  if (!match) throw new Error("Flow project URL phải có dạng /project/<id>");
  return `https://flow.google.com/project/${match[1]}`;
}

function safeCdpUrl(value) {
  const url = safeText(value || "http://127.0.0.1:9222", "flowCdpUrl", 120).replace(/\/$/, "");
  if (!/^http:\/\/(127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/.test(url)) {
    throw new Error("flowCdpUrl chỉ được là loopback HTTP");
  }
  return url;
}

function safeModuleRoot(value) {
  const root = resolve(safeText(value, "playwrightModuleRoot", 1024));
  const packagePath = resolve(root, "node_modules", "playwright-core", "package.json");
  if (!packagePath.toLowerCase().startsWith(resolve(root).toLowerCase() + sep) && packagePath.toLowerCase() !== resolve(root).toLowerCase()) {
    throw new Error("playwrightModuleRoot vượt thư mục được chỉ định");
  }
  return root;
}

function safeWorkspacePath(workspace, value, field) {
  const root = resolve(safeText(workspace, "workspace", 2048));
  const candidate = resolve(root, safeText(value, field, 2048));
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (candidate !== root && !candidate.toLowerCase().startsWith(rootPrefix.toLowerCase())) {
    throw new Error(`${field} vượt project workspace`);
  }
  return candidate;
}

function safeDownloadsPath(value, profileValue) {
  const profile = resolve(safeText(profileValue, "downloadProfile", 2048));
  const expected = resolve(profile, "Downloads");
  const candidate = resolve(safeText(value, "downloadDir", 2048));
  if (candidate.toLowerCase() !== expected.toLowerCase()) {
    throw new Error("Playwright Flow worker chỉ được ghi vào Downloads của user hiện tại");
  }
  return candidate;
}

function boundedError(value) {
  const text = value instanceof Error ? value.message : String(value);
  return text
    .replace(/(?:api[_-]?key|access[_-]?token|authorization|password|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 900);
}

function loadPlaywright(moduleRoot) {
  const modulePath = require.resolve("playwright-core", { paths: [moduleRoot] });
  const loaded = require(modulePath);
  const chromium = loaded.chromium ?? loaded.default?.chromium;
  if (!chromium || typeof chromium.connectOverCDP !== "function") {
    throw new Error("Không nạp được playwright-core chromium");
  }
  return chromium;
}

function normalizeLabel(value, limit = 160) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function isExactDownloadLabel(value) {
  return /^(?:download|download media|download image|download video|tải xuống|tải ảnh|tải video)$/i.test(normalizeLabel(value));
}

function safeUiLabel(value) {
  const label = normalizeLabel(value);
  if (/account|profile|e-?mail|sign\s*out|đăng xuất|tài khoản/i.test(label)) {
    return "sensitive account control";
  }
  return label;
}

function hashText(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function writeReport(outputPath, report) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", { encoding: "utf8" });
}

async function connectToFlow(chromium, cdpUrl, projectUrl) {
  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: ACTION_TIMEOUT_MS, isLocal: true });
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => {
    const url = candidate.url();
    return url === projectUrl || url.startsWith(`${projectUrl}/`);
  });
  if (!page) {
    await browser.close();
    throw new Error("Không tìm thấy đúng tab Google Flow project trong Chrome CDP");
  }
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  return { browser, page };
}

async function collectControls(page) {
  const locator = page.locator("button, a, [role='button'], input, textarea, [contenteditable='true']");
  const count = Math.min(await locator.count(), 160);
  const controls = [];
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (!(await item.isVisible().catch(() => false))) continue;
    const detail = await item.evaluate((node) => {
      const tag = node.tagName.toLowerCase();
      const role = node.getAttribute("role") || (tag === "button" ? "button" : tag === "a" ? "link" : tag === "input" ? "textbox" : tag);
      const label = node.getAttribute("aria-label") || node.getAttribute("title") || node.getAttribute("placeholder") || (node.matches("[contenteditable='true']") ? "editable control" : node.innerText || node.textContent || "");
      const rect = node.getBoundingClientRect();
      return {
        role,
        label: /account|profile|e-?mail|sign\s*out|đăng xuất|tài khoản/i.test(String(label))
          ? "sensitive account control"
          : String(label).replace(/\s+/g, " ").trim().slice(0, 160),
        disabled: Boolean(node.disabled || node.getAttribute("aria-disabled") === "true"),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      };
    });
    if (detail.rect.width > 0 && detail.rect.height > 0) controls.push(detail);
  }
  return controls;
}

async function collectBatches(page) {
  const locator = page.locator("flow-batch-info");
  const count = Math.min(await locator.count(), 64);
  const batches = [];
  for (let index = 0; index < count; index += 1) {
    const batch = locator.nth(index);
    const text = await batch.innerText().catch(() => "");
    const shotIds = [...text.matchAll(/SHOT_ID:\s*([A-Za-z0-9_-]+)/gi)].map((match) => match[1]).slice(0, 4);
    const revisionIds = [...text.matchAll(/REVISION_ID:\s*([A-Za-z0-9_.-]+)/gi)].map((match) => match[1]).slice(0, 4);
    const runIds = [...text.matchAll(/RUN_ID:\s*([A-Za-z0-9_-]+)/gi)].map((match) => match[1]).slice(0, 4);
    const controls = batch.locator("button, [role='button']");
    let downloadControlCount = 0;
    for (let controlIndex = 0; controlIndex < Math.min(await controls.count(), 16); controlIndex += 1) {
      const control = controls.nth(controlIndex);
      if (!(await control.isVisible().catch(() => false))) continue;
      const label = safeUiLabel(await control.getAttribute("aria-label")) || safeUiLabel(await control.getAttribute("title")) || safeUiLabel(await control.innerText().catch(() => ""));
      if (/download|save|export|tải xuống|lưu|xuất/i.test(label)) downloadControlCount += 1;
    }
    batches.push({
      index,
      visible: await batch.isVisible().catch(() => false),
      hasShotId: shotIds.length > 0,
      hasRevisionId: revisionIds.length > 0,
      shotIds,
      revisionIds,
      runIds,
      downloadControlCount,
    });
  }
  return batches;
}

async function collectObservation(page, screenshotPath, cdpSession) {
  const controls = await collectControls(page);
  const batches = await collectBatches(page);
  const promptEditorFound = Boolean(await findPromptEditor(page));
  const generationButtons = page.getByRole("button", { name: /start generation|generate image|generate|tạo ảnh/i });
  let generateButtonCount = 0;
  for (let index = 0; index < Math.min(await generationButtons.count(), 32); index += 1) {
    const candidate = generationButtons.nth(index);
    if (await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false)) generateButtonCount += 1;
  }
  let axNodeCount = 0;
  let domNodeCount = 0;
  try {
    const axTree = await cdpSession.send("Accessibility.getFullAXTree", { depth: 8 });
    axNodeCount = Array.isArray(axTree?.nodes) ? axTree.nodes.length : 0;
  } catch {
    axNodeCount = 0;
  }
  try {
    const domSnapshot = await cdpSession.send("DOMSnapshot.captureSnapshot", { computedStyles: [], includeDOMRects: true });
    domNodeCount = Array.isArray(domSnapshot?.documents) ? domSnapshot.documents.reduce((sum, item) => sum + (item?.nodes?.nodeName?.length || 0), 0) : 0;
  } catch {
    domNodeCount = 0;
  }
  if (screenshotPath) {
    await mkdir(dirname(screenshotPath), { recursive: true });
    await page.screenshot({
      path: screenshotPath,
      fullPage: false,
      mask: [page.locator("[aria-label*='Google Account'], [aria-label='Account details'], [aria-label*='email' i], [aria-label*='profile' i]")],
    });
  }
  return {
    url: page.url().split("?")[0],
    title: "Google Flow project",
    controls,
    batches,
    controlCount: controls.length,
    batchCount: batches.length,
    promptEditorFound,
    generateButtonCount,
    imageComposerDetected: promptEditorFound && generateButtonCount > 0,
    axNodeCount,
    domNodeCount,
    screenshotCaptured: Boolean(screenshotPath),
  };
}

async function firstVisible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function findPromptEditor(page) {
  // Never fall back to an arbitrary contenteditable: Flow's Agent/chat pane
  // exposes a visually similar editor and would accept the revision as a
  // conversation message instead of the image composer prompt.
  return firstVisible(page.locator("flow-rich-text-editor.prompt-input div.ProseMirror[contenteditable='true']"));
}

async function controlName(locator) {
  return normalizeLabel(await locator.getAttribute("aria-label")) || normalizeLabel(await locator.getAttribute("title")) || normalizeLabel(await locator.innerText().catch(() => ""));
}

async function findUniqueButton(page, pattern, score) {
  const candidates = page.getByRole("button", { name: pattern });
  const found = [];
  for (let index = 0; index < Math.min(await candidates.count(), 64); index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    if (!(await candidate.isEnabled().catch(() => false))) continue;
    const label = (await controlName(candidate)).toLowerCase();
    const candidateScore = score(label);
    if (candidateScore > 0) found.push({ candidate, label, score: candidateScore });
  }
  found.sort((left, right) => right.score - left.score);
  if (!found.length) throw new Error("Không tìm thấy control phù hợp trong Flow");
  if (found.length > 1 && found[0].score === found[1].score) {
    throw new Error("Flow có nhiều control cùng mức phù hợp; không tự đoán nút cần bấm");
  }
  return found[0];
}

function generationScore(label) {
  if (/chat|assistant|video|agent|upgrade|credit|quota/.test(label)) return -100;
  if (/^start generation$|^generate image$|^tạo ảnh$/.test(label)) return 40;
  if (/start generation|generate image|tạo ảnh/.test(label)) return 30;
  if (/^generate$/.test(label)) return 20;
  return -1;
}

async function findBatchDownloadButton(batch) {
  const controls = batch.locator("button, [role='button']");
  const found = [];
  for (let index = 0; index < Math.min(await controls.count(), 32); index += 1) {
    const candidate = controls.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    if (!(await candidate.isEnabled().catch(() => false))) continue;
    const label = (await controlName(candidate)).toLowerCase();
    if (isExactDownloadLabel(label)) found.push({ candidate, label });
  }
  if (found.length !== 1) {
    throw new Error(found.length === 0 ? "Batch đúng shot/revision chưa có nút Download hiển thị" : "Batch có nhiều nút tải xuống; không tự đoán");
  }
  return found[0];
}

async function findVisibleDownloadControl(scope) {
  const controls = scope.locator("button, [role='button']");
  const found = [];
  for (let index = 0; index < Math.min(await controls.count(), 48); index += 1) {
    const candidate = controls.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    if (!(await candidate.isEnabled().catch(() => false))) continue;
    const label = (await controlName(candidate)).toLowerCase();
    if (isExactDownloadLabel(label)) found.push({ candidate, label });
  }
  if (found.length > 1) throw new Error("Flow đang hiển thị nhiều nút tải; không tự đoán");
  return found[0] ?? null;
}

async function findVisibleMenuDownloadControl(page) {
  const controls = page.locator("[role='menuitem'], flow-menu-item, [role='menu'] button, [role='menu'] [role='button']");
  const found = [];
  for (let index = 0; index < Math.min(await controls.count(), 48); index += 1) {
    const candidate = controls.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    if (!(await candidate.isEnabled().catch(() => false))) continue;
    const label = (await controlName(candidate)).toLowerCase();
    if (isExactDownloadLabel(label)) found.push({ candidate, label });
  }
  if (found.length > 1) throw new Error("Menu ảnh đang hiển thị nhiều nút tải; không tự đoán");
  return found[0] ?? null;
}

async function findExactVisibleMenuItem(page, pattern) {
  const candidates = page.locator("[role='menuitem'], flow-menu-item, [role='menu'] button, [role='menu'] [role='button']");
  const found = [];
  for (let index = 0; index < Math.min(await candidates.count(), 64); index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    if (!(await candidate.isEnabled().catch(() => false))) continue;
    const label = (await controlName(candidate)).trim();
    if (pattern.test(label)) found.push({ candidate, label });
  }
  if (found.length > 1) throw new Error("Flow đang hiển thị nhiều mục menu trùng nhau; không tự đoán");
  return found[0] ?? null;
}

async function findFreshImageDownloadButton(page, mediaId) {
  const pageText = normalizeLabel(await page.locator("body").innerText().catch(() => ""), 12_000).toLowerCase();
  if (/items? moved to trash|moved to trash|delete permanently|\btrashed\b/.test(pageText)) {
    throw new Error("FLOW_DESTRUCTIVE_OVERLAY_VISIBLE: Flow đang ở màn hình Trash/Delete; dừng mọi click để bảo vệ asset. Hãy bấm Undo/Back thủ công rồi chạy resume.");
  }
  if (mediaId === "__newest__" && /\/edit\/[^/?#]+/i.test(page.url())) {
    const direct = await findVisibleDownloadControl(page);
    if (direct) return { ...direct, sourceMediaId: null, route: "detail-toolbar-download-media" };
  }
  const tiles = page.locator("flow-grid-tile-container");
  const tileCount = Math.min(await tiles.count(), 128);
  let tile = null;
  for (let index = 0; index < tileCount; index += 1) {
    const candidate = tiles.nth(index);
    const image = candidate.locator("img").first();
    if (!(await image.isVisible().catch(() => false))) continue;
    if (mediaId === "__newest__" || (await image.getAttribute("data-media-id").catch(() => null)) === mediaId) {
      tile = candidate;
      if (mediaId !== "__newest__") break;
    }
  }
  if (!tile) throw new Error(mediaId === "__newest__" ? "Không tìm thấy tile media mới nhất; không tải card lịch sử" : "Không tìm thấy tile ảnh mới theo media ID; không tải card lịch sử");
  await tile.scrollIntoViewIfNeeded();
  await tile.hover();
  await page.waitForTimeout(250);
  // Never scan the batch ancestor here: its visible control is usually
  // "Download batch" (ZIP), which is not the individual image requested by
  // this media-id-bound action.
  const direct = await findVisibleDownloadControl(tile);
  if (direct && !/download\s*batch/i.test(direct.label) && isExactDownloadLabel(direct.label)) {
    return { ...direct, sourceMediaId: mediaId === "__newest__" ? await tile.locator("img").first().getAttribute("data-media-id").catch(() => null) : mediaId, route: mediaId === "__newest__" ? "newest-tile-hover" : "tile-hover" };
  }
  throw new Error("FLOW_DOWNLOAD_CONTROL_NOT_EXPOSED: tile đúng media chưa có nút Download trực tiếp; không mở More options, lightbox hoặc context menu để tránh click nhầm Trash/Delete");
}

async function findExactBatch(page, shotId, revisionId, runId) {
  const identityBoundary = "(?=$|\\s|[,;:!?)]|\\.(?:\\s|$))";
  const shotPattern = new RegExp(`SHOT_ID:\\s*${escapeRegExp(shotId)}${identityBoundary}`, "i");
  const revisionPattern = new RegExp(`REVISION_ID:\\s*${escapeRegExp(revisionId)}${identityBoundary}`, "i");
  const runPattern = new RegExp(`RUN_ID:\\s*${escapeRegExp(runId)}${identityBoundary}`, "i");
  const batches = page.locator("flow-batch-info").filter({ hasText: shotPattern }).filter({ hasText: revisionPattern }).filter({ hasText: runPattern });
  const batchCount = await batches.count();
  if (batchCount !== 1) {
    throw new Error(batchCount === 0
      ? "Không tìm thấy batch đúng SHOT_ID + REVISION_ID + RUN_ID hiện tại"
      : "Có nhiều batch cùng identity; không tự đoán");
  }
  return batches.first();
}

async function attachExactImageForAnimation(page, shotId, revisionId, runId) {
  const batch = await findExactBatch(page, shotId, revisionId, runId);
  const owner = batch.locator("xpath=..");
  const tile = owner.locator("flow-grid-tile-container").first();
  if (!(await tile.isVisible().catch(() => false))) {
    throw new Error("Batch đúng identity chưa có image tile hiển thị");
  }
  const sourceMediaId = await tile.locator("img").first().getAttribute("data-media-id");
  if (!sourceMediaId) throw new Error("Image tile đúng batch không có media ID");
  const existingIngredientCount = await page.locator("flow-image-ingredient-chip").count();
  if (existingIngredientCount > 0) {
    throw new Error("Composer đang có ingredient ảnh cũ; dừng để không ghép nhầm reference");
  }
  await tile.scrollIntoViewIfNeeded();
  await tile.hover();
  const more = tile.getByRole("button", { name: "More options", exact: true });
  if (!(await more.isVisible().catch(() => false))) throw new Error("Image tile đúng batch chưa hiện More options");
  await more.click();
  const animate = page.getByRole("menuitem", { name: "Animate", exact: true });
  if (!(await animate.isVisible().catch(() => false))) throw new Error("Flow chưa hiện menu Animate cho image tile");
  await animate.click();
  await page.waitForTimeout(700);
  const editor = await findPromptEditor(page);
  const chip = page.locator("flow-image-ingredient-chip").first();
  const chipImage = chip.locator("img").first();
  const chipSource = await chipImage.getAttribute("src").catch(() => null);
  const referenceAttached = Boolean(editor && chipSource && chipSource.includes(sourceMediaId));
  if (!referenceAttached) {
    throw new Error("Flow chưa xác nhận ingredient ảnh đúng media ID sau Animate");
  }
  return { editorFound: true, referenceAttached, sourceMediaId };
}

// Every visible ingredient chip is described by the media identity the
// composer itself exposes, so an explicit binding can require that the only
// chip present is the one it confirmed. The scan is bounded, and a composer
// with more chips than the bound allows is refused outright: reading only the
// first entries would report "one exact chip" for a composer that is actually
// holding a second, different ingredient nobody looked at.
const MAX_FLOW_INGREDIENT_CHIPS = 16;

async function readFlowIngredientChips(page) {
  const chips = page.locator("flow-image-ingredient-chip");
  const totalCount = await chips.count().catch(() => 0);
  if (totalCount > MAX_FLOW_INGREDIENT_CHIPS) {
    throw new Error(flowExactMediaMessage("ingredient_scan_truncated"));
  }
  const described = [];
  for (let index = 0; index < totalCount; index += 1) {
    const chip = chips.nth(index);
    if (!(await chip.isVisible().catch(() => false))) continue;
    const image = chip.locator("img").first();
    described.push({
      mediaId: await image.getAttribute("data-media-id").catch(() => null)
        || await chip.getAttribute("data-media-id").catch(() => null)
        || "",
      source: await image.getAttribute("src").catch(() => null) || "",
    });
  }
  return described;
}

// The exact-media route proves a media ID is unique by counting every tile
// wearing it, so a grid larger than the bound is a grid it cannot see all of.
// Reading the first 128 would call a single visible match "unique" on a page
// that may hold a second copy just past the cut, so the scan is refused.
const MAX_FLOW_MEDIA_TILES = 128;

async function countFlowMediaTiles(tiles) {
  const total = await tiles.count().catch(() => 0);
  if (total > MAX_FLOW_MEDIA_TILES) {
    throw new Error(flowExactMediaMessage("media_scan_truncated"));
  }
  return total;
}

// An explicitly bound shot is attached from its own media ID only. Shot and
// revision labels, history, and "the only visible tile" are all refused, so a
// confirmed binding can never silently become a different image.
async function attachConfirmedMediaForAnimation(page, mediaId) {
  const tiles = page.locator("flow-grid-tile-container");
  const tileCount = await countFlowMediaTiles(tiles);
  let tile = null;
  let matches = 0;
  for (let index = 0; index < tileCount; index += 1) {
    const candidate = tiles.nth(index);
    const mediaIdValue = await candidate.locator("img").first().getAttribute("data-media-id").catch(() => null);
    if (mediaIdValue !== mediaId) continue;
    matches += 1;
    if (!tile) tile = candidate;
  }
  if (matches === 0) throw new Error(flowExactMediaMessage("media_absent"));
  if (matches > 1) throw new Error(flowExactMediaMessage("media_duplicate"));
  if (!(await tile.isVisible().catch(() => false))) throw new Error(flowExactMediaMessage("media_not_visible"));

  const before = verifyFlowIngredientChip(
    { editorFound: Boolean(await findPromptEditor(page)), chips: await readFlowIngredientChips(page) },
    mediaId,
    { explicit: true },
  );
  if (before.ready) {
    return { editorFound: true, referenceAttached: true, sourceMediaId: before.sourceMediaId || mediaId, chipCount: 1 };
  }
  const existingChips = await readFlowIngredientChips(page);
  if (existingChips.length > 0) throw new Error(flowExactMediaMessage(before.reason));

  await tile.scrollIntoViewIfNeeded();
  await tile.hover();
  const more = tile.getByRole("button", { name: "More options", exact: true });
  if (!(await more.isVisible().catch(() => false))) throw new Error("Image tile đúng media ID chưa hiện More options");
  await more.click();
  const animate = page.getByRole("menuitem", { name: "Animate", exact: true });
  if (!(await animate.isVisible().catch(() => false))) throw new Error("Flow chưa hiện menu Animate cho image tile");
  await animate.click();
  await page.waitForTimeout(700);
  const editor = await findPromptEditor(page);
  const chips = await readFlowIngredientChips(page);
  const after = verifyFlowIngredientChip({ editorFound: Boolean(editor), chips }, mediaId, { explicit: true });
  if (!after.ready) throw new Error(flowExactMediaMessage(after.reason));
  return { editorFound: true, referenceAttached: true, sourceMediaId: after.sourceMediaId || mediaId, chipCount: chips.length };
}

async function imageFiles(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = new Map();
  for (const entry of entries) {
    const extension = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
    if (!entry.isFile() || !IMAGE_SUFFIXES.has(extension)) continue;
    const path = resolve(root, entry.name);
    const metadata = await stat(path).catch(() => null);
    if (!metadata || metadata.size === 0) continue;
    files.set(entry.name, { name: entry.name, size: metadata.size, modifiedMs: metadata.mtimeMs });
  }
  return files;
}

function sanitizedFilename(value) {
  const name = String(value || "flow-image").replace(/[^A-Za-z0-9._ -]/g, "_").replace(/\s+/g, " ").trim().slice(0, 140) || "flow-image";
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  return IMAGE_SUFFIXES.has(extension)
    ? name
    : `${name.replace(/[.]+$/, "")}${UNKNOWN_DOWNLOAD_SUFFIX}`;
}

function imageExtensionFromBytes(bytes) {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return ".png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ".jpg";
  if (bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return ".webp";
  return null;
}

async function normalizeDownloadedImage(path) {
  const metadata = await stat(path).catch(() => null);
  if (!metadata || metadata.size <= 0 || metadata.size > 64 * 1024 * 1024) {
    throw new Error("Flow download rỗng hoặc vượt giới hạn ảnh");
  }
  const bytes = await readFile(path);
  const extension = imageExtensionFromBytes(bytes);
  if (!extension) throw new Error("Flow download không phải dữ liệu PNG/JPEG/WebP");
  if (IMAGE_SUFFIXES.has(path.slice(path.lastIndexOf(".")).toLowerCase())) return path;

  const suffix = path.endsWith(UNKNOWN_DOWNLOAD_SUFFIX) ? UNKNOWN_DOWNLOAD_SUFFIX.length : 0;
  const stem = suffix ? path.slice(0, -suffix) : path;
  let candidate = `${stem}${extension}`;
  for (let index = 1; ; index += 1) {
    try {
      await stat(candidate);
      candidate = `${stem}-${index}${extension}`;
    } catch {
      break;
    }
  }
  await rename(path, candidate);
  return candidate;
}

async function uniqueDownloadPath(downloadDir, suggested, runId) {
  const base = sanitizedFilename(suggested);
  const extension = base.slice(base.lastIndexOf("."));
  const stem = base.slice(0, -extension.length).replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 92) || "flow-image";
  const prefix = `auto3d-flow-${runId.slice(-18)}-`;
  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? "" : `-${index}`;
    const candidate = resolve(downloadDir, `${prefix}${stem}${suffix}${extension}`);
    try {
      await stat(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error("Không tạo được tên file download duy nhất");
}

async function waitForFreshImage(downloadDir, before, expectedName) {
  const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const current = await imageFiles(downloadDir);
    const candidates = [...current.values()].filter((item) => {
      const previous = before.get(item.name);
      return item.name === expectedName || !previous || previous.size !== item.size || previous.modifiedMs !== item.modifiedMs;
    });
    if (candidates.length) return candidates.sort((left, right) => right.modifiedMs - left.modifiedMs)[0];
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  return null;
}

async function runAction(page, cdpSession, spec, downloadDir) {
  const mode = String(spec.mode || "observe");
  if (mode === "observe") {
    const observed = await collectObservation(page, spec.screenshotPath, cdpSession);
    return {
      status: "ready",
      operation: "playwright_observe_flow",
      observed,
      screenshotPath: spec.screenshotRelativePath || null,
      message: "Đã đọc Flow bằng screenshot, Accessibility tree và DOMSnapshot; chưa click control.",
    };
  }
  if (mode === "type_prompt") {
    const prompt = safePrompt(spec.prompt);
    const runId = safeId(spec.runId, "runId", /^[a-z0-9][a-z0-9-]{2,80}$/);
    const editor = await findPromptEditor(page);
    if (!editor) throw new Error("Không tìm thấy ô prompt image composer trong Flow");
    // A real image composer must expose its own generation control before we
    // type. This prevents the Agent/chat editor from receiving a prompt when
    // Flow has silently returned to the conversation route.
    await findUniqueButton(page, /start generation|generate image|generate|tạo ảnh/i, generationScore);
    await editor.fill(prompt);
    const acceptedText = await editor.innerText().catch(() => "");
    const accepted = acceptedText.includes("SHOT_ID:") && acceptedText.includes("REVISION_ID:") && acceptedText.includes(`RUN_ID: ${runId}`);
    return {
      status: accepted ? "ready" : "blocked",
      operation: "playwright_type_flow_prompt",
      editorFound: true,
      promptAccepted: accepted,
      promptSha256: hashText(prompt),
      message: accepted ? "Đã nhập prompt vào image composer bằng Playwright locator và khóa theo run hiện tại." : "Flow chưa xác nhận prompt có đủ SHOT_ID, REVISION_ID và RUN_ID hiện tại.",
    };
  }
  if (mode === "click_generate") {
    const selected = await findUniqueButton(page, /start generation|generate image|generate|tạo ảnh/i, generationScore);
    await selected.candidate.click();
    return {
      status: "ready",
      operation: "playwright_click_flow_generate",
      generateClicked: true,
      controlLabel: selected.label,
      message: "Đã click Generate bằng Playwright locator; đang chờ snapshot output mới.",
    };
  }
  if (mode === "animate_image") {
    const runId = safeId(spec.runId, "runId", /^[a-z0-9][a-z0-9-]{2,80}$/);
    const mediaId = spec.mediaId ? safeMediaIdArgument(spec.mediaId) : null;
    if (mediaId) {
      const attached = await attachConfirmedMediaForAnimation(page, mediaId);
      return {
        status: "ready",
        operation: "playwright_animate_confirmed_flow_media",
        mediaId,
        referenceAttached: attached.referenceAttached,
        sourceMediaId: attached.sourceMediaId,
        editorFound: attached.editorFound,
        chipCount: attached.chipCount,
        explicitMedia: true,
        message: "Đã mở Animate từ đúng card media đã xác nhận thủ công và xác nhận ingredient đúng media ID trong video composer; chưa bấm Generate.",
      };
    }
    const shotId = safeId(spec.shotId, "shotId", /^[A-Za-z0-9_-]{3,96}$/);
    const revisionId = safeId(spec.revisionId, "revisionId", /^[A-Za-z0-9_.-]{3,96}$/);
    const attached = await attachExactImageForAnimation(page, shotId, revisionId, runId);
    return {
      status: "ready",
      operation: "playwright_animate_flow_image",
      shotId,
      revisionId,
      referenceAttached: attached.referenceAttached,
      sourceMediaId: attached.sourceMediaId,
      editorFound: attached.editorFound,
      message: "Đã mở Animate từ image tile đúng SHOT_ID/REVISION_ID/RUN_ID và xác nhận ingredient ảnh trong video composer; chưa bấm Generate.",
    };
  }
  if (mode === "download_image") {
    const shotId = safeId(spec.shotId, "shotId", /^[A-Za-z0-9_-]{3,96}$/);
    const revisionId = safeId(spec.revisionId, "revisionId", /^[A-Za-z0-9_.-]{3,96}$/);
    const runId = safeId(spec.runId, "runId", /^[a-z0-9][a-z0-9-]{2,80}$/);
    const mediaId = spec.mediaId ? safeMediaIdArgument(spec.mediaId) : null;
    const selected = mediaId
      ? await findFreshImageDownloadButton(page, mediaId)
      : await findBatchDownloadButton(await findExactBatch(page, shotId, revisionId, runId));
    const before = await imageFiles(downloadDir);
    const downloadPromise = page.waitForEvent("download", { timeout: ACTION_TIMEOUT_MS }).catch(() => null);
    await selected.candidate.click();
    const download = await downloadPromise;
    let expectedName = null;
    if (download) {
      const destination = await uniqueDownloadPath(downloadDir, download.suggestedFilename(), safeId(spec.runId, "runId", /^[a-z0-9][a-z0-9-]{2,80}$/));
      await download.saveAs(destination);
      if (await download.failure()) throw new Error("Chrome báo download failure cho ảnh Flow");
      const normalizedPath = await normalizeDownloadedImage(destination);
      expectedName = normalizedPath.split(/[\\/]/).pop();
    }
    const fresh = await waitForFreshImage(downloadDir, before, expectedName);
    if (!fresh) throw new Error("Click đã thực hiện nhưng Downloads chưa có ảnh mới; không đánh dấu thành công");
    return {
      status: "ready",
      operation: "playwright_download_flow_image",
      shotId,
      revisionId,
      downloadStarted: Boolean(download),
      sourceMediaId: selected.sourceMediaId || mediaId || null,
      downloadName: fresh.name,
      downloadSizeBytes: fresh.size,
      message: `Đã bắt download ảnh Flow thật: ${fresh.name}; app có thể hash/import file này.`,
    };
  }
  throw new Error(`Playwright Flow mode không được phép: ${mode}`);
}

async function main() {
  const specPath = resolve(required("--spec"));
  const outputPath = resolve(required("--output"));
  const spec = JSON.parse(await readFile(specPath, "utf8"));
  const workspace = resolve(safeText(spec.workspace, "workspace", 2048));
  const projectUrl = safeProjectUrl(spec.projectUrl);
  const cdpUrl = safeCdpUrl(spec.flowCdpUrl);
  const moduleRoot = safeModuleRoot(spec.playwrightModuleRoot);
  const screenshotPath = spec.screenshotPath ? safeWorkspacePath(workspace, spec.screenshotPath, "screenshotPath") : null;
  const downloadDir = safeDownloadsPath(spec.downloadDir, spec.downloadProfile);
  if (screenshotPath) spec.screenshotPath = screenshotPath;
  const chromium = loadPlaywright(moduleRoot);
  const connected = await connectToFlow(chromium, cdpUrl, projectUrl);
  try {
    const cdpSession = await connected.page.context().newCDPSession(connected.page);
    const result = await runAction(connected.page, cdpSession, spec, downloadDir);
    if (spec.mode !== "observe" && screenshotPath) {
      await connected.page.screenshot({
        path: screenshotPath,
        fullPage: false,
        mask: [connected.page.locator("[aria-label*='Google Account'], [aria-label='Account details'], [aria-label*='email' i], [aria-label*='profile' i]")],
      });
    }
    const report = {
      schemaVersion: "1.0.0",
      status: result.status,
      projectUrl,
      targetUrl: connected.page.url().split("?")[0],
      mode: spec.mode || "observe",
      screenshotPath: spec.screenshotRelativePath || null,
      ...result,
    };
    await writeReport(outputPath, report);
    process.stdout.write(JSON.stringify({ status: report.status, operation: report.operation, outputPath }) + "\n");
    if (report.status !== "ready") process.exitCode = 2;
  } finally {
    await connected.browser.close();
  }
}

// The worker is a CLI entry point, but its per-mode actions are also exercised
// directly by focused tests, so it only runs when invoked as a script.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async (error) => {
    const outputPath = arg("--output");
    const report = {
      schemaVersion: "1.0.0",
      status: "blocked",
      operation: "playwright_flow_worker",
      message: boundedError(error),
    };
    if (outputPath) await writeReport(resolve(outputPath), report);
    process.stderr.write(JSON.stringify(report) + "\n");
    process.exitCode = 2;
  });
}

export { attachConfirmedMediaForAnimation, runAction };
