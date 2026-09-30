#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const MAX_PROMPT_CHARS = 12000;
const TIMEOUT_MS = 15000;

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name) {
  const value = arg(name);
  if (!value) throw new Error(`Thiếu ${name}`);
  return value;
}

function safePrompt(value) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_PROMPT_CHARS || value.includes("\0")) {
    throw new Error("Prompt Flow không hợp lệ");
  }
  const lower = value.toLowerCase();
  for (const marker of ["api_key=", "apikey=", "access_token=", "authorization=", "bearer ", "client_secret=", "password=", "secret=", "token="]) {
    if (lower.includes(marker)) throw new Error("Prompt Flow có dấu hiệu credential");
  }
  return value.replace(/\r\n?/g, "\n").trim();
}

function safeProjectUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.hostname !== "flow.google.com" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
    throw new Error("Flow project URL không hợp lệ");
  }
  const match = parsed.pathname.match(/^\/project\/([A-Za-z0-9-]+)(?:\/.*)?$/);
  if (!match) throw new Error("Flow project URL phải có dạng /project/<id>");
  return `https://flow.google.com/project/${match[1]}`;
}

function boundedError(value) {
  const text = value instanceof Error ? value.message : String(value);
  return text.replace(/(?:api[_-]?key|access[_-]?token|authorization|password|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").slice(0, 900);
}

function loadWebSocket(serverEntry) {
  const modulePath = require.resolve("ws", { paths: [dirname(serverEntry)] });
  const loaded = require(modulePath);
  const implementation = loaded.WebSocket ?? loaded.default ?? loaded;
  if (typeof implementation !== "function") throw new Error("Không nạp được websocket CDP");
  return implementation;
}

async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Chrome CDP trả HTTP ${response.status}`);
  return response.json();
}

class CdpClient {
  constructor(WebSocketImplementation, url) {
    this.nextId = 1;
    this.pending = new Map();
    this.open = new Promise((resolveOpen, rejectOpen) => {
      this.resolveOpen = resolveOpen;
      this.rejectOpen = rejectOpen;
    });
    this.ws = new WebSocketImplementation(url);
    this.ws.on("open", () => this.resolveOpen());
    this.ws.on("message", (raw) => {
      let message;
      try { message = JSON.parse(raw.toString("utf8")); } catch { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "Chrome CDP lỗi"));
      else pending.resolve(message.result);
    });
    this.ws.on("error", (error) => {
      this.rejectOpen(error);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
    this.ws.on("close", () => {
      const error = new Error("Chrome CDP websocket đã đóng");
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  async request(method, params = {}) {
    await Promise.race([
      this.open,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Chrome CDP mở websocket quá thời gian")), TIMEOUT_MS)),
    ]);
    const id = this.nextId++;
    return new Promise((resolveResult, rejectResult) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectResult(new Error(`Chrome CDP timeout ở ${method}`));
      }, TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolveResult(value); },
        reject: (error) => { clearTimeout(timer); rejectResult(error); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.ws.close(); } catch { /* process is exiting */ }
  }
}

async function dispatchTrustedClick(client, rect) {
  const x = Number(rect?.x) + Number(rect?.width) / 2;
  const y = Number(rect?.y) + Number(rect?.height) / 2;
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Vị trí click Flow không hợp lệ");
  await client.request("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  await client.request("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await client.request("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

function promptEditorExpression() {
  return `(() => {
    const editors = [...document.querySelectorAll('flow-rich-text-editor.prompt-input div.ProseMirror[contenteditable="true"]')];
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const editor = editors.find(visible);
    if (!editor) return { found: false, reason: 'Không tìm thấy Flow prompt editor ProseMirror trong composer.' };
    const generationControlFound = [...document.querySelectorAll('button, [role="button"]')].some((node) => {
      if (!visible(node)) return false;
      const label = (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
      return /^(?:start generation|generate image|tạo ảnh)$/i.test(label) || /start generation|generate image|tạo ảnh/i.test(label) && !/chat|assistant|video/i.test(label);
    });
    if (!generationControlFound) return { found: false, generateButtonFound: false, reason: 'Flow đang ở Agent/chat hoặc output detail; chưa thấy control Generate của image composer.' };
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    return { found: true, selected: true, generateButtonFound: true, generateButtonEnabled: true, composer: 'flow-rich-text-editor.prompt-input' };
  })()`;
}

function verifyEditorExpression() {
  return `(() => {
    const editor = document.querySelector('flow-rich-text-editor.prompt-input div.ProseMirror[contenteditable="true"]');
    if (!editor) return { found: false, accepted: false };
    const text = (editor.innerText || '').trim();
    return { found: true, accepted: text.length > 0 && text.includes('SHOT_ID:') && text.includes('REVISION_ID:'), charCount: text.length };
  })()`;
}

function inspectOutputExpression(shotId = null, revisionId = null, runId = null) {
  const shotToken = JSON.stringify(shotId || "");
  const revisionToken = JSON.stringify(revisionId || "");
  const runToken = JSON.stringify(runId || "");
  return `(() => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const deepElements = (root) => {
      const elements = [];
      const seenRoots = new Set();
      const visit = (scope) => {
        if (!scope || seenRoots.has(scope)) return;
        seenRoots.add(scope);
        if (scope.shadowRoot) visit(scope.shadowRoot);
        for (const node of scope.querySelectorAll ? scope.querySelectorAll('*') : []) {
          elements.push(node);
          if (node.shadowRoot) visit(node.shadowRoot);
        }
      };
      visit(root);
      return elements;
    };
    const textOf = (node) => String(node.innerText || node.textContent || '')
      .split(/\\s+/)
      .filter(Boolean)
      .join(' ')
      .trim();
    const media = [];
    for (const node of deepElements(document)) {
      const tag = node.tagName.toLowerCase();
      if ((tag === 'img' || tag === 'video' || tag === 'canvas') && visible(node)) {
        const rect = node.getBoundingClientRect();
        const naturalWidth = node.naturalWidth || node.videoWidth || 0;
        const naturalHeight = node.naturalHeight || node.videoHeight || 0;
        if (rect.width >= 160 && rect.height >= 90 && (naturalWidth >= 160 || tag === 'canvas')) {
          const mediaId = node.getAttribute('data-media-id') || node.getAttribute('data-mediaid') || '';
          media.push({ tag, mediaId, width: Math.round(rect.width), height: Math.round(rect.height), naturalWidth, naturalHeight });
        }
      }
    }
    const bodyText = textOf(document.body);
    const requestedShotId = ${shotToken};
    const requestedRevisionId = ${revisionToken};
    const requestedRunId = ${runToken};
    const hasIdentity = Boolean(requestedShotId && requestedRevisionId && requestedRunId);
    const batches = deepElements(document).filter((node) => node.tagName.toLowerCase() === 'flow-batch-info');
    const matchingBatches = batches.filter((candidate) => {
      if (!hasIdentity) return true;
      const text = textOf(candidate);
      return text.includes('SHOT_ID: ' + requestedShotId)
        && text.includes('REVISION_ID: ' + requestedRevisionId)
        && text.includes('RUN_ID: ' + requestedRunId);
    });
    const mediaIn = (root) => deepElements(root)
      .filter((node) => ['img', 'video', 'canvas'].includes(node.tagName.toLowerCase()) && visible(node))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const naturalWidth = node.naturalWidth || node.videoWidth || 0;
        return rect.width >= 160 && rect.height >= 90 && (naturalWidth >= 160 || node.tagName.toLowerCase() === 'canvas');
      }).length;
    // Flow keeps the prompt/actions in <flow-batch-info>, but renders the
    // generated image as a sibling inside the same .batch-container. Counting
    // media only inside flow-batch-info therefore reports 0 even when the
    // matching card visibly contains an image. Keep the identity match on the
    // batch-info node, then inspect only its owning batch container so stale
    // cards elsewhere in the virtual list cannot satisfy the current shot.
    const matchingBatchMediaCount = matchingBatches.reduce((sum, batch) => {
      const owner = batch.closest('.batch-container') || batch.parentElement;
      return sum + (owner ? mediaIn(owner) : 0);
    }, 0);
    const generatedPattern = /(?:i['’]?ve generated|i generated|đã tạo|đã hoàn tất|generated a .*image|generated .*shot)/i;
    const generatedMessageCount = deepElements(document)
      .filter((node) => node.tagName.toLowerCase() === 'flow-a2ui-text')
      .filter((node) => generatedPattern.test(textOf(node))).length;
    const assistantClaimsGenerated = generatedMessageCount > 0 || generatedPattern.test(bodyText);
    const activeGenerationControlFound = deepElements(document)
      .filter((node) => ['button', 'a'].includes(node.tagName.toLowerCase()) || node.getAttribute('role') === 'button')
      .some((node) => visible(node) && /^(stop|cancel|dừng|hủy)$/i.test(textOf(node) || node.getAttribute('aria-label') || node.getAttribute('title') || ''));
    // Page-wide text is not evidence: the prompt and history often say
    // "creating" after the job has finished. Require a visible stop/cancel
    // control or an explicit live-status node instead.
    const activeStatusFound = deepElements(document)
      .filter((node) => visible(node) && ['[aria-live]', '[role="status"]', '[aria-busy="true"]'].some((selector) => node.matches?.(selector)))
      .some((node) => /(?:thinking\.\.\.|generating\.\.\.|creating\.\.\.|đang suy nghĩ|đang tạo|đang xử lý)/i.test(textOf(node)));
    const generationActive = activeGenerationControlFound || activeStatusFound;
    const downloadControlFound = deepElements(document)
      .filter((node) => ['button', 'a'].includes(node.tagName.toLowerCase()) || node.getAttribute('role') === 'button')
      .some((node) => visible(node) && /download|save|export|tải xuống|lưu|xuất/i.test(textOf(node) + ' ' + (node.getAttribute('aria-label') || '') + ' ' + (node.getAttribute('title') || '')));
    return {
      mediaCount: media.length,
      media,
      mediaIds: [...new Set(media.map((item) => item.mediaId).filter(Boolean))],
      matchingBatchCount: matchingBatches.length,
      matchingBatchMediaCount: hasIdentity ? matchingBatchMediaCount : media.length,
      assistantClaimsGenerated,
      generatedMessageCount,
      generationActive,
      downloadControlFound,
    };
  })()`;
}

function inspectComposerExpression() {
  return `(() => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const roots = [];
    const collect = (root) => {
      if (!root || roots.includes(root)) return;
      roots.push(root);
      for (const node of root.querySelectorAll ? root.querySelectorAll('*') : []) {
        if (node.shadowRoot) collect(node.shadowRoot);
      }
    };
    collect(document);
    const findVisible = (selector) => roots.flatMap((root) => [...root.querySelectorAll(selector)]).find(visible);
    const editor = findVisible('flow-rich-text-editor.prompt-input div.ProseMirror[contenteditable="true"]');
    const composer = findVisible('flow-rich-text-editor.prompt-input');
    const modelPicker = findVisible('button[aria-label="Image generation default model"]');
    const generationControl = roots.flatMap((root) => [...root.querySelectorAll('button, [role="button"]')]).find((node) => {
      if (!visible(node)) return false;
      const label = (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
      return /^(?:start generation|generate image|tạo ảnh)$/i.test(label) || /start generation|generate image|tạo ảnh/i.test(label) && !/chat|assistant|video/i.test(label);
    });
    const generationButtonEnabled = Boolean(generationControl && !generationControl.disabled && generationControl.getAttribute('aria-disabled') !== 'true');
    const bodyText = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
    return {
      composerFound: Boolean(editor || composer),
      promptEditorFound: Boolean(editor),
      generateButtonFound: Boolean(generationControl),
      generateButtonEnabled: generationButtonEnabled,
      imageModeFound: Boolean(modelPicker || (editor && generationControl) || /Nano Banana|What do you want to create|Bạn muốn thay đổi gì/i.test(bodyText)),
      modelPickerFound: Boolean(modelPicker),
      editorTextLength: editor ? (editor.innerText || '').trim().length : 0,
    };
  })()`;
}

function clickImageBatchExpression(shotId, revisionId, runId) {
  const shotToken = JSON.stringify(shotId);
  const revisionToken = JSON.stringify(revisionId);
  const runToken = JSON.stringify(runId);
  return `(() => {
    const shotId = ${shotToken};
    const revisionId = ${revisionToken};
    const runId = ${runToken};
    const deepElements = (root) => {
      const elements = [];
      const seenRoots = new Set();
      const visit = (scope) => {
        if (!scope || seenRoots.has(scope)) return;
        seenRoots.add(scope);
        if (scope.shadowRoot) visit(scope.shadowRoot);
        for (const node of scope.querySelectorAll ? scope.querySelectorAll('*') : []) {
          elements.push(node);
          if (node.shadowRoot) visit(node.shadowRoot);
        }
      };
      visit(root);
      return elements;
    };
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const textOf = (node) => {
      const parts = [(node.innerText || node.textContent || '')];
      for (const child of deepElements(node.shadowRoot)) parts.push(child.innerText || child.textContent || '');
      return parts.join(' ').replace(/\\s+/g, ' ').trim();
    };
    const all = deepElements(document);
    const batches = all.filter((node) => node.tagName.toLowerCase() === 'flow-batch-info');
    const batch = batches.find((candidate) => {
      const text = textOf(candidate);
      return text.includes('SHOT_ID: ' + shotId) && text.includes('REVISION_ID: ' + revisionId) && text.includes('RUN_ID: ' + runId);
    });
    if (!batch) return { found: false, clicked: false, reason: 'Không tìm thấy batch đúng shot/revision/run hiện tại trong DOM Flow.' };
    const button = deepElements(batch)
      .filter((node) => node.tagName.toLowerCase() === 'button' || node.getAttribute('role') === 'button')
      .find((candidate) => visible(candidate) && /download|save|export|tải xuống|lưu|xuất/i.test(
        textOf(candidate) + ' ' + (candidate.getAttribute('aria-label') || '') + ' ' + (candidate.getAttribute('title') || '')
      ));
    if (!button) return { found: true, clicked: false, reason: 'Batch đúng shot/revision chưa có nút Download batch hiển thị.' };
    button.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = button.getBoundingClientRect();
    if (!visible(button)) return { found: true, clicked: false, reason: 'Nút Download batch không còn hiển thị sau khi đưa vào viewport.' };
    return {
      found: true,
      clicked: false,
      batchText: textOf(batch).slice(0, 1200),
      buttonLabel: (button.getAttribute('aria-label') || button.getAttribute('title') || textOf(button)).slice(0, 160),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  })()`;
}

function openImageModelPickerExpression() {
  return `(() => {
    const textOf = (node) => (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
    const picker = document.querySelector('button[aria-label="Image generation default model"]');
    if (!picker) return { found: false, opened: false, currentModel: '', reason: 'Không tìm thấy picker model ảnh trong Agent settings.' };
    return {
      found: true,
      opened: picker.getAttribute('aria-expanded') === 'true',
      currentModel: textOf(picker),
    };
  })()`;
}

function visibleRectExpression(kind, model = '') {
  const modelToken = JSON.stringify(model);
  return `(() => {
    const kind = ${JSON.stringify(kind)};
    const model = ${modelToken};
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const textOf = (node) => String(node.innerText || node.textContent || '')
      .split(/\\s+/)
      .filter(Boolean)
      .join(' ')
      .trim();
    let node = null;
    if (kind === 'settings') {
      node = [...document.querySelectorAll('button[aria-label="Settings"]')].find(visible);
    } else if (kind === 'back') {
      node = [...document.querySelectorAll('button[aria-label="Back"]')].find(visible);
    } else if (kind === 'picker') {
      node = [...document.querySelectorAll('button[aria-label="Image generation default model"]')].find(visible);
    } else if (kind === 'model') {
      const expected = ('🍌 ' + model).toLowerCase();
      node = [...document.querySelectorAll('button[role="menuitem"]')]
        .find((candidate) => visible(candidate) && textOf(candidate).toLowerCase() === expected);
    } else if (kind === 'save') {
      node = [...document.querySelectorAll('button')]
        .find((candidate) => visible(candidate) && textOf(candidate).toLowerCase() === 'save');
    } else if (kind === 'batch') {
      const picker = [...document.querySelectorAll('button[aria-label="Image generation default model"]')].find(visible);
      const pickerTop = picker ? picker.getBoundingClientRect().top : Number.POSITIVE_INFINITY;
      node = [...document.querySelectorAll('button')]
        .find((candidate) => visible(candidate)
          && /^x1$/i.test(textOf(candidate))
          && candidate.getBoundingClientRect().top < pickerTop);
    }
    if (!node) return { found: false, kind };
    const rect = node.getBoundingClientRect();
    return {
      found: true,
      kind,
      text: textOf(node),
      expanded: node.getAttribute('aria-expanded') === 'true',
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  })()`;
}

function verifyImageModelExpression() {
  return `(() => {
    const picker = document.querySelector('button[aria-label="Image generation default model"]');
    const text = picker ? (picker.innerText || picker.textContent || '').replace(/\\s+/g, ' ').trim() : '';
    return { found: Boolean(picker), selected: /Nano Banana Pro/i.test(text), text };
  })()`;
}

function verifyImageBatchExpression() {
  return `(() => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const textOf = (node) => (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
    const picker = [...document.querySelectorAll('button[aria-label="Image generation default model"]')].find(visible);
    const pickerTop = picker ? picker.getBoundingClientRect().top : Number.POSITIVE_INFINITY;
    const candidate = [...document.querySelectorAll('button')]
      .find((button) => visible(button) && /^x1$/i.test(textOf(button)) && button.getBoundingClientRect().top < pickerTop);
    const group = candidate?.parentElement;
    return {
      found: Boolean(candidate),
      selected: Boolean(group && /mat-button-toggle-checked|selected|active/i.test(String(group.className))),
      text: candidate ? textOf(candidate) : '',
    };
  })()`;
}

function selectImageModelExpression(model) {
  const modelToken = JSON.stringify(model);
  return `(() => {
    const model = ${modelToken};
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const textOf = (node) => (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
    const option = [...document.querySelectorAll('button[role="menuitem"]')]
      .find((candidate) => visible(candidate) && textOf(candidate).toLowerCase() === ('🍌 ' + model).toLowerCase());
    if (!option) return { selected: false, reason: 'Không thấy option model ảnh mục tiêu trong menu Flow.' };
    option.click();
    return { selected: true, model };
  })()`;
}

function saveImageModelSettingsExpression() {
  return `(() => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const textOf = (node) => (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
    const save = [...document.querySelectorAll('button')]
      .find((candidate) => visible(candidate) && textOf(candidate).toLowerCase() === 'save');
    if (!save) return { saved: false, reason: 'Không thấy nút Save trong Agent settings.' };
    save.click();
    return { saved: true };
  })()`;
}

async function writeReport(outputPath, report) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", { encoding: "utf8" });
}

async function main() {
  const specPath = resolve(required("--spec"));
  const outputPath = resolve(required("--output"));
  const spec = JSON.parse(await readFile(specPath, "utf8"));
  const projectUrl = safeProjectUrl(spec.projectUrl);
  const mode = String(spec.mode || "type_prompt");
  const prompt = mode === "type_prompt" ? safePrompt(spec.prompt) : "";
  const cdpUrl = String(spec.flowCdpUrl || "http://127.0.0.1:9222").replace(/\/$/, "");
  const serverEntry = resolve(String(spec.serverEntry));
  const WebSocketImplementation = loadWebSocket(serverEntry);
  const targets = await readJson(`${cdpUrl}/json/list`);
  const target = targets.find((candidate) => candidate.type === "page" && (candidate.url === projectUrl || candidate.url.startsWith(`${projectUrl}/`)));
  if (!target?.webSocketDebuggerUrl) throw new Error("Không tìm thấy đúng tab Flow project trong CDP");

  const client = new CdpClient(WebSocketImplementation, target.webSocketDebuggerUrl);
  try {
    if (mode === "inspect_composer") {
      const inspected = await client.request("Runtime.evaluate", { expression: inspectComposerExpression(), returnByValue: true });
      const value = inspected?.result?.value || {};
      const report = {
        schemaVersion: "1.0.0",
        status: value.composerFound && value.promptEditorFound && value.generateButtonFound ? "ready" : "blocked",
        operation: "dom_inspect_composer",
        projectUrl,
        targetUrl: target.url,
        composerFound: Boolean(value.composerFound),
        promptEditorFound: Boolean(value.promptEditorFound),
        generateButtonFound: Boolean(value.generateButtonFound),
        imageModeFound: Boolean(value.imageModeFound),
        modelPickerFound: Boolean(value.modelPickerFound),
        editorTextLength: value.editorTextLength || 0,
        message: value.composerFound && value.promptEditorFound && value.generateButtonFound
          ? "DOM Flow đã xác nhận image composer, editor prompt và control Generate thật; control có thể disabled khi prompt còn trống."
          : "DOM Flow chưa xác nhận đủ editor prompt image + control Generate thật; không gõ vào chat.",
      };
      await writeReport(outputPath, report);
      process.stdout.write(JSON.stringify({ status: report.status, operation: report.operation, composerFound: report.composerFound, promptEditorFound: report.promptEditorFound, outputPath }) + "\n");
      if (report.status !== "ready") process.exitCode = 2;
      return;
    }
    if (mode === "inspect_output") {
      const inspected = await client.request("Runtime.evaluate", { expression: inspectOutputExpression(spec.shotId, spec.revisionId, spec.runId), returnByValue: true });
      const value = inspected?.result?.value || {};
      const report = {
        schemaVersion: "1.0.0",
        status: value.assistantClaimsGenerated && value.mediaCount === 0 ? "blocked_text_only" : "ready",
        operation: "dom_inspect_output",
        projectUrl,
        targetUrl: target.url,
         mediaCount: value.mediaCount || 0,
         media: value.media || [],
         mediaIds: value.mediaIds || [],
         matchingBatchCount: value.matchingBatchCount || 0,
         matchingBatchMediaCount: value.matchingBatchMediaCount || 0,
         assistantClaimsGenerated: Boolean(value.assistantClaimsGenerated),
         generatedMessageCount: value.generatedMessageCount || 0,
         generationActive: Boolean(value.generationActive),
        downloadControlFound: Boolean(value.downloadControlFound),
        message: value.assistantClaimsGenerated && value.mediaCount === 0
          ? "Flow chỉ trả về văn bản assistant nói đã tạo ảnh nhưng DOM chưa có media output hoặc nút Download."
          : "Đã quét DOM output Google Flow.",
      };
      await writeReport(outputPath, report);
       process.stdout.write(JSON.stringify({ status: report.status, operation: report.operation, mediaCount: report.mediaCount, matchingBatchCount: report.matchingBatchCount, matchingBatchMediaCount: report.matchingBatchMediaCount, assistantClaimsGenerated: report.assistantClaimsGenerated, generationActive: report.generationActive, outputPath }) + "\\n");
      if (report.status === "blocked_text_only") process.exitCode = 2;
      return;
    }
    if (mode === "click_image_batch") {
      const shotId = String(spec.shotId || "").trim();
      const revisionId = String(spec.revisionId || "").trim();
      const runId = String(spec.runId || "").trim();
      if (!/^[A-Za-z0-9_-]{3,96}$/.test(shotId) || !/^[A-Za-z0-9_.-]{3,96}$/.test(revisionId) || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(runId)) {
        throw new Error("Shot/revision identity không hợp lệ");
      }
      const clicked = await client.request("Runtime.evaluate", { expression: clickImageBatchExpression(shotId, revisionId, runId), returnByValue: true });
      const value = clicked?.result?.value || {};
      if (!value.rect || !value.found) {
        const report = {
          schemaVersion: "1.0.0",
          status: "blocked",
          operation: "dom_locate_image_batch_download",
          projectUrl,
          targetUrl: target.url,
          shotId,
          revisionId,
          runId,
          downloadClicked: false,
          message: value.reason || "Flow chưa định vị được nút Download của đúng shot/revision.",
        };
        await writeReport(outputPath, report);
        process.stdout.write(JSON.stringify({ status: report.status, operation: report.operation, downloadClicked: false, outputPath }) + "\n");
        process.exitCode = 2;
        return;
      }
      // HTMLElement.click() can update Flow's UI without starting a browser
      // download. Use trusted CDP input so the site receives the same pointer
      // sequence as a human click; the caller still verifies the new file on
      // disk before importing it.
      await dispatchTrustedClick(client, value.rect);
      await new Promise((resolve) => setTimeout(resolve, 700));
      const report = {
        schemaVersion: "1.0.0",
        status: "ready",
        operation: "dom_click_image_batch_download",
        projectUrl,
        targetUrl: target.url,
        shotId,
        revisionId,
        runId,
        downloadClicked: true,
        clickMethod: "trusted_cdp_input",
        buttonLabel: value.buttonLabel || "",
        message: "Đã click chuột CDP thật vào Download batch của đúng shot/revision; đang chờ file mới trong Downloads.",
      };
      await writeReport(outputPath, report);
      process.stdout.write(JSON.stringify({ status: report.status, operation: report.operation, downloadClicked: report.downloadClicked, outputPath }) + "\\n");
      return;
    }
    if (mode === "select_image_model") {
      const model = String(spec.model || "").trim();
      if (model !== "Nano Banana Pro") throw new Error("Chỉ cho phép chọn Nano Banana Pro trong bước này");
      const opened = await client.request("Runtime.evaluate", { expression: openImageModelPickerExpression(), returnByValue: true });
      const openedValue = opened?.result?.value || {};
      if (!openedValue.found) {
        const settingsRectResult = await client.request("Runtime.evaluate", { expression: visibleRectExpression("settings"), returnByValue: true });
        const settingsRect = settingsRectResult?.result?.value?.rect;
        if (!settingsRect) throw new Error(openedValue.reason || "Không mở được Agent settings model picker");
        await dispatchTrustedClick(client, settingsRect);
        await new Promise((resolve) => setTimeout(resolve, 450));
      }
      const pickerStateResult = await client.request("Runtime.evaluate", { expression: openImageModelPickerExpression(), returnByValue: true });
      const pickerState = pickerStateResult?.result?.value || {};
      if (!pickerState.found) throw new Error(pickerState.reason || "Không mở được Agent settings model picker");
      let selected = Boolean(pickerState.currentModel && /Nano Banana Pro/i.test(pickerState.currentModel));
      if (!selected) {
        const pickerRectResult = await client.request("Runtime.evaluate", { expression: visibleRectExpression("picker"), returnByValue: true });
        const pickerRectValue = pickerRectResult?.result?.value || {};
        if (!pickerRectValue.rect) throw new Error("Không lấy được vị trí picker model ảnh trong Agent settings");
        if (pickerRectValue.expanded !== true) {
          await dispatchTrustedClick(client, pickerRectValue.rect);
          await new Promise((resolve) => setTimeout(resolve, 450));
        }
        const optionRectResult = await client.request("Runtime.evaluate", { expression: visibleRectExpression("model", model), returnByValue: true });
        const optionRect = optionRectResult?.result?.value?.rect;
        if (!optionRect) throw new Error("Flow chưa mở menu model hoặc không thấy Nano Banana Pro");
        await dispatchTrustedClick(client, optionRect);
        await new Promise((resolve) => setTimeout(resolve, 450));
        const selectedState = await client.request("Runtime.evaluate", { expression: verifyImageModelExpression(), returnByValue: true });
        selected = Boolean(selectedState?.result?.value?.selected);
      }
      if (!selected) throw new Error("Flow chưa xác nhận đã chọn Nano Banana Pro");
      const batchRectResult = await client.request("Runtime.evaluate", { expression: visibleRectExpression("batch"), returnByValue: true });
      const batchRect = batchRectResult?.result?.value?.rect;
      if (!batchRect) throw new Error("Không thấy bộ chọn số lượng ảnh x1 trong Agent settings");
      await dispatchTrustedClick(client, batchRect);
      await new Promise((resolve) => setTimeout(resolve, 350));
      const batchVerification = await client.request("Runtime.evaluate", { expression: verifyImageBatchExpression(), returnByValue: true });
      const batchSelected = Boolean(batchVerification?.result?.value?.selected);
      if (!batchSelected) throw new Error("Flow chưa xác nhận chế độ x1; dừng để tránh tạo nhiều ảnh mỗi shot");
      const saveRectResult = await client.request("Runtime.evaluate", { expression: visibleRectExpression("save"), returnByValue: true });
      const saveRect = saveRectResult?.result?.value?.rect;
      if (!saveRect) throw new Error("Không thấy nút Save trong Agent settings");
      await dispatchTrustedClick(client, saveRect);
      await new Promise((resolve) => setTimeout(resolve, 600));
      const backRectResult = await client.request("Runtime.evaluate", { expression: visibleRectExpression("back"), returnByValue: true });
      const backRect = backRectResult?.result?.value?.rect;
      if (backRect) {
        await dispatchTrustedClick(client, backRect);
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      const saved = true;
      const report = {
        schemaVersion: "1.0.0",
        status: saved ? "ready" : "blocked",
        operation: "dom_select_image_model",
        projectUrl,
        targetUrl: target.url,
        selectedModel: model,
        modelSelected: selected,
        batchSelected: true,
        saved,
        message: "Đã chọn Nano Banana Pro, đặt số lượng ảnh x1, bấm Save và đóng Agent settings để hiện lại image composer bằng click chuột CDP thật.",
      };
      await writeReport(outputPath, report);
      process.stdout.write(JSON.stringify({ status: report.status, operation: report.operation, selectedModel: model, modelSelected: selected, saved, outputPath }) + "\\n");
      if (report.status !== "ready") process.exitCode = 2;
      return;
    }
    const focused = await client.request("Runtime.evaluate", { expression: promptEditorExpression(), returnByValue: true });
    const focusedValue = focused?.result?.value;
    if (!focusedValue?.found) throw new Error(focusedValue?.reason || "Flow prompt editor không khả dụng");
    await client.request("Input.insertText", { text: prompt });
    const verified = await client.request("Runtime.evaluate", { expression: verifyEditorExpression(), returnByValue: true });
    const verification = verified?.result?.value;
    const report = {
      schemaVersion: "1.0.0",
      status: verification?.accepted ? "ready" : "blocked",
      operation: "dom_type_prompt",
      projectUrl,
      targetUrl: target.url,
      editor: "flow-rich-text-editor.prompt-input > div.ProseMirror[contenteditable=true]",
      editorFound: Boolean(verification?.found),
      promptAccepted: Boolean(verification?.accepted),
      promptCharCount: verification?.charCount ?? 0,
      promptSha256: createHash("sha256").update(prompt, "utf8").digest("hex"),
      generateClicked: false,
      message: verification?.accepted ? "Đã nhập prompt vào đúng Flow image composer; chưa bấm Generate." : "Flow không xác nhận prompt sau khi nhập; chưa bấm Generate.",
    };
    await writeReport(outputPath, report);
    process.stdout.write(JSON.stringify({ status: report.status, operation: report.operation, editorFound: report.editorFound, promptAccepted: report.promptAccepted, outputPath }) + "\n");
    if (report.status !== "ready") process.exitCode = 2;
  } finally {
    client.close();
  }
}

main().catch(async (error) => {
  const outputPath = arg("--output");
  const report = { schemaVersion: "1.0.0", status: "blocked", operation: "dom_type_prompt", editorFound: false, promptAccepted: false, generateClicked: false, message: boundedError(error) };
  if (outputPath) await writeReport(resolve(outputPath), report);
  process.stderr.write(JSON.stringify(report) + "\n");
  process.exitCode = 2;
});
