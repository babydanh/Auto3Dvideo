import { invoke } from "@tauri-apps/api/core";
import type { BrowserFlowAgentStepReport, BrowserFlowCapabilityCacheEntry, BrowserFlowDownloadedFile, BrowserFlowProviderIdentity, BrowserFlowUiRef, BrowserFlowWorkflow, GoogleFlowDomOutputReport } from "./browserFlowTypes";
import type { AssetView } from "../assets/assetTypes";
import type { LocalScriptDocument, LocalScriptSegment } from "../shared/scriptTypes";
import { parseVisibleFlowCreditCost } from "../../flowBatchBudget";
import { FLOW_DIRECTIVE_PLANNER_RULES, describeFlowDirectives, flowDirectivesForShot, formatFlowDirectives, normalizeFlowDirectives } from "../../flowCinematicDirectives";
import { assembleFlowShotPrompt, buildBriefDrivenFlowShotPrompt, flowShotExclusionLine, flowShotReferenceLine, isRepeatedBriefShotTemplate, sanitizeFlowShotPromptProse } from "../../flowShotPrompt";
import type { FlowShotPromptReference } from "../../flowShotPrompt";
import type { ShotReferenceBinding } from "../oneprompt/onePromptTypes";

export function compactBrowserFlowText(value: string | null | undefined, maxLength: number) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

const MAX_BROWSER_FLOW_AGENT_GOAL_CHARS = 230;

export function boundedBrowserFlowAgentGoal(goal: string) {
  return compactBrowserFlowText(goal, MAX_BROWSER_FLOW_AGENT_GOAL_CHARS);
}

export function isGoogleFlowSignInPage(workflow: BrowserFlowWorkflow) {
  const currentUrl = [
    workflow.currentUrl,
    workflow.providerProjectIdentity?.currentUrl,
  ].filter(Boolean).join(" ");
  if (/accounts\.google\.com/i.test(currentUrl)) return true;
  const labels = workflow.uiRefs.map((item) => item.label.trim().toLowerCase()).filter(Boolean);
  const hasAccountField = labels.some((label) => /email or phone|email address|password|mật khẩu/.test(label));
  const hasGoogleSignInCopy = labels.some((label) => /use your google account|sign in|đăng nhập/.test(label));
  return hasAccountField && hasGoogleSignInCopy;
}

export function inspectBrowserFlowVideoComposer(
  uiRefs: BrowserFlowUiRef[],
  evidence?: Pick<GoogleFlowDomOutputReport, "selectedModel" | "visibleCreditTexts" | "videoModeFound" | "promptEditorFound">,
) {
  const labels = uiRefs.map((item) => item.label.trim().toLowerCase()).filter(Boolean);
  const chatOnly = labels.some((label) => /bạn muốn tạo gì|câu trả lời tốt|câu trả lời không tốt|assistant|conversation|chat|message|tìm hiểu về|cho tôi biết/.test(label));
  const creditGate = labels.some((label) => /out of credits?|credits? exhausted|no credits|not enough credits?|insufficient credits?|credit required|quota (?:exceeded|exhausted)|limit reached|hết credit|không đủ credit|hết hạn mức|payment required|upgrade to generate/.test(label));
  const exactVideoRadio = evidence?.videoModeFound === true
    || uiRefs.some((item) => item.role.trim().toLowerCase() === "radio" && item.label.trim().toLowerCase() === "video");
  const modelVisible = labels.some((label) => /\b(?:omni|veo)\b/.test(label))
    || /\b(?:omni|veo)\b/i.test(evidence?.selectedModel ?? "");
  const priceVisible = labels.some((label) => /\b\d+\s*tín dụng\b/.test(label))
    || parseVisibleFlowCreditCost(evidence?.visibleCreditTexts ?? []) !== null;
  const hasVideoMode = (exactVideoRadio && modelVisible && priceVisible) || labels.some((label) => /text[- ]to[- ]video|video generation|video generator|video mode|chế độ video|tạo video|video flow/.test(label));
  const hasGenerate = labels.some((label) => /^(generate video|generate|start generation|tạo video|create video|bắt đầu tạo)$/.test(label) || /generate video|start generation|create video|tạo video/.test(label));
  const addIngredientsIndex = uiRefs.findIndex((item) => /thêm thành phần vào ô nhập câu lệnh|add ingredients.*prompt|prompt.*ingredients/.test(item.label.trim().toLowerCase()));
  const hasPrompt = uiRefs.some((item, index) => {
    const role = item.role.toLowerCase();
    const label = item.label.trim().toLowerCase();
    const inputRole = /textbox|textarea|input|contenteditable|generic|paragraph/.test(role);
    const explicitPrompt = /prompt|describe|text to video|what do you want|what would you like|video|bạn muốn thay đổi gì|tạo ảnh|image/.test(label);
    const modernVideoEditor = exactVideoRadio && modelVisible && priceVisible
      && ((label === "generic" && /generic|paragraph/.test(role) && addIngredientsIndex >= 0 && Math.abs(addIngredientsIndex - index) <= 2)
        || (label === "văn bản có thể chỉnh sửa" && /textbox|textarea|input|contenteditable/.test(role)));
    return inputRole && (explicitPrompt || modernVideoEditor);
  });
  return { chatOnly, creditGate, hasVideoMode, hasGenerate, hasPrompt, verified: hasVideoMode && hasGenerate && hasPrompt && !chatOnly && !creditGate };
}

export function flowProjectIdFromUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== "flow.google.com") return null;
    const match = url.pathname.match(/^\/project\/([^/]+)(?:\/|$)/i);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export function inspectBrowserFlowImageAgentMenu(uiRefs: BrowserFlowUiRef[]) {
  const labels = uiRefs.map((item) => item.label.trim().toLowerCase()).filter(Boolean);
  const videoModeVisible = labels.some((label) => /text[- ]to[- ]video|video generation|video generator|video mode|chế độ video|tạo video|video flow/.test(label));
  const agentVisible = labels.some((label) => label === "agent" || label === "agent instructions");
  const settingsVisible = labels.some((label) => /settings|cài đặt/.test(label));
  const startGenerationVisible = labels.includes("start generation") || labels.some((label) => /start generation|tạo ảnh/.test(label));
  return { videoModeVisible, agentVisible, settingsVisible, startGenerationVisible, verified: !videoModeVisible && agentVisible && settingsVisible && startGenerationVisible };
}

export function inspectBrowserFlowImageComposer(uiRefs: BrowserFlowUiRef[]) {
  const labels = uiRefs.map((item) => item.label.trim().toLowerCase()).filter(Boolean);
  const creditGate = labels.some((label) => /out of credits?|credits? exhausted|no credits|not enough credits?|insufficient credits?|credit required|quota (?:exceeded|exhausted)|limit reached|hết credit|không đủ credit|hết hạn mức|payment required|upgrade to generate/.test(label));
  const imageModePattern = /nano banana|image generation|image generator|create image|generate image|tạo ảnh|hình ảnh|bạn muốn thay đổi gì/;
  const hasNanoBanana = labels.some((label) => imageModePattern.test(label));
  const imageModeIndex = uiRefs.findIndex((item) => imageModePattern.test(item.label.trim().toLowerCase()));
  const addIngredientsIndex = uiRefs.findIndex((item) => {
    const label = item.label.trim().toLowerCase();
    return (label.includes("add ingredients") && label.includes("prompt"))
      || label.includes("thêm thành phần vào ô nhập câu lệnh")
      || (label.includes("thành phần") && label.includes("câu lệnh"));
  });
  const hasStartGeneration = labels.some((label) => label === "start generation" || label === "generate" || label.includes("start generation") || label === "tạo ảnh");
  const explicitVideo = labels.some((label) => label === "video" || label === "text-to-video" || label === "text to video" || /video generation|video generator|video mode|chế độ video|video flow/.test(label));
  const hasPrompt = uiRefs.some((item, index) => {
    const role = item.role.toLowerCase();
    const label = item.label.trim().toLowerCase();
    const isInput = /textbox|textarea|input|contenteditable|generic|paragraph/.test(role);
    const explicit = /bạn muốn thay đổi gì|nano banana|image|tạo ảnh|prompt|what do you want|what would you like|describe/.test(label);
    // Flow exposes the project title as [textbox] "Editable text". It sits
    // close to the composer controls in the accessibility tree, but it is
    // never a safe prompt target.
    const generic = !label || /^(textbox|paragraph)$/.test(label);
    const nearIngredients = addIngredientsIndex >= 0 && Math.abs(addIngredientsIndex - index) <= 16;
    return isInput && (explicit || (generic && (nearIngredients || (imageModeIndex >= 0 && Math.abs(imageModeIndex - index) <= 10))));
  });
  const hasSend = uiRefs.some((item) => /button|link|menuitem/.test(item.role.toLowerCase()) && /send|gửi|create|generate|tạo|arrow|submit/.test(item.label.toLowerCase()));
  // BrowserMCP 0.1.3 omits the Nano Banana/model label from this live Flow
  // page, but still exposes the real composer controls. This bounded trio is
  // enough to identify the image composer without accepting the chat box.
  const collapsedImageComposer = !explicitVideo && addIngredientsIndex >= 0 && hasStartGeneration && hasPrompt;
  // This live Flow composer exposes its real ProseMirror editor outside the
  // accessibility refs. Prefer the locked CDP DOM path whenever the exact
  // image-composer controls are present, even if BrowserMCP also exposes a
  // generic paragraph ref. This avoids stale BrowserMCP type retries after a
  // previous WebSocket timeout.
  const domPromptComposer = !explicitVideo && addIngredientsIndex >= 0 && hasStartGeneration;
  return { creditGate, hasNanoBanana, hasPrompt, hasSend, domPromptComposer, verified: !creditGate && ((hasNanoBanana && hasPrompt) || collapsedImageComposer || domPromptComposer) };
}

export function findBrowserFlowVideoModeRef(uiRefs: BrowserFlowUiRef[]) {
  return uiRefs
    .filter((item) => /button|radio|tab|option|menuitem/.test(item.role.toLowerCase()))
    .map((item) => {
      const label = item.label.trim().toLowerCase();
      const value = /^(text[- ]to[- ]video|video|video generation|video mode|chế độ video)$/.test(label) ? 30
        : /text[- ]to[- ]video|video generation|video mode|chế độ video/.test(label) ? 20 : -1;
      return { item, value };
    })
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value)[0]?.item;
}

export function findBrowserFlowVideoNavigationRef(uiRefs: BrowserFlowUiRef[]) {
  return uiRefs.find((item) =>
    /link|button|tab|menuitem|option/.test(item.role.toLowerCase())
      && item.label.trim().toLowerCase() === "video"
  );
}

export function findBrowserFlowCloseRef(uiRefs: BrowserFlowUiRef[]) {
  return uiRefs.find((item) =>
    item.role.toLowerCase() === "button"
      && /^close$/i.test(item.label.trim())
  );
}

export function findBrowserFlowBackRef(uiRefs: BrowserFlowUiRef[]) {
  return uiRefs.find((item) =>
    /link|button/.test(item.role.toLowerCase())
      && /^(back|back button to go to previous page|quay lại|nút quay lại để quay về trang trước)$/.test(item.label.trim().toLowerCase())
  );
}

export function hasBrowserFlowDestructiveOverlay(uiRefs: BrowserFlowUiRef[]) {
  return uiRefs.some((item) => {
    const label = item.label.trim().toLowerCase();
    return label.includes("delete permanently")
      || label === "undo"
      || label.includes("view in trash")
      || label.includes("moved to trash")
      || label === "trashed";
  });
}

export function findBrowserFlowImageModeRef(uiRefs: BrowserFlowUiRef[]) {
  const imageEntryPattern = /tạo một vài phiên bản của một hình ảnh|tạo bản vẽ ý tưởng|create an image|create image|text to image|image generation|image generator/;
  return uiRefs
    .filter((item) => /button|link|generic|card|tab|radio|option/.test(item.role.toLowerCase()))
    .map((item) => {
      const label = item.label.trim().toLowerCase();
      if (/nano banana|bạn muốn thay đổi|prompt|send|gửi|download|tải xuống/.test(label)) return { item, value: -1 };
      const value = /tạo một vài phiên bản của một hình ảnh|tạo bản vẽ ý tưởng/.test(label)
        ? 30
        : imageEntryPattern.test(label)
          ? 20
          : -1;
      return { item, value };
    })
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value)[0]?.item;
}

export const MAX_FLOW_VIDEO_GENERATION_SECONDS = 10;

// Keep the legacy BrowserOS path available for old sessions/manual debugging,
// while routing the desktop one-click workflow through the local MCP worker.
export function shouldUseGoogleFlowMcpDesktopRoute(): boolean {
  return true;
}

export function flowSegmentsForGeneration(script: LocalScriptDocument) {
  return script.segments.flatMap((segment, sourceIndex) => {
    const total = Math.max(1, segment.durationSeconds);
    const count = Math.max(1, Math.ceil(total / MAX_FLOW_VIDEO_GENERATION_SECONDS));
    return Array.from({ length: count }, (_, partIndex) => ({
      segment: count === 1 ? segment : {
        ...segment,
        segmentId: `${segment.segmentId}-part-${String(partIndex + 1).padStart(2, "0")}`,
        durationSeconds: Math.min(MAX_FLOW_VIDEO_GENERATION_SECONDS, Math.max(1, total - partIndex * MAX_FLOW_VIDEO_GENERATION_SECONDS)),
        action: `${segment.action || segment.narration} Part ${partIndex + 1}/${count}; continue directly from the previous part with identical subject identity, environment and screen direction.`,
        continuityNotes: `${segment.continuityNotes} This is part ${partIndex + 1}/${count} of the same shot beat; preserve the exact visual state at the cut.`,
      },
      // A split part has its own shot/revision identity but inherits the source
      // segment's reference, so bindings resolve by this stable id and never by
      // the numeric shot index.
      sourceSegmentId: segment.segmentId,
      sourceIndex,
      partIndex,
      partCount: count,
    }));
  });
}

export function hasCompleteFlowReferenceSet(script: LocalScriptDocument) {
  const expectedShotCount = Math.max(1, script.segments.length);
  const referenceCount = new Set((script.comfyuiAssetPaths ?? []).filter(Boolean)).size;
  return referenceCount >= expectedShotCount;
}

/**
 * `hasCompleteFlowReferenceSet` is a count comparison, and one missing
 * subject image downgrades every shot in the run to text-only. Without the
 * numbers, that downgrade repeats identically for each shot and the operator
 * has no way to tell which image to create.
 */
export function describeFlowReferenceSetShortfall(script: LocalScriptDocument): string {
  const shotCount = Math.max(1, script.segments.length);
  const assetCount = new Set((script.comfyuiAssetPaths ?? []).filter(Boolean)).size;
  if (assetCount >= shotCount) {
    return `Đủ ${assetCount} ảnh chủ thể cho ${shotCount} shot; mỗi shot sẽ tự tìm ảnh của mình trong lưới Flow.`;
  }
  return `Thiếu ảnh chủ thể: có ${assetCount} ảnh cho ${shotCount} shot, còn thiếu ${shotCount - assetCount}. Toàn bộ run sẽ chạy KHÔNG kèm ảnh cho mọi shot.`;
}

/**
 * Which shots own a *downloaded* subject image, keyed by the shot the import
 * recorded. It only names the shots so a shortfall is readable; it does not
 * prove what the Flow grid holds. A card generated on Flow and never
 * downloaded is invisible here, and so still to any gate built on it. The
 * only source that reflects the live grid is a DOM read
 * (`mediaByShotLabelCode` / `discover_google_flow_image_cards`).
 */
export function flowShotImageCoverage(
  workflow: Pick<BrowserFlowWorkflow, "downloadedFiles"> | null | undefined,
  shotIds: readonly string[],
): { withImage: string[]; withoutImage: string[] } {
  const owned = new Set<string>();
  for (const file of workflow?.downloadedFiles ?? []) {
    if (file.mediaKind !== "image") continue;
    const shotId = (file.shotId ?? "").trim();
    if (shotId) owned.add(shotId);
  }
  return {
    withImage: shotIds.filter((id) => owned.has(id)),
    withoutImage: shotIds.filter((id) => !owned.has(id)),
  };
}

/**
 * Subject images straight off the Flow grid. A card is matched to a shot by
 * the `SHOT_ID` the image prompt wrote into it — the same label the worker's
 * own `mediaByShotLabelCode` search uses, so both agree on which card belongs
 * to which shot. Unlike the workflow's import records this needs nothing
 * downloaded to the machine, so a card the user generated but never pulled
 * down still counts.
 */
export function flowShotImageCoverageFromCards(
  cards: readonly { label?: string | null; selectable?: boolean }[],
  shotIds: readonly string[],
): { withImage: string[]; withoutImage: string[] } {
  // A card the backend flagged non-selectable came from a truncated or partial
  // scan. It may look right while a duplicate is still unseen, and the worker
  // would refuse the attach later, so it must not count as a subject here.
  const labels = cards
    .filter((card) => card.selectable !== false)
    .map((card) => String(card.label ?? ""));
  const owns = (shotId: string) => labels.some((label) => label.includes(`SHOT_ID: ${shotId}`));
  return {
    withImage: shotIds.filter(owns),
    withoutImage: shotIds.filter((shotId) => !owns(shotId)),
  };
}

export function describeFlowReferenceCoverage(coverage: { withImage: string[]; withoutImage: string[] }): string {
  if (!coverage.withoutImage.length) return "Mọi shot đều có ảnh chủ thể trong lưới Flow.";
  return `Thiếu ảnh chủ thể cho: ${coverage.withoutImage.join(", ")}. Các shot này sẽ không tìm thấy card trong lưới Flow.`;
}

export function findBrowserFlowPromptRef(
  uiRefs: BrowserFlowUiRef[],
  evidence?: Pick<GoogleFlowDomOutputReport, "selectedModel" | "visibleCreditTexts" | "videoModeFound" | "promptEditorFound">,
) {
  const promptControlPattern = /add ingredients.*prompt|prompt.*ingredients|thêm thành phần.*(?:ô )?nhập câu lệnh|ô nhập câu lệnh.*thành phần|thành phần.*câu lệnh/;
  const addIngredientsIndex = uiRefs.findIndex((item) => promptControlPattern.test(item.label.trim().toLowerCase()));
  const imageModePattern = /nano banana|image generation|image generator|create image|generate image|tạo ảnh|hình ảnh|bạn muốn thay đổi gì/;
  const imageModeIndex = uiRefs.findIndex((item) => imageModePattern.test(item.label.trim().toLowerCase()));
  const modernVideoReady = inspectBrowserFlowVideoComposer(uiRefs, evidence).verified;
  const score = (item: BrowserFlowUiRef, index: number) => {
    const role = item.role.toLowerCase();
    const label = item.label.trim().toLowerCase();
    const isTextInput = /textbox|textarea|input|contenteditable/.test(role);
    const isComposerParagraph = /paragraph|generic/.test(role)
      && /^(?:paragraph|generic)$/.test(label)
      && addIngredientsIndex > index
      && addIngredientsIndex - index <= 2;
    const modernVideoEditor = modernVideoReady && label === "văn bản có thể chỉnh sửa"
      && /textbox|textarea|input|contenteditable/.test(role);
    if (label === "editable text") return -1000;
    if (/^(search|filter|find|address|url|email|title|name)$/.test(label) || /^(search|filter|find|address|url)\b/.test(label)) return -1000;
    const nearPromptControls = addIngredientsIndex >= 0 && Math.abs(addIngredientsIndex - index) <= 16;
    const nearImageMode = imageModeIndex >= 0 && Math.abs(imageModeIndex - index) <= 10;
    const explicitPrompt = /prompt|describe|text to video|what do you want|what would you like|create|write|concept|message|bạn muốn tạo gì|bạn muốn thay đổi gì|ô nhập câu lệnh|câu lệnh|nano banana|tạo ảnh|image/.test(label);
    const isExplicitComposer = explicitPrompt && /generic|paragraph|textbox|textarea|input|contenteditable|combobox|editable|div/.test(role);
    if (!isTextInput && !isComposerParagraph && !isExplicitComposer && !modernVideoEditor) return -1000;
    const genericComposer = !label || /^(textbox|editable text|paragraph)$/.test(label);
    if (!explicitPrompt && !(nearPromptControls && genericComposer) && !(nearImageMode && genericComposer) && !isComposerParagraph && !modernVideoEditor) return -1000;
    let value = isComposerParagraph ? 26 : modernVideoEditor ? 25 : nearPromptControls ? 22 : nearImageMode ? 20 : 12;
    if (explicitPrompt) value += 16;
    if (isExplicitComposer) value += 12;
    if (genericComposer) value += 4;
    return value;
  };
  return uiRefs
    .map((item, index) => ({ item, value: score(item, index) }))
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value)[0]?.item;
}

export function findBrowserFlowImageGenerateRef(uiRefs: BrowserFlowUiRef[]) {
  return uiRefs
    .filter((item) => /button|link/.test(item.role.toLowerCase()))
    .map((item) => {
      const label = item.label.trim().toLowerCase();
      const value = /^(start generation|generate|tạo ảnh)$/.test(label)
        ? 30
        : /start generation|generate image|tạo ảnh/.test(label) && !/chat|video/.test(label)
          ? 20
          : -1;
      return { item, value };
    })
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value)[0]?.item;
}

export function findBrowserFlowApprovalRef(uiRefs: BrowserFlowUiRef[]) {
  if (!inspectBrowserFlowVideoComposer(uiRefs).verified) return undefined;
  return uiRefs
    .filter((item) => /button|radio|option/.test(item.role.toLowerCase()))
    .map((item) => ({
      item,
      value: /^(approve|generate video|generate|tạo video|start generation|create video|bắt đầu tạo)$/.test(item.label.trim().toLowerCase())
        ? 20
        : /approve.*video|start generation|generate video|create video|tạo video/.test(item.label.toLowerCase())
          ? 12
          : /always approve|reject|cancel/.test(item.label.toLowerCase())
            ? -100
            : -1,
    }))
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value)[0]?.item;
}

export function findBrowserFlowDownloadRef(uiRefs: BrowserFlowUiRef[]) {
  return uiRefs
    .filter((item) => /button|link|menuitem/.test(item.role.toLowerCase()))
    .map((item) => ({
      item,
      value: /download video|download image|tải ảnh|tải video|tải xuống|download|export video|export image|xuất video|xuất ảnh|save video|save image|lưu video|lưu ảnh/.test(item.label.trim().toLowerCase()) ? 20 : -1,
    }))
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value)[0]?.item;
}

export function findBrowserFlowProjectRef(uiRefs: BrowserFlowUiRef[]) {
  return uiRefs
    .filter((item) => /button|link|generic|card/.test(item.role.toLowerCase()))
    .map((item) => {
      const label = item.label.trim().toLowerCase();
      const isOpenProject = /open project|mở project|continue project|resume project/.test(label);
      const isComposerEntry = /start creating|bắt đầu tạo|new project|dự án mới|create project|tạo dự án/.test(label);
      return { item, value: isOpenProject ? 30 : isComposerEntry ? 20 : -1 };
    })
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value)[0]?.item;
}

export function findBrowserFlowStoryboardChoiceRef(uiRefs: BrowserFlowUiRef[]) {
  return uiRefs
    .filter((item) => /button|radio|option/.test(item.role.toLowerCase()))
    .map((item) => ({
      item,
      value: /storyboard\s+all\s+\d+\s+shots?\s+first/.test(item.label.toLowerCase())
        ? 30
        : /storyboard.*shots?.*first/.test(item.label.toLowerCase())
          ? 20
          : -1,
    }))
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value)[0]?.item;
}

export function inspectBrowserFlowGeneration(uiRefs: BrowserFlowUiRef[]) {
  const composer = inspectBrowserFlowVideoComposer(uiRefs);
  const labels = uiRefs.map((item) => item.label.trim().toLowerCase()).filter(Boolean);
  const isWorking = labels.some((label) => /\bdừng\b|\btư duy\b|generating|processing|rendering|creating|loading|đang tạo|đang xử lý|đang dựng/.test(label));
  const hasResponse = labels.some((label) => /câu trả lời tốt|câu trả lời không tốt|sao chép|copy|bắt đầu tạo|start generation|download|tải xuống|export|xuất/.test(label));
  const hasMedia = uiRefs.some((item) => /video|media/.test(item.role.toLowerCase()));
  const hasOutputControl = labels.some((label) => /download video|tải video|tải xuống|download|export video|xuất video|save video|lưu video|generated video|video result|video ready|đã tạo video|video đã sẵn sàng/.test(label));
  const readyForApproval = composer.verified && hasResponse && !isWorking;
  // A generic media region is not proof that this run generated anything.
  // Output becomes actionable only when Flow exposes an explicit download/export control.
  const readyForOutput = composer.verified && hasOutputControl && !isWorking;
  return { ...composer, isWorking, hasResponse, hasMedia, hasOutputControl, readyForApproval, readyForOutput };
}

function flowDirectivePromptLines(segment: LocalScriptSegment, shotIndex: number) {
  const directives = normalizeFlowDirectives(flowDirectivesForShot(segment.flowDirectives, shotIndex), 5);
  return [
    `FLOW CINEMATIC COMMANDS (prompt vocabulary, not UI actions): ${formatFlowDirectives(directives)}`,
    `FLOW COMMAND INTERPRETATION: ${describeFlowDirectives(directives)}`,
    FLOW_DIRECTIVE_PLANNER_RULES,
  ];
}

export function buildBrowserFlowPrompt(script: LocalScriptDocument, originalPrompt: string) {
  const lines = [
    "Create a coherent cinematic 3D video project plan from the following concept and shot plan.",
    "IMPORTANT: This is a project-level overview, not a request for one long video generation.",
    `ORIGINAL CONCEPT: ${compactBrowserFlowText(originalPrompt, 720)}`,
    `TITLE: ${compactBrowserFlowText(script.title, 240)}`,
    `HOOK: ${compactBrowserFlowText(script.hook, 420)}`,
    `TOTAL PROJECT DURATION: ${script.totalDurationSeconds.toFixed(1)} seconds (the sum of all shots, not one provider generation)`,
    `SHOT COUNT: ${script.segments.length}. Each provider generation must be at most ${MAX_FLOW_VIDEO_GENERATION_SECONDS} seconds. The app submits one shot at a time and composes the downloaded outputs afterward.`,
    "PROVIDER CONTRACT: Never request, generate or pretend to generate a single clip longer than 10 seconds. Do not merge all shots into one prompt or one repeated-image output.",
    "FLOW DIRECTOR VOCABULARY: Each shot may carry a small allowlisted set of cinematic slash-tokens. They are prompt annotations, never browser/UI actions. The shot prompt includes both the exact tokens and their natural-language meaning.",
    "TIMING CONTRACT: Preserve shot order and the requested approximate durations. If a shot is very short, treat it as a rapid montage beat; do not discard, duplicate or silently compress the other shot cards.",
    "SHOT PLAN:",
  ];
  script.segments.slice(0, 24).forEach((segment, index) => {
    const beats = (segment.beats ?? []).slice(0, 6).map((beat) => `${beat.imageRole}: ${compactBrowserFlowText(beat.prompt || beat.action, 220)}`).join(" | ");
    const visual = compactBrowserFlowText(segment.visualPrompt || `${segment.subject ?? "subject"}; ${segment.action ?? segment.narration}`, 620);
    lines.push(`SHOT ${String(index + 1).padStart(2, "0")} (${segment.durationSeconds.toFixed(1)}s): ${visual}`);
    lines.push(...flowDirectivePromptLines(segment, index));
    if (beats) lines.push(`BEATS: ${beats}`);
  });
  lines.push("Continuity: preserve subject identity, palette, screen direction, scale, lighting and camera logic across all shots.");
  lines.push("Use the attached reference images when available. This overview is for planning/review; actual video creation must use the app's per-shot submission flow in the current Google Flow project.");
  const compiled = lines.join("\n");
  return compiled.length <= 3950
    ? compiled
    : `${compiled.slice(0, 3650)}\nAUTO MODE CONTRACT: submit each SHOT separately; later shots are not omitted when this overview is truncated.`;
}

export async function sha256Text(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type PromptTimingRequirements = {
  shotCount: number | null;
  durationSeconds: number | null;
};

export function inferPromptTimingRequirements(prompt: string): PromptTimingRequirements {
  const normalized = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  const shotMatch = normalized.match(/(?<!\d)(\d{1,2})\s*(?:shot|shots|cảnh|phân cảnh)\b/);
  let shotCount = shotMatch ? Math.max(2, Math.min(12, Number(shotMatch[1]))) : null;
  const pairMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:s|sec|secs|giây)\s+(\d{1,2})\s*(?:shot|shots|cảnh|phân cảnh)\b|(?:shot|shots|cảnh|phân cảnh)\s*(?:\/|mỗi)?\s*(\d+(?:[.,]\d+)?)\s*(?:s|sec|secs|giây)/);
  const perShotSeconds = pairMatch
    ? Number((pairMatch[1] ?? pairMatch[3] ?? "").replace(",", "."))
    : null;
  if (!shotCount && pairMatch?.[2]) shotCount = Math.max(2, Math.min(12, Number(pairMatch[2])));
  if (shotCount && perShotSeconds && Number.isFinite(perShotSeconds)) {
    return { shotCount, durationSeconds: Math.round(shotCount * Math.max(1, perShotSeconds) * 100) / 100 };
  }
  const durationMatch = normalized.match(/(?:dài|khoảng|trong|thời lượng|duration|video)\D{0,24}(\d+(?:[.,]\d+)?)\s*(?:s|sec|secs|giây)\b/) ?? normalized.match(/(?<!\d)(\d+(?:[.,]\d+)?)\s*(?:giây|secs?|sec)\b/);
  const durationSeconds = durationMatch ? Number(durationMatch[1].replace(",", ".")) : null;
  return { shotCount, durationSeconds: durationSeconds !== null && Number.isFinite(durationSeconds) ? Math.max(1, Math.min(180, durationSeconds)) : null };
}

export function promptSourceFingerprintInput(topic: string, objective: string, additionalPrompt: string, referenceContext: string) {
  return JSON.stringify({
    topic: topic.trim().replace(/\r\n/g, "\n"),
    objective: objective.trim(),
    additionalPrompt: additionalPrompt.trim(),
    referenceContext: referenceContext.trim(),
  });
}

export function scriptMatchesPrompt(script: LocalScriptDocument, sourcePromptHash: string, requirements: PromptTimingRequirements): boolean {
  if (script.sourcePromptHash !== sourcePromptHash) return false;
  if (requirements.shotCount !== null && (script.requestedShotCount !== requirements.shotCount || script.segments.length !== requirements.shotCount)) return false;
  if (requirements.durationSeconds !== null && (script.requestedDurationSeconds !== requirements.durationSeconds || Math.abs(script.totalDurationSeconds - requirements.durationSeconds) > 0.25)) return false;
  return script.segments.length >= 2 && script.segments.every((segment) => Number.isFinite(segment.durationSeconds) && segment.durationSeconds >= 1);
}

export function buildBrowserFlowShotPrompt(script: LocalScriptDocument, segment: LocalScriptSegment, index: number, runId: string, revisionId: string, providerIdentity?: Pick<BrowserFlowProviderIdentity, "providerProjectKey"> | null, sessionId?: string | null, userBrief: string = "", briefShotNumber = index + 1, shotReference?: FlowShotPromptReference | null): string | null {
  const shotId = `SHOT-${String(index + 1).padStart(3, "0")}`;
  if (isRepeatedBriefShotTemplate(segment.subject ?? "", segment.visualPrompt ?? "", userBrief)) {
    return buildBriefDrivenFlowShotPrompt({
      brief: userBrief,
      shotNumber: briefShotNumber,
      shotId,
      revisionId,
      runId,
      projectId: providerIdentity?.providerProjectKey || "",
      sessionId: sessionId ?? null,
      durationSeconds: segment.durationSeconds,
      maxDurationSeconds: MAX_FLOW_VIDEO_GENERATION_SECONDS,
      shotReference,
    });
  }
  // A split part resolves to the source segment it was cut from, so continuity
  // names the previous real shot instead of a neighbouring part.
  const sourceIndex = flowSourceSegmentIndex(script, segment);
  const previousSegment = sourceIndex > 0 ? script.segments[sourceIndex - 1] ?? null : null;
  const previousShotId = previousSegment ? `SHOT-${String(sourceIndex).padStart(3, "0")}` : "";
  // The planner writes these fields itself, from a brief the human edited
  // against a local workspace, so they get the same sanitizing the brief branch
  // gets: a local path or a provider tag in a field is a leak, not a shot.
  const previousAction = shotPromptProse(previousSegment?.action || previousSegment?.narration || previousSegment?.onScreenText, 300);
  const currentAction = shotPromptProse(segment.action || segment.narration, 300);
  const mandatory = [
    "AUTO3DVIDEO SHOT SUBMISSION — create exactly one standalone video shot; render one continuous unbroken shot with no scene cuts, never a contact sheet, storyboard grid, collage, or repeated placeholder.",
    `SHOT_ID: ${shotId} | REVISION_ID: ${revisionId} | RUN_ID: ${runId}`,
    `PROJECT_IDENTITY: ${providerIdentity?.providerProjectKey || "UNVERIFIED — do not submit until the current Flow project URL is verified"}`,
    `SESSION_ID: ${sessionId || "local-session"}`,
    `DURATION: ${segment.durationSeconds.toFixed(2)} seconds (must be <= ${MAX_FLOW_VIDEO_GENERATION_SECONDS}s); keep this shot separate and preserve its order in the project.`,
    flowShotReferenceLine(shotReference),
  ];
  const optional = [
    `CONTINUITY_BIBLE_VERSION: ${shotPromptProse(script.promptVersion || "cinematic-3d-bible-v1", 180)}`,
    `THEME: ${shotPromptProse(script.title, 180)} — ${shotPromptProse(script.hook, 260)}`,
    `SUBJECT / IDENTITY: ${shotPromptProse(segment.subject, 650)}`,
    `ENVIRONMENT: ${shotPromptProse(segment.visualPrompt, 900)}`,
    `ACTION / CAUSE AND EFFECT: ${currentAction}`,
    `CAMERA / LENS: ${shotPromptProse(segment.cameraIntent, 420)}`,
    `LIGHT / MATERIAL: ${shotPromptProse(segment.lightingIntent, 420)}`,
    ...flowDirectivePromptLines(segment, index),
    previousSegment && previousAction
      ? `CONTINUITY FROM PREVIOUS SHOT: ${previousShotId} ended with "${previousAction}"; continue from that exact subject, world, screen direction and light into this shot's new action.`
      : "CONTINUITY FROM PREVIOUS SHOT: this is the opening shot; establish the subject identity, world, screen direction and light that every later shot continues.",
    `CONTINUITY: ${shotPromptProse(segment.continuityNotes, 650)}`,
    flowShotExclusionLine(segment.negativePrompt),
    "ACCEPTANCE: visible intended subject; correct species/object identity; correct scale and action; stable camera and lighting; explicit video output available for download.",
    "Use the current Google Flow project and wait until this shot's output is ready before starting another shot.",
  ];
  return assembleFlowShotPrompt(mandatory, optional);
}

// Sanitizing happens before bounding, so a long value can never be cut in the
// middle of a path and leave half of one behind.
function shotPromptProse(value: string | null | undefined, maxLength: number) {
  return compactBrowserFlowText(sanitizeFlowShotPromptProse(value, maxLength), maxLength);
}

function flowSourceSegmentIndex(script: LocalScriptDocument, segment: LocalScriptSegment) {
  const direct = script.segments.findIndex((item) => item.segmentId === segment.segmentId);
  if (direct >= 0) return direct;
  const sourceSegmentId = segment.segmentId.replace(/-part-\d+$/, "");
  return script.segments.findIndex((item) => item.segmentId === sourceSegmentId);
}

const MAX_BROWSER_FLOW_IMAGE_PROMPT_CHARS = 8_000;

export function buildBrowserFlowImagePrompt(script: LocalScriptDocument, segment: LocalScriptSegment, index: number, runId: string, revisionId: string) {
  const shotId = `SHOT-${String(index + 1).padStart(3, "0")}`;
  const lines = [
    `SHOT_ID: ${shotId}`,
    `REVISION_ID: ${revisionId}`,
    `RUN_ID: ${runId}`,
    "Create exactly one polished cinematic 3D reference image for this shot. Never create a contact sheet, storyboard grid, collage, or multiple images.",
    `SUBJECT AND ACTION: ${compactBrowserFlowText(segment.visualPrompt || segment.action || segment.narration, 1_800)}`,
    `CAMERA AND LIGHTING: ${compactBrowserFlowText(segment.cameraIntent, 900) || "cinematic camera, readable composition"}; ${compactBrowserFlowText(segment.lightingIntent, 900) || "physically based cinematic lighting"}`,
    ...flowDirectivePromptLines(segment, index),
    `CONTINUITY: ${compactBrowserFlowText(segment.continuityNotes, 1_400) || "Preserve the same hero identity, proportions, colors, materials, world scale, and screen direction across every shot."}`,
    `STYLE: ${compactBrowserFlowText(script.title, 260)}; full CGI 3D, realistic anatomy and materials, detailed environment, clean single frame, 16:9, no text, no logo, no watermark, no contact sheet, no collage, no debug primitives.`,
    `NEGATIVE: ${compactBrowserFlowText(segment.negativePrompt, 1_200) || "random characters, duplicate subject, broken anatomy, plastic toy look, UI, text, watermark"}`,
  ];
  return lines.join("\n").slice(0, MAX_BROWSER_FLOW_IMAGE_PROMPT_CHARS);
}

export function stableBrowserFlowPrompt(prompt: string) {
  return prompt
    .replace(/^RUN_ID:\s*[^\r\n]+\r?\n?/m, "")
    // The compiled prompt now carries shot, revision and run identity on one
    // line; the run id must still stay out of the shot's stable input, exactly
    // as it was when it had a line of its own.
    .replace(/\s*\|\s*RUN_ID:\s*[^\r\n|]*/, "")
    .trim();
}

export type FlowReferenceFingerprintParts = {
  projectId: string;
  flowProjectId: string;
  sessionId: string | null;
  segmentId: string;
  assignmentId: string;
  assetSha256: string;
  flowMediaId: string;
  role: string;
  confirmationKind: string | null;
};

/**
 * The canonical identity of one explicit reference. It is an identity
 * snapshot of what the user bound, not proof that the provider kept the same
 * pixels, so it is hashed together with the prompt to decide whether a shot's
 * recorded paid click still matches the input about to be submitted.
 */
export function flowReferenceFingerprintInput(parts: FlowReferenceFingerprintParts) {
  return JSON.stringify([
    parts.projectId,
    parts.flowProjectId,
    parts.sessionId ?? null,
    parts.segmentId,
    parts.assignmentId,
    parts.assetSha256,
    parts.flowMediaId,
    parts.role,
    parts.confirmationKind ?? null,
  ]);
}

export async function flowReferenceFingerprint(parts: FlowReferenceFingerprintParts) {
  return sha256Text(flowReferenceFingerprintInput(parts));
}

/**
 * A reference-free shot keeps hashing the stable prompt alone, so its legacy
 * prompt-only hash is unchanged; a bound shot's hash additionally covers the
 * reference identity that produced it.
 */
export function flowShotInputHashInput(stablePrompt: string, referenceFingerprint: string | null) {
  return referenceFingerprint ? `${stablePrompt}\n${referenceFingerprint}` : stablePrompt;
}

export type FlowShotReferenceAttachPlan =
  | { ok: true; route: "explicit_media"; mediaId: string }
  | { ok: true; route: "legacy_label" | "text_to_video"; mediaId: null }
  | { ok: false; code: string; message: string };

/**
 * An explicit binding always routes by its own media ID, and a binding that
 * never reached a Flow card is a stop, not a reason to fall back to the
 * historical shot/revision label search.
 *
 * The fallback is decided per shot, from whether *this* shot owns a subject
 * image. A run-wide count made one missing image strip the reference from
 * every other shot in the run, which is why a subject present on the Flow
 * grid could still be ignored.
 */
export function planFlowShotReferenceAttach(input: {
  binding: ShotReferenceBinding | null;
  legacyShotId: string;
  legacyRevisionId: string;
  shotHasSubjectImage: boolean;
  runIsImageDriven: boolean;
}): FlowShotReferenceAttachPlan {
  if (input.binding) {
    const mediaId = (input.binding.flowMediaId ?? "").trim();
    if (!mediaId) {
      return {
        ok: false,
        code: "unbound_flow_media",
        message: `shot này đã gắn reference ${input.binding.assignmentId} nhưng chưa có Flow media ID nào được xác nhận; không Animate theo nhãn shot/revision lịch sử.`,
      };
    }
    return { ok: true, route: "explicit_media", mediaId };
  }
  if (input.shotHasSubjectImage) return { ok: true, route: "legacy_label", mediaId: null };
  // A run that carries subject images anywhere is image-driven. If this shot
  // has none, silently falling back would spend credits on a video that does
  // not match the storyboard, so the shot stops before any prompt is typed.
  if (input.runIsImageDriven) {
    return {
      ok: false,
      code: "subject_image_missing",
      message: "KHÔNG kèm ảnh — run này có ảnh chủ thể ở các shot khác, nhưng không tìm thấy ảnh của shot này trong lưới Flow. Không nhập prompt và không bấm Generate cho shot này.",
    };
  }
  return { ok: true, route: "text_to_video", mediaId: null };
}
/**
 * One plain line per shot saying which image route it took. Without it a run
 * that silently fell back to `text_to_video` looks identical to one that
 * attached the subject, so a missing image is invisible until the output
 * disappoints.
 */
export function describeFlowShotReferenceAttach(shotId: string, plan: FlowShotReferenceAttachPlan): string {
  if (!plan.ok) return `${shotId}: dừng, không tìm được ảnh (${plan.code}) — ${plan.message}`;
  if (plan.route === "explicit_media") {
    return `${shotId}: gắn đúng card Flow đã xác nhận (media ${plan.mediaId}).`;
  }
  if (plan.route === "legacy_label") {
    return `${shotId}: tìm ảnh chủ thể theo nhãn SHOT_ID trong lưới Flow; không có binding đã xác nhận nên dùng đường nhãn lịch sử.`;
  }
  return `${shotId}: KHÔNG kèm ảnh — bộ reference chưa đủ cho mọi shot nên chạy text-to-video thuần.`;
}

export function verifyFlowShotReferenceAttach(
  mediaId: string,
  report: { status?: string; referenceAttached?: boolean; sourceMediaId?: string | null; message?: string } | null | undefined,
): { ok: true; sourceMediaId: string } | { ok: false; code: string; message: string } {
  if (!report || report.status !== "ready") {
    return { ok: false, code: "animate_failed", message: `Animate chưa chạy được trên Flow: ${report?.message ?? "không có báo cáo"}` };
  }
  if (report.referenceAttached !== true) {
    return { ok: false, code: "reference_not_attached", message: `Flow chưa xác nhận gắn đúng media ${mediaId}: ${report.message ?? "không có báo cáo"}` };
  }
  if ((report.sourceMediaId ?? "").trim() !== mediaId) {
    return { ok: false, code: "mismatched_source_media", message: `Flow gắn media khác (${report.sourceMediaId ?? "không rõ"}) thay vì media đã xác nhận ${mediaId}; dừng trước khi nhập prompt.` };
  }
  return { ok: true, sourceMediaId: mediaId };
}

function assetContainsFlowIdentity(asset: AssetView, shotId: string, revisionId: string) {
  const searchable = [asset.relativePath, asset.title, ...asset.tags, asset.note].join(" ");
  const escapedShot = shotId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedRevision = revisionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const shotMatches = new RegExp(`(?:^|[^A-Z0-9])${escapedShot}(?:[^A-Z0-9]|$)`, "i").test(searchable)
    || new RegExp(`(?:^|[^A-Z0-9])shot[-_ ]?0*${shotId.match(/(\d+)$/)?.[1] ?? ""}(?:[^A-Z0-9]|$)`, "i").test(searchable);
  const revisionMatches = new RegExp(`(?:^|[^A-Z0-9])${escapedRevision}(?:[^A-Z0-9]|$)`, "i").test(searchable)
    || !/rev(?:ision)?[-_ ]?\d+/i.test(searchable);
  return shotMatches && revisionMatches;
}

export function findResumableFlowAsset(
  localAssets: AssetView[],
  downloadedFiles: BrowserFlowDownloadedFile[],
  shotId: string,
  revisionId: string,
  inputHash: string,
) {
  const workflowCandidates = downloadedFiles
    .filter((file) => file.mediaKind === "image" && file.shotId === shotId && file.revisionId === revisionId)
    .sort((left, right) => String(right.importedAt).localeCompare(String(left.importedAt)));
  const exactWorkflow = workflowCandidates.find((file) => file.inputHash === inputHash);
  const workflowAsset = [...(exactWorkflow ? [exactWorkflow] : []), ...workflowCandidates.filter((file) => file !== exactWorkflow)]
    .map((file) => localAssets.find((asset) => asset.relativePath === file.relativePath))
    .find((asset): asset is AssetView => Boolean(asset));
  if (workflowAsset) return workflowAsset;

  // Migration fallback for older downloads: they were imported with a
  // per-run hash and no stable revision in the filename. Only accept one
  // unambiguous asset for this shot, never guess among multiple revisions.
  const shotCandidates = localAssets.filter((asset) => asset.kind === "image"
    && asset.status !== "archived"
    && assetContainsFlowIdentity(asset, shotId, revisionId));
  return shotCandidates.length === 1 ? shotCandidates[0] : null;
}

export async function runBrowserFlowAgent(projectId: string, workflow: BrowserFlowWorkflow, goal: string, text: string | null = null): Promise<BrowserFlowAgentStepReport> {
  return invoke<BrowserFlowAgentStepReport>("browser_flow_agent_step", {
    request: {
      projectId,
      workflowId: workflow.workflowId,
      goal: boundedBrowserFlowAgentGoal(goal),
      text,
      approved: true,
    },
  });
}

export const browserFlowCapabilityCacheStorageKey = "auto3dvideo.browser-flow-capability-cache.v1";

export function browserFlowCapabilityCacheIdentity(projectId: string, workflow: BrowserFlowWorkflow, mode: "video" | "image") {
  const providerProjectKey = workflow.providerProjectIdentity?.providerProjectKey?.trim() ?? "";
  const currentUrl = workflow.currentUrl?.trim() ?? "";
  const identity = providerProjectKey || currentUrl;
  return identity ? `${projectId}|${mode}|${identity}` : null;
}

export function readBrowserFlowCapabilityCache(): Record<string, BrowserFlowCapabilityCacheEntry> {
  try {
    const raw = window.localStorage.getItem(browserFlowCapabilityCacheStorageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        const entry = value as Partial<BrowserFlowCapabilityCacheEntry>;
        return entry.mode === "video" && typeof entry.observedAt === "string" && typeof entry.message === "string";
      }),
    ) as Record<string, BrowserFlowCapabilityCacheEntry>;
  } catch {
    return {};
  }
}

export function writeBrowserFlowCapabilityCache(cache: Record<string, BrowserFlowCapabilityCacheEntry>) {
  try {
    window.localStorage.setItem(browserFlowCapabilityCacheStorageKey, JSON.stringify(cache));
  } catch {
    // This is a convenience cache. Composer safety does not depend on storage being available.
  }
}

export function clearBrowserFlowCapabilityCache(projectId?: string) {
  const cache = readBrowserFlowCapabilityCache();
  if (!projectId) {
    writeBrowserFlowCapabilityCache({});
    return;
  }
  const prefix = `${projectId}|`;
  writeBrowserFlowCapabilityCache(Object.fromEntries(Object.entries(cache).filter(([key]) => !key.startsWith(prefix))));
}
