import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

// GitHub BrowserOS exposes the local MCP proxy on 9000. BrowserOS neo can
// still be selected explicitly with AUTO3DVIDEO_BROWSEROS_MCP_ENDPOINT=9010.
const DEFAULT_ENDPOINT = "http://127.0.0.1:9000/mcp";
const REQUEST_TIMEOUT_MS = 45_000;
const FLOW_READY_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_SNAPSHOT_CHARS = 120_000;
const MAX_UI_REFS = 160;
const SECRET_MARKERS = [
  "api_key=",
  "apikey=",
  "access_token=",
  "authorization:",
  "bearer ",
  "client_secret=",
  "password=",
  "secret=",
  "token=",
];

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name) {
  const value = arg(name);
  if (!value) throw new Error(`Thiếu ${name}`);
  return value;
}

function safeText(value, field, max = 512) {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) {
    throw new Error(`${field} không hợp lệ`);
  }
  const lowered = value.toLowerCase();
  if (SECRET_MARKERS.some((marker) => lowered.includes(marker))) {
    throw new Error(`${field} có dấu hiệu credential`);
  }
  return value.trim();
}

function safeProjectUrl(value) {
  const parsed = new URL(safeText(value, "Google Flow project URL", 500));
  if (parsed.protocol !== "https:" || parsed.hostname !== "flow.google.com" || parsed.search || parsed.hash || parsed.port || parsed.username || parsed.password) {
    throw new Error("Google Flow project URL không hợp lệ");
  }
  if (!/^\/project\/[A-Za-z0-9-]+(?:\/.*)?$/.test(parsed.pathname)) {
    throw new Error("Google Flow project URL thiếu project id");
  }
  return `https://flow.google.com/project/${parsed.pathname.split("/")[2]}`;
}

function safeFlowUrl(value) {
  const parsed = new URL(safeText(value, "Google Flow URL", 500));
  if (parsed.protocol !== "https:" || parsed.hostname !== "flow.google.com" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
    throw new Error("Google Flow URL không hợp lệ");
  }
  return parsed.toString();
}

function safeId(value, field, pattern = /^[A-Za-z0-9_.:-]{3,120}$/) {
  const normalized = safeText(value, field, 140);
  if (!pattern.test(normalized)) throw new Error(`${field} không hợp lệ`);
  return normalized;
}

function safePrompt(value) {
  const normalized = safeText(value, "Flow prompt", 12_000).replace(/\r\n?/g, "\n");
  const lowered = normalized.toLowerCase();
  if (SECRET_MARKERS.some((marker) => lowered.includes(marker))) {
    throw new Error("Flow prompt có dấu hiệu credential");
  }
  return normalized;
}

function exactBatchDownloadCode(shotId, revisionId, runId) {
  const shotToken = JSON.stringify(shotId);
  const revisionToken = JSON.stringify(revisionId);
  const runToken = JSON.stringify(runId);
  return `return (() => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
    const deepElements = (root) => {
      const items = [...root.querySelectorAll('*')];
      for (const node of items) if (node.shadowRoot) items.push(...deepElements(node.shadowRoot));
      return items;
    };
    const shotId = ${shotToken};
    const revisionId = ${revisionToken};
    const runId = ${runToken};
    const batches = deepElements(document).filter((node) => node.tagName?.toLowerCase() === 'flow-batch-info');
    const batch = batches.find((candidate) => {
      const value = text(candidate);
      return value.includes('SHOT_ID: ' + shotId) && value.includes('REVISION_ID: ' + revisionId) && value.includes('RUN_ID: ' + runId);
    });
    if (!batch) return { found: false, clicked: false, reason: 'Không tìm thấy batch đúng shot/revision/run hiện tại trong DOM Flow.' };
    const button = deepElements(batch)
      .filter((node) => node.tagName?.toLowerCase() === 'button' || node.getAttribute?.('role') === 'button')
      .find((candidate) => visible(candidate) && /download|save|export|tải xuống|lưu|xuất/i.test(
        text(candidate) + ' ' + (candidate.getAttribute('aria-label') || '') + ' ' + (candidate.getAttribute('title') || '')
      ));
    if (!button) return { found: true, clicked: false, reason: 'Batch đúng shot/revision chưa có nút Download hiển thị.' };
    button.scrollIntoView({ block: 'center', inline: 'center' });
    if (!visible(button)) return { found: true, clicked: false, reason: 'Nút Download batch không còn hiển thị.' };
    button.click();
    return { found: true, clicked: true, clickMethod: 'browseros_dom_exact_batch', buttonLabel: (button.getAttribute('aria-label') || button.getAttribute('title') || text(button)).slice(0, 160) };
  })();`;
}

function exactMediaDownloadCode(mediaId) {
  const mediaToken = JSON.stringify(mediaId);
  return `return (() => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
    const deepElements = (root) => {
      const items = [...root.querySelectorAll('*')];
      for (const node of items) if (node.shadowRoot) items.push(...deepElements(node.shadowRoot));
      return items;
    };
    const mediaId = ${mediaToken};
    const mediaNodes = deepElements(document).filter((node) =>
      node.getAttribute?.('data-media-id') === mediaId || node.getAttribute?.('data-mediaid') === mediaId);
    const media = mediaNodes.find((node) => visible(node)) || mediaNodes[0];
    if (!media) return { found: false, clicked: false, reason: 'Không tìm thấy media ID mới trong DOM Flow.' };
    media.scrollIntoView?.({ block: 'center', inline: 'center' });
    const scopes = [];
    const root = media.getRootNode?.();
    if (root && root !== document) scopes.push(root);
    let scope = media;
    for (let level = 0; level < 8 && scope; level += 1, scope = scope.parentElement) scopes.push(scope);
    if (root?.host) {
      let host = root.host;
      for (let level = 0; level < 8 && host; level += 1, host = host.parentElement) scopes.push(host);
    }
    for (const scope of scopes) {
      const button = deepElements(scope)
        .filter((node) => node.tagName?.toLowerCase() === 'button' || node.getAttribute?.('role') === 'button')
        .find((candidate) => visible(candidate) && /download|save|export|tải xuống|lưu|xuất/i.test(
          text(candidate) + ' ' + (candidate.getAttribute('aria-label') || '') + ' ' + (candidate.getAttribute('title') || '')
        ));
      if (!button) continue;
      button.scrollIntoView({ block: 'center', inline: 'center' });
      if (!visible(button)) continue;
      button.click();
      return { found: true, clicked: true, clickMethod: 'browseros_dom_exact_media_id', buttonLabel: (button.getAttribute('aria-label') || button.getAttribute('title') || text(button)).slice(0, 160) };
    }
    const debug = scopes.slice(0, 20).map((candidate) => ({
      tag: candidate?.tagName || candidate?.nodeName || '',
      className: String(candidate?.className || '').slice(0, 120),
      buttons: deepElements(candidate).filter((node) => node.tagName?.toLowerCase() === 'button' || node.getAttribute?.('role') === 'button')
        .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || text(node)).trim()).filter(Boolean).slice(0, 12),
    }));
    return { found: true, clicked: false, reason: 'Media ID đúng nhưng chưa tìm thấy Download trong card chứa media. debug=' + JSON.stringify(debug).slice(0, 1800) };
  })();`;
}

function exactMediaOptionsCode(mediaId) {
  const mediaToken = JSON.stringify(mediaId);
  return `return (() => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
    const deepElements = (root) => {
      const items = [...root.querySelectorAll('*')];
      for (const node of items) if (node.shadowRoot) items.push(...deepElements(node.shadowRoot));
      return items;
    };
    const mediaId = ${mediaToken};
    const mediaNodes = deepElements(document).filter((node) =>
      node.getAttribute?.('data-media-id') === mediaId || node.getAttribute?.('data-mediaid') === mediaId);
    const media = mediaNodes.find((node) => visible(node)) || mediaNodes[0];
    if (!media) return { found: false, clicked: false, reason: 'Không tìm thấy media ID mới để mở More options.' };
    media.scrollIntoView?.({ block: 'center', inline: 'center' });
    const mediaRect = media.getBoundingClientRect();
    let scope = media;
    for (let level = 0; level < 8 && scope; level += 1, scope = scope.parentElement) {
      const button = deepElements(scope)
        .filter((node) => node.tagName?.toLowerCase() === 'button' || node.getAttribute?.('role') === 'button')
        .find((candidate) => visible(candidate) && /more options|tùy chọn khác|thêm tùy chọn/i.test(
          text(candidate) + ' ' + (candidate.getAttribute('aria-label') || '') + ' ' + (candidate.getAttribute('title') || '')
        ));
      if (!button) continue;
      button.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = button.getBoundingClientRect();
      return { found: true, clicked: false, needsClick: true, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, mediaRect: { x: mediaRect.x, y: mediaRect.y, width: mediaRect.width, height: mediaRect.height }, clickMethod: 'browseros_coordinate_exact_media_more_options' };
    }
    return { found: true, clicked: false, needsHover: true, rect: { x: mediaRect.x, y: mediaRect.y, width: mediaRect.width, height: mediaRect.height }, reason: 'More options của card chỉ hiện khi hover media.' };
  })();`;
}

function exactMediaMenuDownloadCode() {
  return `return (() => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
    const deepElements = (root) => {
      const items = [...root.querySelectorAll('*')];
      for (const node of items) if (node.shadowRoot) items.push(...deepElements(node.shadowRoot));
      return items;
    };
    const menuItems = deepElements(document).filter((node) => visible(node)
      && (node.getAttribute?.('role') === 'menuitem' || node.tagName?.toLowerCase() === 'mat-menu-item')
      && /download|save|export|tải xuống|lưu|xuất/i.test(text(node) + ' ' + (node.getAttribute('aria-label') || '') + ' ' + (node.getAttribute('title') || '')));
    const item = menuItems[0];
    if (!item) return { found: false, clicked: false, reason: 'Menu More options vừa mở nhưng chưa có menuitem Download.' };
    item.click();
    return { found: true, clicked: true, clickMethod: 'browseros_dom_exact_media_context_menu', buttonLabel: text(item).slice(0, 160) };
  })();`;
}

function exactMediaMenuAnimateCode() {
  return `return (() => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
    const deepElements = (root) => {
      const items = [...root.querySelectorAll('*')];
      for (const node of items) if (node.shadowRoot) items.push(...deepElements(node.shadowRoot));
      return items;
    };
    const menuItems = deepElements(document).filter((node) => visible(node)
      && (node.getAttribute?.('role') === 'menuitem' || node.tagName?.toLowerCase() === 'mat-menu-item')
      && /^animate$/i.test(text(node)));
    const item = menuItems[0];
    if (!item) return { found: false, clicked: false, reason: 'Flow menu Animate is not visible.' };
    item.click();
    return { found: true, clicked: true, clickMethod: 'browseros_dom_exact_media_animate', buttonLabel: text(item).slice(0, 160) };
  })();`;
}

function animateIngredientStateCode(mediaId) {
  const mediaToken = JSON.stringify(mediaId);
  return `return (() => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const roots = [];
    const visit = (root) => {
      if (!root || roots.includes(root)) return;
      roots.push(root);
      for (const node of root.querySelectorAll ? root.querySelectorAll('*') : []) {
        if (node.shadowRoot) visit(node.shadowRoot);
      }
    };
    visit(document);
    const all = roots.flatMap((root) => [...(root.querySelectorAll ? root.querySelectorAll('*') : [])]);
    const mediaId = ${mediaToken};
    const editor = all.find((node) => visible(node) && node.matches?.('[contenteditable="true"]'));
    const chips = all.filter((node) => visible(node) && node.matches?.('flow-image-ingredient-chip'));
    const chip = chips[0] || null;
    const image = chip ? ([chip, ...all.filter((node) => chip.contains?.(node))].find((node) => node.tagName?.toLowerCase() === 'img') || null) : null;
    const source = String(image?.currentSrc || image?.src || '');
    const sourceMediaId = String(image?.getAttribute?.('data-media-id') || image?.getAttribute?.('data-mediaid') || chip?.getAttribute?.('data-media-id') || chip?.getAttribute?.('data-mediaid') || '');
    const referenceAttached = Boolean(chip && ((source && mediaId && source.includes(mediaId)) || (sourceMediaId && sourceMediaId === mediaId)));
    return {
      editorFound: Boolean(editor),
      ingredientCount: chips.length,
      referenceAttached,
      sourceMediaId: sourceMediaId || (referenceAttached ? mediaId : null),
      chipSource: source.slice(0, 1200),
    };
  })();`;
}

function exactMediaAssetCode(mediaId) {
  const mediaToken = JSON.stringify(mediaId);
  return `return (() => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const deepElements = (root) => {
      const items = [...root.querySelectorAll('*')];
      for (const node of items) if (node.shadowRoot) items.push(...deepElements(node.shadowRoot));
      return items;
    };
    const mediaId = ${mediaToken};
    const mediaNodes = deepElements(document).filter((node) =>
      node.getAttribute?.('data-media-id') === mediaId || node.getAttribute?.('data-mediaid') === mediaId);
    const media = mediaNodes.find((node) => visible(node)) || mediaNodes[0];
    if (!media) return { found: false, reason: 'Không tìm thấy media ID mới để đọc asset.' };
    media.scrollIntoView?.({ block: 'center', inline: 'center' });
    const image = media.matches?.('img') ? media : deepElements(media).find((node) => visible(node) && node.tagName?.toLowerCase() === 'img');
    const source = image?.currentSrc || image?.src || '';
    if (!source || (!source.startsWith('https://') && !source.startsWith('blob:') && !source.startsWith('data:'))) return { found: true, reason: 'Media đúng nhưng không có src ảnh hợp lệ.' };
    if (image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        const match = dataUrl.match(/^data:image\\/png;base64,(.+)$/);
        if (match) return { found: true, mime: 'image/png', base64: match[1], sourceKind: 'canvas' };
      } catch (_) { /* reject tainted or incomplete pixels */ }
    }
    if (source.startsWith('data:')) {
      const match = source.match(/^data:([^;,]+);base64,(.+)$/);
      return match ? { found: true, mime: match[1], base64: match[2] } : { found: true, reason: 'Data URL ảnh không hợp lệ.' };
    }
    return { found: true, reason: 'Media đúng ID chưa đọc được pixels trực tiếp từ canvas.' };
  })();`;
}

function mediaByShotLabelCode(shotId, revisionId) {
  const shotToken = JSON.stringify(shotId);
  const revisionToken = JSON.stringify(revisionId);
  return `return (() => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
    const deepElements = (root) => {
      const items = [...root.querySelectorAll('*')];
      for (const node of items) if (node.shadowRoot) items.push(...deepElements(node.shadowRoot));
      return items;
    };
    const requestedShot = ${shotToken};
    const requestedRevision = ${revisionToken};
    const shotNumber = String(requestedShot).match(/(\\d+)$/)?.[1]?.replace(/^0+/, '') || '';
    const shotPattern = shotNumber ? new RegExp('(?:^|\\\\s)(?:shot(?:_|\\\\s|-)*0*' + shotNumber + ')(?:\\\\s|[.:,]|$)', 'i') : null;
    const mediaNodes = deepElements(document).filter((node) => {
      const tag = node.tagName?.toLowerCase();
      return visible(node) && (tag === 'img' || tag === 'video') && (node.getAttribute('data-media-id') || node.getAttribute('data-mediaid'));
    });
    const candidates = [];
    for (const media of mediaNodes) {
      let current = media;
      let context = '';
      let exactRevision = false;
      let shotMatch = false;
      for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
        const value = text(current);
        if (!value) continue;
        if (!context || value.length < context.length) context = value;
        if (requestedRevision && value.includes(requestedRevision)) exactRevision = true;
        if (value.includes(requestedShot) || (shotPattern && shotPattern.test(value))) shotMatch = true;
        if (shotMatch && (exactRevision || !requestedRevision)) break;
      }
      if (shotMatch) {
        const mediaId = media.getAttribute('data-media-id') || media.getAttribute('data-mediaid') || '';
        candidates.push({ media, mediaId, context: context.slice(0, 1400), exactRevision });
      }
    }
    const unique = [...new Map(candidates.map((item) => [item.mediaId, item])).values()];
    // Prefer an exact revision match when Flow keeps several historical cards
    // for the same shot visible. Fall back to the unique shot label only when
    // the old card does not expose its revision in the DOM.
    const revisionMatches = unique.filter((item) => item.exactRevision);
    const scoped = revisionMatches.length ? revisionMatches : unique;
    if (scoped.length !== 1) return {
      found: false,
      candidateCount: scoped.length,
      reason: scoped.length > 1
        ? 'Flow có nhiều media mang cùng nhãn shot; không tự chọn nhầm.'
        : 'Không tìm thấy media đang hiển thị theo nhãn shot trong detail/card Flow.'
    };
    const item = scoped[0];
    item.media.scrollIntoView?.({ block: 'center', inline: 'center' });
    const rect = item.media.getBoundingClientRect();
    return {
      found: true,
      mediaId: item.mediaId,
      exactRevision: item.exactRevision,
      context: item.context,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    };
  })();`;
}

function parseSse(text, id) {
  const plain = String(text).trim();
  if (plain.startsWith("{") || plain.startsWith("[")) {
    try {
      const response = JSON.parse(plain);
      if (response?.id === id || response?.result || response?.error) {
        if (response.error) throw new Error(`BrowserOS MCP ${response.error.code ?? "error"}: ${String(response.error.message || "request failed").slice(0, 900)}`);
        return response.result ?? response;
      }
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("BrowserOS MCP không trả JSON-RPC response");
      throw error;
    }
  }
  const responses = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try { responses.push(JSON.parse(payload)); } catch { /* keepalive */ }
  }
  const response = responses.find((item) => item?.id === id) || responses.at(-1);
  if (!response) throw new Error("BrowserOS MCP không trả JSON-RPC response");
  if (response.error) throw new Error(`BrowserOS MCP ${response.error.code ?? "error"}: ${String(response.error.message || "request failed").slice(0, 900)}`);
  return response.result ?? response;
}

function contentText(result) {
  return (Array.isArray(result?.content) ? result.content : [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function extractJson(text) {
  const start = String(text).indexOf("{");
  const end = String(text).lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`BrowserOS evaluate không trả JSON: ${String(text).slice(0, 900)}`);
  try {
    return JSON.parse(String(text).slice(start, end + 1));
  } catch (error) {
    throw new Error(`BrowserOS evaluate JSON không parse được: ${String(error?.message || error).slice(0, 240)}`);
  }
}

function parsePageId(text) {
  const match = String(text).match(/opened page (\d+)/i);
  if (!match) throw new Error("BrowserOS không trả page id");
  return Number(match[1]);
}

function extractUiRefs(text) {
  const refs = [];
  const seen = new Set();
  for (const line of String(text).slice(0, MAX_SNAPSHOT_CHARS).split(/\r?\n/)) {
    const refMatch = line.match(/\[ref=([^\]]+)\]/);
    if (!refMatch) continue;
    const reference = refMatch[1].trim();
    if (!reference || seen.has(reference)) continue;
    const before = line.slice(0, refMatch.index).trim().replace(/^[-*]\s*/, "");
    const role = before.split(/\s+/, 1)[0] || "element";
    const quoted = before.match(/"([^"]*)"|“([^”]*)”/);
    const label = (quoted?.[1] ?? quoted?.[2] ?? before.replace(/^\w+\s*/, "") ?? role).trim().slice(0, 180);
    refs.push({ role, label: label || role, reference });
    seen.add(reference);
  }
  return refs.slice(0, MAX_UI_REFS);
}

function textMatches(label, patterns) {
  const value = String(label || "").toLowerCase();
  return patterns.some((pattern) => value.includes(pattern));
}

function pickRef(refs, predicate, description) {
  const matches = refs.filter(predicate);
  if (!matches.length) throw new Error(`Không tìm thấy ${description} trong snapshot BrowserOS`);
  return matches[0];
}

const inspectComposerCode = String.raw`
return (() => {
  const visible = (node) => {
    if (!node) return false;
    const r = node.getBoundingClientRect();
    const s = getComputedStyle(node);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  };
  const roots = [];
  const visit = (root) => {
    if (!root || roots.includes(root)) return;
    roots.push(root);
    for (const node of root.querySelectorAll ? root.querySelectorAll('*') : []) {
      if (node.shadowRoot) visit(node.shadowRoot);
    }
  };
  visit(document);
  const all = roots.flatMap((root) => [...(root.querySelectorAll ? root.querySelectorAll('*') : [])]);
  const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const editor = all.find((node) => visible(node) && node.matches?.('flow-rich-text-editor.prompt-input div.ProseMirror[contenteditable="true"]'))
    || all.find((node) => visible(node) && node.matches?.('[contenteditable="true"]') && /what do you want to (create|change)|bạn muốn/i.test(text(node) + ' ' + (node.getAttribute('aria-label') || '')));
  const controlText = (node) => [text(node), node?.getAttribute?.('aria-label') || '', node?.getAttribute?.('title') || ''].join(' ').replace(/\s+/g, ' ').trim();
  const controls = all.filter((node) => visible(node) && (node.matches?.('button,[role="button"], [aria-label], [title]')));
  const exactImageEditor = Boolean(editor && editor.matches?.('flow-rich-text-editor.prompt-input div.ProseMirror[contenteditable="true"]'));
  const settingsTrigger = controls.find((node) => {
    const value = controlText(node).toLowerCase();
    const aria = String(node.getAttribute?.('aria-label') || '').toLowerCase();
    return aria.includes('settings trigger') || value.includes('agent settings') || aria === 'settings' || value === 'settings';
  });
  const picker = controls.find((node) => node.matches?.('button[aria-label="Image generation default model"], [role="button"][aria-label="Image generation default model"]'))
    || controls.find((node) => /image generation default model/i.test(controlText(node)))
    || controls.find((node) => /nano banana(?:\s+pro|\s+2|\s+2\s+lite)?/i.test(controlText(node)));
  const selectedModel = controlText(picker);
  return {
    composerFound: Boolean(editor || picker),
    promptEditorFound: Boolean(editor),
    exactImageEditorFound: exactImageEditor,
    settingsTriggerFound: Boolean(settingsTrigger),
    // The model picker is rendered only while Agent settings is open. The
    // exact Flow image editor plus its Settings trigger is equally strong
    // route evidence and lets the model gate open the panel before checking
    // Nano Banana Pro. A generic chat editor still fails this test.
    imageModeFound: Boolean(picker || (exactImageEditor && settingsTrigger)),
    selectedModel: selectedModel.slice(0, 240),
    promptText: editor ? text(editor).slice(0, 12_000) : '',
  };
})();`;

const imageModelDomStateCode = String.raw`
return (() => {
  const visible = (node) => {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const roots = [];
  const visit = (root) => {
    if (!root || roots.includes(root)) return;
    roots.push(root);
    for (const node of root.querySelectorAll ? root.querySelectorAll('*') : []) {
      if (node.shadowRoot) visit(node.shadowRoot);
    }
  };
  visit(document);
  const all = roots.flatMap((root) => [...(root.querySelectorAll ? root.querySelectorAll('*') : [])]);
  const controls = all.filter((node) => visible(node) && (
    node.matches?.('button,[role="button"],[role="combobox"]')
    || node.hasAttribute?.('aria-label')
    || node.hasAttribute?.('title')
  ));
  const controlText = (node) => [text(node), node?.getAttribute?.('aria-label') || '', node?.getAttribute?.('title') || '']
    .join(' ').replace(/\s+/g, ' ').trim();
  const picker = controls.find((node) => /image generation default model/i.test(controlText(node)))
    || controls.find((node) => /nano banana(?:\s+pro|\s+2|\s+2\s+lite)?/i.test(controlText(node)))
    || controls.find((node) => /image\s+model/i.test(controlText(node)));
  const settings = controls
    .map((node) => {
      const value = controlText(node).toLowerCase();
      const aria = String(node.getAttribute?.('aria-label') || '').toLowerCase();
      const score = aria.includes('settings trigger') || value.includes('agent settings')
        ? 100
        : aria === 'settings' || value === 'settings' ? 20 : 0;
      return { node, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.node;
  const describe = (node) => node ? {
    text: controlText(node).slice(0, 240),
    expanded: node.getAttribute?.('aria-expanded') === 'true',
    role: node.getAttribute?.('role') || node.tagName?.toLowerCase() || '',
  } : null;
  return {
    pickerFound: Boolean(picker),
    picker: describe(picker),
    settingsFound: Boolean(settings),
    settings: describe(settings),
  };
})();`;

function imageModelDomActionCode(kind, model = "Nano Banana Pro") {
  const modelToken = JSON.stringify(model);
  return String.raw`
return (() => {
  const kind = ${JSON.stringify(kind)};
  const model = ${modelToken};
  const visible = (node) => {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const roots = [];
  const visit = (root) => {
    if (!root || roots.includes(root)) return;
    roots.push(root);
    for (const node of root.querySelectorAll ? root.querySelectorAll('*') : []) {
      if (node.shadowRoot) visit(node.shadowRoot);
    }
  };
  visit(document);
  const all = roots.flatMap((root) => [...(root.querySelectorAll ? root.querySelectorAll('*') : [])]);
  const controls = all.filter((node) => visible(node) && (
    node.matches?.('button,[role="button"],[role="combobox"]')
    || node.hasAttribute?.('aria-label')
    || node.hasAttribute?.('title')
  ));
  const controlText = (node) => [text(node), node?.getAttribute?.('aria-label') || '', node?.getAttribute?.('title') || '']
    .join(' ').replace(/\s+/g, ' ').trim();
  const picker = controls.find((node) => /image generation default model/i.test(controlText(node)))
    || controls.find((node) => /nano banana(?:\s+pro|\s+2|\s+2\s+lite)?/i.test(controlText(node)))
    || controls.find((node) => /image\s+model/i.test(controlText(node)));
  const settings = controls
    .map((node) => {
      const value = controlText(node).toLowerCase();
      const aria = String(node.getAttribute?.('aria-label') || '').toLowerCase();
      const score = aria.includes('settings trigger') || value.includes('agent settings')
        ? 100
        : aria === 'settings' || value === 'settings' ? 20 : 0;
      return { node, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.node;
  const option = [...all].find((node) => visible(node)
    && (node.matches?.('button[role="menuitem"],[role="menuitem"]'))
    && text(node).toLowerCase().includes(model.toLowerCase()));
  const batch = [...all].find((node) => visible(node)
    && node.matches?.('button,[role="button"]')
    && /^x1$/i.test(text(node)));
  // Flow's Save button can contain an icon, a hidden label, or extra
  // whitespace in the live DOM. An exact text match made a visible, enabled
  // Save button look absent to BrowserOS even though Agent settings was open.
  // Keep the match scoped to button-like controls and prefer an exact label
  // before accepting a label that contains Save/Lưu.
  const saveControls = [...all].filter((node) => visible(node)
    && node.matches?.('button,[role="button"]')
    && /(?:^|\s)(save|lưu)(?:\s|$)/i.test(controlText(node)));
  const save = saveControls.find((node) => /^(save|lưu)$/i.test(text(node)))
    || saveControls[0];
  const target = kind === 'settings' ? settings
    : kind === 'picker' ? picker
    : kind === 'model' ? option
    : kind === 'batch' ? batch
    : kind === 'save' ? save
    : null;
  if (kind === 'verify') {
    return { found: Boolean(picker), selected: Boolean(picker && /Nano Banana Pro/i.test(controlText(picker))), text: picker ? controlText(picker).slice(0, 240) : '' };
  }
  if (!target) return { found: false, clicked: false, kind, reason: 'DOM không tìm thấy control Flow an toàn cho bước này.' };
  target.scrollIntoView({ block: 'center', inline: 'center' });
  target.click();
  return { found: true, clicked: true, kind, text: controlText(target).slice(0, 240) };
})();`;
}

const inspectOutputCode = (shotId, revisionId, runId) => String.raw`
return (() => {
  const requestedShot = ${JSON.stringify(shotId || "")};
  const requestedRevision = ${JSON.stringify(revisionId || "")};
  const requestedRun = ${JSON.stringify(runId || "")};
  const visible = (node) => {
    if (!node) return false;
    const r = node.getBoundingClientRect();
    const s = getComputedStyle(node);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  };
  const roots = [];
  const visit = (root) => {
    if (!root || roots.includes(root)) return;
    roots.push(root);
    for (const node of root.querySelectorAll ? root.querySelectorAll('*') : []) if (node.shadowRoot) visit(node.shadowRoot);
  };
  visit(document);
  const all = roots.flatMap((root) => [...(root.querySelectorAll ? root.querySelectorAll('*') : [])]);
  const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const shotNumber = String(requestedShot).match(/(\d+)$/)?.[1]?.replace(/^0+/, '') || '';
  const shotLabelPattern = shotNumber
    ? new RegExp('(?:^|\\s)(?:shot(?:_|\\s|-)*0*' + shotNumber + ')(?:\\s|[.:,]|$)', 'i')
    : null;
  const mediaNodes = all.filter((node) => visible(node) && (node.tagName?.toLowerCase() === 'img' || node.tagName?.toLowerCase() === 'video'));
  const media = mediaNodes
    .map((node) => ({
      mediaId: node.getAttribute('data-media-id') || node.getAttribute('data-mediaid') || '',
      width: Math.round(node.getBoundingClientRect().width),
      height: Math.round(node.getBoundingClientRect().height),
      tag: node.tagName.toLowerCase(),
    }))
    .filter((item) => item.mediaId || item.width > 80 || item.height > 80);
  const mediaContext = (node) => {
    const contexts = [];
    let current = node;
    for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
      const value = text(current);
      if (value) contexts.push(value);
    }
    const identityContext = contexts.find((value) => /SHOT[-_ ]?\d{3}/i.test(value) && /REV(?:ISION)?[-_ ]?\d{3}/i.test(value));
    const shotContext = contexts.find((value) => /SHOT[-_ ]?\d{3}/i.test(value) || (shotLabelPattern && shotLabelPattern.test(value)));
    return (identityContext || shotContext || contexts[0] || '').slice(0, 1400);
  };
  const mediaWithContext = mediaNodes
    .map((node) => ({ mediaId: node.getAttribute('data-media-id') || node.getAttribute('data-mediaid') || '', context: mediaContext(node) }))
    .filter((item) => item.mediaId);
  // Prefer exact SHOT_ID/REVISION_ID metadata. Older Flow cards often show
  // only a human label such as “Shot 5”; use that only as a unique fallback.
  const exactHistoricalIds = requestedShot && requestedRevision
    ? [...new Set(mediaWithContext
      .filter((item) => item.context.includes(requestedShot) && item.context.includes(requestedRevision) && (!requestedRun || !item.context.includes(requestedRun)))
      .map((item) => item.mediaId))]
    : [];
  const shotLabelHistoricalIds = requestedShot
    ? [...new Set(mediaWithContext
      .filter((item) => (item.context.includes(requestedShot) || (shotLabelPattern && shotLabelPattern.test(item.context))) && (!requestedRun || !item.context.includes(requestedRun)))
      .map((item) => item.mediaId))]
    : [];
  const historicalShotMediaIds = exactHistoricalIds.length > 0 ? exactHistoricalIds : shotLabelHistoricalIds;
  const batches = all.filter((node) => node.tagName?.toLowerCase() === 'flow-batch-info');
  const matching = batches.filter((node) => {
    const value = text(node);
    return (!requestedShot || value.includes(requestedShot)) && (!requestedRevision || value.includes(requestedRevision)) && (!requestedRun || value.includes(requestedRun));
  });
  const mediaIn = (root) => {
    const owner = root?.closest?.('.batch-container') || root?.parentElement;
    return all.filter((node) => owner && owner.contains(node) && (node.tagName?.toLowerCase() === 'img' || node.tagName?.toLowerCase() === 'video') && visible(node));
  };
  const matchingMedia = matching.flatMap(mediaIn);
  const matchingBatchMediaIds = [...new Set(matchingMedia
    .map((node) => node.getAttribute('data-media-id') || node.getAttribute('data-mediaid') || '')
    .filter(Boolean))];
  const matchingBatchMediaCount = matchingBatchMediaIds.length > 0 ? matchingBatchMediaIds.length : matchingMedia.length;
  const shotRevisionMatching = batches.filter((node) => {
    const value = text(node);
    return (!requestedShot || value.includes(requestedShot)) && (!requestedRevision || value.includes(requestedRevision));
  });
  const shotRevisionMedia = shotRevisionMatching.flatMap(mediaIn);
  const shotRevisionBatchMediaIds = [...new Set(shotRevisionMedia
    .map((node) => node.getAttribute('data-media-id') || node.getAttribute('data-mediaid') || '')
    .filter(Boolean))];
  const shotRevisionBatchMediaCount = shotRevisionBatchMediaIds.length > 0 ? shotRevisionBatchMediaIds.length : shotRevisionMedia.length;
  const bodyText = text(document.body);
  const generatedMessageCount = all.filter((node) => visible(node) && /(?:i['’]?ve generated|i generated|đã tạo|generated .*image|generated .*shot)/i.test(text(node))).length;
  // Do not scan the whole page body for "creating"/"generating": Flow's
  // prompt, history cards and assistant copy contain those words even when no
  // job is running. Only a visible stop/cancel/status control is generation
  // evidence; a media tile or HTTP response is not.
  const generationActive = all.some((node) => {
    if (!visible(node)) return false;
    const value = text(node) + ' ' + (node.getAttribute('aria-label') || '') + ' ' + (node.getAttribute('title') || '');
    return /^(?:stop|cancel|dừng|hủy)\s*(?:generation|generating|tạo)?$/i.test(value.trim())
      || /(?:cancel generation|stop generating|generation in progress|đang xử lý)/i.test(value);
  });
  const downloadControlFound = all.some((node) => visible(node) && /download|save|export|tải xuống|lưu|xuất/i.test(text(node) + ' ' + (node.getAttribute('aria-label') || '') + ' ' + (node.getAttribute('title') || '')));
  const picker = all.find((node) => visible(node) && node.matches?.('button[aria-label="Image generation default model"]'));
  return {
    mediaCount: media.length,
    mediaIds: [...new Set(media.map((item) => item.mediaId).filter(Boolean))],
    historicalShotMediaIds,
    historicalShotMediaCount: historicalShotMediaIds.length,
    matchingBatchCount: matching.length,
    matchingBatchMediaCount,
    matchingBatchMediaIds,
    shotRevisionBatchCount: shotRevisionMatching.length,
    shotRevisionBatchMediaCount,
    shotRevisionBatchMediaIds,
    generatedMessageCount,
    assistantClaimsGenerated: generatedMessageCount > 0,
    generationActive,
    downloadControlFound,
    selectedModel: text(picker),
    composerFound: Boolean(all.find((node) => visible(node) && node.matches?.('[contenteditable="true"]'))),
    promptEditorFound: Boolean(all.find((node) => visible(node) && node.matches?.('[contenteditable="true"]'))),
    imageModeFound: /nano banana|what do you want to (create|change)|bạn muốn thay đổi gì/i.test(bodyText),
  };
})();`;

class BrowserOsFlow {
  constructor(endpoint, statePath, workspace) {
    this.endpoint = endpoint;
    this.statePath = statePath;
    this.workspace = workspace;
    this.state = {};
    this.sessionId = null;
    this.serverInfo = null;
    this.protocolVersion = null;
    this.tools = [];
    this.nextId = 1;
  }

  async initialize() {
    try { this.state = JSON.parse(await readFile(this.statePath, "utf8")); } catch { this.state = {}; }
    const storedEndpoint = typeof this.state.endpoint === "string" ? this.state.endpoint : null;
    const storedServerName = this.state.serverInfo?.name;
    const endpointChanged = storedEndpoint !== null && storedEndpoint !== this.endpoint;
    const legacyNeoStateOnGithubBrowser = storedEndpoint === null
      && storedServerName === "browseros-neo"
      && this.endpoint.includes(":9000/");
    if (endpointChanged || legacyNeoStateOnGithubBrowser) {
      // Page ids are bridge/profile scoped; do not reuse a neo page in the
      // GitHub BrowserOS bridge or let a stale session select the wrong tab.
      this.state = {};
    }
    this.serverInfo = this.state.serverInfo || null;
    this.protocolVersion = this.state.protocolVersion || null;
    this.sessionId = typeof this.state.sessionId === "string" ? this.state.sessionId : null;
    if (this.sessionId) {
      try { await this.call("tools/list", {}); this.tools = this.state.tools || []; if (this.tools.length) return; } catch { this.sessionId = null; }
    }
    const initialized = await this.call("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "auto3dvideo-browseros-flow", version: "1.0.0" } }, { includeSession: false });
    this.serverInfo = initialized.serverInfo || null;
    this.protocolVersion = initialized.protocolVersion || null;
    const listed = await this.call("tools/list", {});
    this.tools = Array.isArray(listed.tools) ? listed.tools.map((item) => item.name).filter(Boolean) : [];
    await this.persist();
  }

  async persist() {
    await mkdir(dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, JSON.stringify({ ...this.state, endpoint: this.endpoint, sessionId: this.sessionId, pageId: this.state.pageId ?? null, pageUrl: this.state.pageUrl ?? null, serverInfo: this.serverInfo, protocolVersion: this.protocolVersion, tools: this.tools.slice(0, 64), updatedAt: new Date().toISOString() }, null, 2), "utf8");
  }

  async call(method, params, options = {}) {
    const id = this.nextId++;
    const headers = { Accept: "application/json, text/event-stream", "Content-Type": "application/json", "Mcp-Protocol-Version": "2025-03-26" };
    if (this.sessionId && options.includeSession !== false) headers["Mcp-Session-Id"] = this.sessionId;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(this.endpoint, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), signal: controller.signal });
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("BrowserOS MCP response vượt giới hạn");
      if (!response.ok) throw new Error(`BrowserOS MCP HTTP ${response.status}`);
      const session = response.headers.get("mcp-session-id");
      if (session) this.sessionId = session;
      const result = parseSse(body, id);
      const structuredSession = result?.structuredContent?.session;
      if (typeof structuredSession === "string" && structuredSession.trim()) this.sessionId = structuredSession;
      return result;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("BrowserOS MCP timeout");
      throw error;
    } finally { clearTimeout(timeout); }
  }

  async tool(name, args, options = {}) {
    if (!this.tools.includes(name)) throw new Error(`BrowserOS MCP thiếu tool ${name}`);
    const toolArguments = { ...args };
    if (this.sessionId) toolArguments.session = this.sessionId;
    return this.call("tools/call", { name, arguments: toolArguments }, options);
  }

  async ensurePage(projectUrl) {
    const requested = safeProjectUrl(projectUrl);
    const adoptOwnedPage = async () => {
      const tabs = await this.tool("tabs", { action: "list" });
      const ownTabsText = contentText(tabs).split("Other agents' tabs:")[0];
      const candidates = [...ownTabsText.matchAll(/\[(\d+)\]\s+(https:\/\/flow\.google\.com\S*)/g)]
        .map((match) => ({ page: Number(match[1]), url: match[2].replace(/[)\],]+$/, "") }))
        .filter((item) => item.url === requested || item.url.startsWith(`${requested}/`));
      for (const candidate of candidates.reverse()) {
        const viewport = await this.viewport(candidate.page);
        if (viewport && viewport.width > 0 && viewport.height > 0) {
          this.state.pageId = candidate.page;
          this.state.pageUrl = safeFlowUrl(candidate.url);
          await this.persist();
          return candidate.page;
        }
      }
      return null;
    };
    if (Number.isInteger(this.state.pageId)) {
      try {
        const tabs = await this.tool("tabs", { action: "list" });
        const userTabsText = contentText(tabs).split("Other agents' tabs:")[0];
        const pageLine = userTabsText.split(/\r?\n/).find((line) => line.includes(`[${this.state.pageId}]`));
        if (!pageLine) {
          this.state.pageId = null;
        } else {
        const current = pageLine?.match(/https:\/\/flow\.google\.com\S*/)?.[0]?.replace(/[)\],]+$/, "");
        const viewport = await this.viewport(this.state.pageId);
        if (viewport && (viewport.width <= 0 || viewport.height <= 0)) {
          // A background BrowserOS tab can expose DOM but has no hit-testable
          // viewport. Recreate it in a normal window before any action.
          this.state.pageId = null;
        } else {
          if (current !== requested && !current?.startsWith(`${requested}/`)) {
            await this.tool("navigate", { page: this.state.pageId, action: "url", url: requested });
            await this.waitForFlowReady(this.state.pageId);
          }
          const settledTabs = await this.tool("tabs", { action: "list" });
          const settledUserTabsText = contentText(settledTabs).split("Other agents' tabs:")[0];
          const settledLine = settledUserTabsText.split(/\r?\n/).find((line) => line.includes(`[${this.state.pageId}]`));
          const settled = settledLine?.match(/https:\/\/flow\.google\.com\S*/)?.[0]?.replace(/[)\],]+$/, "");
          this.state.pageUrl = settled ? safeFlowUrl(settled) : requested;
          await this.persist();
          return this.state.pageId;
        }
        }
      } catch { this.state.pageId = null; }
    }
    const adopted = await adoptOwnedPage().catch(() => null);
    if (adopted !== null) return adopted;
    if (Number.isInteger(this.state.automationPageId)) {
      // Recover exactly one closed/crashed automation tab. If the page id is
      // still listed, keep the anti-duplication guard and require the existing
      // tab to be restored instead of opening another Flow tab.
      const tabs = await this.tool("tabs", { action: "list" }).catch(() => null);
      const tabsText = tabs ? contentText(tabs).split("Other agents' tabs:")[0] : null;
      const automationPageGone = tabsText !== null
        && !tabsText.includes(`[${this.state.automationPageId}]`);
      if (automationPageGone) {
        this.state.automationPageId = null;
        this.state.pageId = null;
        await this.persist();
      } else {
        throw new Error("BrowserOS Flow task tab không còn viewport; tab vẫn tồn tại hoặc chưa xác minh được. Không mở thêm tab để tránh nhân bản tab.");
      }
    }
    await this.tool("windows", { action: "create" }).catch(() => null);
    const opened = await this.tool("tabs", { action: "new", url: requested, background: false });
    this.state.pageId = parsePageId(contentText(opened));
    this.state.automationPageId = this.state.pageId;
    const openedUrl = contentText(opened).match(/https:\/\/flow\.google\.com\S*/)?.[0]?.replace(/[)\],]+$/, "");
    this.state.pageUrl = openedUrl ? safeFlowUrl(openedUrl) : requested;
    await this.persist();
    await this.waitForFlowReady(this.state.pageId);
    const openedViewport = await this.viewport(this.state.pageId);
    if (openedViewport && (openedViewport.width <= 0 || openedViewport.height <= 0)) {
      throw new Error(`BrowserOS mở được Flow nhưng tab không có viewport thao tác (${openedViewport.width}x${openedViewport.height})`);
    }
    return this.state.pageId;
  }

  async viewport(page) {
    try {
      return await this.evaluate(page, "return {width: document.documentElement.clientWidth, height: document.documentElement.clientHeight};");
    } catch {
      return null;
    }
  }

  async waitForFlowReady(page) {
    if (!Number.isInteger(page)) return;
    // Flow renders the composer asynchronously after the project shell. A
    // snapshot taken immediately after navigation can contain only the shell,
    // which used to be misclassified as "no composer". Waiting is bounded and
    // best-effort: auth/route blockers still fall through to the normal guard.
    for (const signal of ["Start generation", "Bắt đầu tạo", "What do you want to create"]) {
      try {
        await this.tool("wait", {
          page,
          for: "text",
          value: signal,
          timeout: FLOW_READY_TIMEOUT_MS,
        }, { timeoutMs: FLOW_READY_TIMEOUT_MS + 5_000 });
        return;
      } catch {
        // Try the next localized signal before allowing the caller to inspect
        // the current DOM and report a real route/auth blocker.
      }
    }
  }

  async snapshot(page) {
    const result = await this.tool("snapshot", { page });
    const text = contentText(result).slice(0, MAX_SNAPSHOT_CHARS);
    return { result, text, refs: extractUiRefs(text) };
  }

  async evaluate(page, code) {
    const result = await this.tool("evaluate", { page, code, timeout: 15_000 });
    return extractJson(contentText(result));
  }

  async click(page, ref) {
    return this.tool("act", { page, kind: "click", ref });
  }

  async fill(page, ref, value) {
    return this.tool("act", { page, kind: "fill", ref, value });
  }

  async inspect(page, shotId, revisionId, runId) {
    return this.evaluate(page, inspectOutputCode(shotId, revisionId, runId));
  }

  async ensureImageComposer(page) {
    const readComposer = async () => this.evaluate(page, inspectComposerCode).catch(() => ({}));
    let state = await readComposer();
    if (state.promptEditorFound && state.imageModeFound) return state;

    // Flow can leave the project shell or a previous session visible. These
    // controls only enter/create the composer; they never submit a prompt or
    // spend generation credits. Use one bounded recovery so a missing picker
    // is not treated as a permanent block on the first snapshot.
    for (const labels of [
      ["start new session"],
      ["get started", "start creating", "bắt đầu tạo"],
      ["new project", "create project", "tạo dự án"],
    ]) {
      const snapshot = await this.snapshot(page).catch(() => null);
      const entry = snapshot?.refs.find((item) => textMatches(item.label, labels));
      if (!entry) continue;
      await this.click(page, entry.reference);
      await this.waitForFlowReady(page);
      state = await readComposer();
      if (state.promptEditorFound && state.imageModeFound) return state;
    }
    return state;
  }

  async model(page, reopened = false) {
    await this.evaluate(page, `
      const node = document.querySelector('button[aria-label="Settings trigger"], button[aria-label="Image generation default model"], [contenteditable="true"]');
      if (node) node.scrollIntoView({ block: 'center', inline: 'center' });
      return Boolean(node);
    `).catch(() => false);
    await this.ensureImageComposer(page);
    const initial = await this.snapshot(page);
    const modelRef = (item) => textMatches(item.label, ["image generation default model", "nano banana", "image model"]);
    let picker = initial.refs.find(modelRef);
    let pickerSnapshotRefs = initial.refs;
    let pickerViaDom = false;
    let settings = initial.refs.find((item) => textMatches(item.label, ["settings trigger", "agent settings", "settings"]));
    if (!picker && settings) {
      // The Flow settings panel is rendered asynchronously and its snapshot
      // refs can change after the first click. Refresh the ref before the
      // bounded Enter fallback instead of reusing a stale handle.
      let menu = null;
      for (let attempt = 0; !picker && attempt < 4; attempt += 1) {
        if (attempt === 0) await this.click(page, settings.reference).catch(() => null);
        else if (attempt === 1) await this.tool("act", { page, kind: "press", ref: settings.reference, key: "Enter" }).catch(() => null);
        else if (settings) await this.click(page, settings.reference).catch(() => null);
        await this.tool("wait", { page, for: "text", value: "Agent settings", timeout: 5_000 }, { timeoutMs: 10_000 }).catch(() => null);
        await this.tool("wait", { page, for: "text", value: "Image generation default model", timeout: 5_000 }, { timeoutMs: 10_000 }).catch(() => null);
        menu = await this.snapshot(page);
        pickerSnapshotRefs = menu.refs;
        picker = menu.refs.find(modelRef);
        settings = menu.refs.find((item) => textMatches(item.label, ["settings trigger", "agent settings", "settings"]));
        if (!picker) await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      }
    }
    if (!picker) {
      // Flow's Agent settings picker can be visible in the real DOM/shadow DOM
      // while BrowserOS omits it from the accessibility snapshot. Use a
      // bounded, label-scored DOM recovery for settings/model only; it never
      // guesses coordinates or touches the prompt/generate controls.
      for (let attempt = 0; !picker && attempt < 4; attempt += 1) {
        let domState = await this.evaluate(page, imageModelDomStateCode).catch(() => ({}));
        if (!domState.pickerFound && domState.settingsFound) {
          await this.evaluate(page, imageModelDomActionCode("settings")).catch(() => null);
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
          domState = await this.evaluate(page, imageModelDomStateCode).catch(() => ({}));
        }
        if (domState.pickerFound) {
          pickerViaDom = true;
          picker = { role: "dom", label: domState.picker?.text || "Image generation default model", reference: "dom:image-model-picker" };
          break;
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      }
    }
    if (!picker) {
      const refs = pickerSnapshotRefs.map((item) => `${item.role}:${item.label}`).slice(-24).join(" | ");
      throw new Error(`Không tìm thấy image model picker trong snapshot BrowserOS; refs=${refs}`);
    }
    if (pickerViaDom) await this.evaluate(page, imageModelDomActionCode("picker"));
    else await this.click(page, picker.reference);
    let menu = await this.snapshot(page);
    let option = menu.refs.find((item) => textMatches(item.label, ["nano banana pro"]));
    if (!option) {
      // Angular Material can expose the menu one render behind the click.
      await this.tool("wait", { page, for: "text", value: "Nano Banana Pro", timeout: 5_000 }, { timeoutMs: 10_000 }).catch(() => null);
      menu = await this.snapshot(page);
      option = menu.refs.find((item) => textMatches(item.label, ["nano banana pro"]));
    }
    if (option) await this.click(page, option.reference);
    else {
      const domOption = await this.evaluate(page, imageModelDomActionCode("model"));
      if (!domOption?.clicked) throw new Error("Không tìm thấy Nano Banana Pro option trong menu Flow");
    }
    const afterOption = await this.snapshot(page);
    const readSelectedModel = async () => {
      const state = await this.evaluate(page, inspectComposerCode).catch(() => ({}));
      const pickerText = typeof state.selectedModel === "string" ? state.selectedModel : "";
      if (/Nano Banana Pro/i.test(pickerText)) return { selected: true, pickerText };
      const domState = await this.evaluate(page, imageModelDomStateCode).catch(() => ({}));
      const domText = typeof domState.picker?.text === "string" ? domState.picker.text : "";
      return { selected: /Nano Banana Pro/i.test(domText), pickerText: pickerText || domText };
    };
    let selectedModel = await readSelectedModel();
    // Flow updates the Angular button label asynchronously after the menu item
    // click. A single immediate read can observe the old label and falsely
    // block a valid Pro selection. Poll only this exact model control for a
    // bounded interval; never infer selection from the page body alone.
    for (let attempt = 1; !selectedModel.selected && attempt < 10; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      selectedModel = await readSelectedModel();
    }
    if (!selectedModel.selected) {
      throw new Error(`Flow chưa xác nhận Nano Banana Pro ngay sau khi chọn model (picker=${selectedModel.pickerText || "trống"})`);
    }
    const batch = afterOption.refs.find((item) => item.role === "radio" && /^x1$/i.test(item.label.trim()));
    if (batch) await this.click(page, batch.reference);
    else {
      const domBatch = await this.evaluate(page, imageModelDomActionCode("batch"));
      if (!domBatch?.clicked) throw new Error("Không thấy bộ chọn số lượng ảnh x1 trong Agent settings");
    }
    const afterBatch = await this.snapshot(page);
    const saveRef = afterBatch.refs.find((item) => textMatches(item.label, ["save", "lưu"]));
    // Prefer the live DOM because Flow can keep a stale accessibility ref for
    // the settings panel. Fall back to the fresh snapshot ref only when the
    // DOM bridge cannot see the button. Neither branch generates media.
    let saveAction = await this.evaluate(page, imageModelDomActionCode("save")).catch(() => null);
    if (!saveAction?.clicked && saveRef) {
      try {
        await this.click(page, saveRef.reference);
        saveAction = { found: true, clicked: true, kind: "save", clickMethod: "browseros_snapshot_save_ref", text: saveRef.label };
      } catch {
        saveAction = null;
      }
    }
    if (!saveAction?.clicked) {
      const refs = afterBatch.refs.map((item) => `${item.role}:${item.label}`).filter((item) => /save|lưu/i.test(item)).slice(0, 8).join(" | ");
      throw new Error(`Không click/xác nhận được nút Save trong Agent settings (refs=${refs || "trống"})`);
    }
    // A successful model read before Save is authoritative for the selected
    // option. Saving can close the panel, which temporarily removes the
    // picker from DOM; therefore do not turn that normal UI transition into a
    // false negative. Re-read only to capture the final label when available.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
    const savedModel = await readSelectedModel();
    const selected = Boolean(selectedModel.selected || savedModel.selected);
    const pickerText = savedModel.pickerText || selectedModel.pickerText || "Nano Banana Pro";
    const saved = Boolean(saveAction.clicked && selected);
    const state = await this.evaluate(page, inspectComposerCode).catch(() => ({}));
    return { status: selected && saved ? "ready" : "blocked", modelSelected: selected, saved, selectedModel: pickerText, outputCount: "x1", composerFound: Boolean(state.composerFound), promptEditorFound: Boolean(state.promptEditorFound), imageModeFound: Boolean(state.imageModeFound), message: selected && saved ? "BrowserOS đã chọn Nano Banana Pro, đặt x1 và bấm Save trong Google Flow." : `Flow chưa xác nhận đủ bước chọn model và Save (modelSelected=${selected}, saved=${saved}, picker=${pickerText || "trống"}).` };
  }

  async typePrompt(page, prompt, submit) {
    const promptToken = JSON.stringify(prompt);
    const entered = await this.evaluate(page, `
      return (() => {
        const visible = (node) => {
          if (!node) return false;
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
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
        const editor = roots.flatMap((root) => [...root.querySelectorAll('flow-rich-text-editor.prompt-input div.ProseMirror[contenteditable="true"]')]).find(visible);
        if (!editor) return { found: false, accepted: false, charCount: 0 };
        editor.scrollIntoView({ block: 'center', inline: 'center' });
        editor.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        selection.removeAllRanges();
        selection.addRange(range);
        let inserted = false;
        try { inserted = document.execCommand('insertText', false, ${promptToken}); } catch (_) { inserted = false; }
        let text = String(editor.innerText || '').trim();
        if (!text.includes('SHOT_ID:') || !text.includes('REVISION_ID:')) {
          editor.replaceChildren();
          const paragraph = document.createElement('p');
          paragraph.textContent = ${promptToken};
          editor.appendChild(paragraph);
          editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: ${promptToken} }));
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${promptToken} }));
          editor.dispatchEvent(new Event('change', { bubbles: true }));
          text = String(editor.innerText || '').trim();
        }
        return { found: true, accepted: text.includes('SHOT_ID:') && text.includes('REVISION_ID:'), charCount: text.length, inserted };
      })();
    `).catch((error) => ({ found: false, accepted: false, charCount: 0, error: String(error?.message || error).slice(0, 400) }));
    if (!entered.found) throw new Error(`Không tìm thấy đúng Flow ProseMirror prompt editor${entered.error ? `: ${entered.error}` : ""}`);
    if (submit) {
      const current = await this.snapshot(page);
      const editor = current.refs.find((item) => (item.role === "textbox" || item.role === "paragraph" || item.role === "generic") && textMatches(item.label, ["what do you want to create", "what do you want to change", "bạn muốn thay đổi gì", "prompt"]));
      if (editor) await this.tool("act", { page, kind: "press", ref: editor.reference, key: "Enter" });
    }
    const state = await this.evaluate(page, inspectComposerCode);
    const accepted = state.promptText?.includes("SHOT_ID:") && state.promptText?.includes("REVISION_ID:");
    return { status: accepted ? "ready" : "blocked", editorFound: true, promptAccepted: Boolean(accepted), generateClicked: Boolean(submit), message: accepted ? "BrowserOS đã nhập prompt vào đúng ProseMirror image composer." : "BrowserOS chưa xác nhận prompt trong image composer." };
  }

  async clickGenerate(page) {
    await this.evaluate(page, "const node = document.querySelector('button[aria-label=\"Start generation\"], button[aria-label=\"Generate\"]'); if (node) node.scrollIntoView({ block: 'center', inline: 'center' }); return Boolean(node);").catch(() => false);
    const current = await this.snapshot(page);
    const generate = pickRef(current.refs, (item) => item.role === "button" && textMatches(item.label, ["start generation", "generate image", "generate", "tạo ảnh"]) && !textMatches(item.label, ["chat"]), "nút Generate của Flow");
    await this.click(page, generate.reference);
    return { status: "ready", generateClicked: true, controlLabel: generate.label, message: "BrowserOS đã click nút Generate thật trong Google Flow." };
  }

  async animate(page, shotId, revisionId, mediaId) {
    let selectedMediaId = mediaId || null;
    if (!selectedMediaId) {
      const byShot = await this.evaluate(page, mediaByShotLabelCode(shotId, revisionId)).catch(() => null);
      if (!byShot?.found || !byShot.mediaId) {
        throw new Error(byShot?.reason || "BrowserOS khÃ´ng tÃ¬m tháº¥y card áº£nh Flow theo shot/revision Ä‘Ã£ cÃ³");
      }
      selectedMediaId = byShot.mediaId;
    }

    const current = await this.evaluate(page, animateIngredientStateCode(selectedMediaId)).catch(() => ({}));
    if (current.referenceAttached && current.editorFound) {
      return {
        status: "ready",
        editorFound: true,
        referenceAttached: true,
        sourceMediaId: current.sourceMediaId || selectedMediaId,
        message: "BrowserOS Ä‘Ã£ xÃ¡c nháº­n ingredient Ä‘Ãºng media Ä‘Ã£ gÃ¡n sáºµn trong video composer.",
      };
    }
    if (current.ingredientCount > 0) {
      throw new Error("Google Flow Ä‘ang cÃ³ ingredient áº£nh khÃ¡c; dÃ¹ng card cÅ© cÃ³ thá»ƒ gáº¯n nháº§m reference");
    }

    let options = await this.evaluate(page, exactMediaOptionsCode(selectedMediaId)).catch(() => null);
    if (!options?.found) {
      const byShot = await this.evaluate(page, mediaByShotLabelCode(shotId, revisionId)).catch(() => null);
      if (byShot?.found && byShot.mediaId) {
        selectedMediaId = byShot.mediaId;
        options = await this.evaluate(page, exactMediaOptionsCode(selectedMediaId)).catch(() => null);
      }
    }
    if (!options?.found) throw new Error(options?.reason || "BrowserOS khÃ´ng tÃ¬m tháº¥y card áº£nh Flow Ä‘á»ƒ Animate");
    if (options.needsHover && options.rect?.width > 0 && options.rect?.height > 0) {
      await this.tool("act", {
        page,
        kind: "hover_at",
        x: Number(options.rect.x) + Number(options.rect.width) / 2,
        y: Number(options.rect.y) + Number(options.rect.height) / 2,
      });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
      options = await this.evaluate(page, exactMediaOptionsCode(selectedMediaId)).catch(() => options);
    }
    if (options.needsClick && options.rect?.width > 0 && options.rect?.height > 0) {
      await this.tool("act", {
        page,
        kind: "click_at",
        x: Number(options.rect.x) + Number(options.rect.width) / 2,
        y: Number(options.rect.y) + Number(options.rect.height) / 2,
        button: "left",
        clickCount: 1,
      });
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    const menu = await this.snapshot(page).catch(() => ({ refs: [] }));
    const animateRef = menu.refs.find((item) => /menuitem/i.test(item.role) && /^animate$/i.test(item.label.trim()))
      || menu.refs.find((item) => /menuitem/i.test(item.role) && /\banimate\b/i.test(item.label));
    let clicked = null;
    if (animateRef) {
      await this.click(page, animateRef.reference);
      clicked = { found: true, clicked: true, clickMethod: "browseros_snapshot_exact_media_animate" };
    } else {
      clicked = await this.evaluate(page, exactMediaMenuAnimateCode()).catch(() => null);
    }
    if (!clicked?.found || !clicked?.clicked) {
      throw new Error(clicked?.reason || "Flow chÆ°a xÃ¡c nháº­n menu Animate cá»§a Ä‘Ãºng card áº£nh");
    }

    let verified = {};
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt === 0 ? 700 : 400));
      verified = await this.evaluate(page, animateIngredientStateCode(selectedMediaId)).catch(() => ({}));
      if (verified.editorFound && verified.referenceAttached) {
        return {
          status: "ready",
          editorFound: true,
          referenceAttached: true,
          sourceMediaId: verified.sourceMediaId || selectedMediaId,
          message: "BrowserOS Ä‘Ã£ click Animate vÃ  xÃ¡c nháº­n ingredient Ä‘Ãºng media ID trong video composer.",
        };
      }
    }
    throw new Error("Flow chÆ°a xÃ¡c nháº­n ingredient áº£nh Ä‘Ãºng media ID sau Animate");
  }

  async download(page, shotId, revisionId, runId, mediaId, outputDir) {
    const observed = await this.inspect(page, shotId, revisionId, runId);
    if (!observed.generationActive && observed.matchingBatchMediaCount === 0 && (!mediaId || !observed.mediaIds.includes(mediaId))) {
      throw new Error("Flow chưa có media mới đúng batch hiện tại; không tải card lịch sử");
    }
    let selectedMediaId = mediaId;
    // A page-wide snapshot has many Download buttons for history cards. Use a
    // fresh DOM query scoped to the exact batch identity before triggering the
    // browser download; never select the first generic Download ref.
    const userProfile = process.env.USERPROFILE;
    const downloadsDirectory = userProfile ? resolve(userProfile, "Downloads") : null;
    const beforeDownloadNames = downloadsDirectory
      ? new Set(await readdir(downloadsDirectory).catch(() => []))
      : new Set();
    const downloadStartedAt = Date.now();
    const saveExactMediaAsset = async () => {
      if (!selectedMediaId) return null;
      const asset = await this.evaluate(page, exactMediaAssetCode(selectedMediaId)).catch(() => null);
      if (!asset?.base64 || !/^image\/(?:png|jpeg|webp)$/i.test(String(asset.mime || ''))) return null;
      const extension = /png/i.test(asset.mime) ? '.png' : /webp/i.test(asset.mime) ? '.webp' : '.jpg';
      const rawPath = resolve(this.workspace, '.auto3dvideo', 'browseros', 'downloads', `flow-raw-${runId}-${shotId}${extension}`);
      await mkdir(dirname(rawPath), { recursive: true });
      await writeFile(rawPath, Buffer.from(asset.base64, 'base64'));
      const info = await stat(rawPath).catch(() => null);
      if (!info?.isFile() || info.size === 0) return null;
      return rawPath;
    };
    const chooseDownloadSize = async () => {
      let sizeRef = null;
      // Flow paints the nested size menu asynchronously after the parent
      // Download item is clicked. Retry the same owned page briefly instead
      // of starting the filesystem poll while the submenu is still opening.
      for (let attempt = 0; attempt < 6 && !sizeRef; attempt += 1) {
        const menu = await this.snapshot(page).catch(() => null);
        sizeRef = menu?.refs.find((item) => item.role === "menuitem"
          && /^(?:1k\s+original size|2k\s+upscaled|4k\s+upscaled)$/i.test(item.label.trim())) || null;
        if (!sizeRef && attempt === 0) {
          const downloadParent = menu?.refs.find((item) => item.role === "menuitem" && /^download$/i.test(item.label.trim()));
          if (downloadParent) {
            const parentRect = await this.evaluate(page, `return (() => {
              const visible = (node) => {
                if (!node) return false;
                const rect = node.getBoundingClientRect();
                const style = getComputedStyle(node);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
              };
              const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
              const roots = [document];
              for (let index = 0; index < roots.length; index += 1) {
                const root = roots[index];
                for (const node of root.querySelectorAll ? root.querySelectorAll('*') : []) if (node.shadowRoot) roots.push(node.shadowRoot);
              }
              const item = roots.flatMap((root) => [...(root.querySelectorAll ? root.querySelectorAll('[role="menuitem"], mat-menu-item') : [])])
                .find((node) => visible(node) && /^download$/i.test(text(node)));
              if (!item) return { found: false };
              const rect = item.getBoundingClientRect();
              return { found: true, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
            })();`).catch(() => null);
            if (parentRect?.found && parentRect.width > 0 && parentRect.height > 0) {
              await this.tool("act", {
                page,
                kind: "hover_at",
                x: Number(parentRect.x) + Number(parentRect.width) / 2,
                y: Number(parentRect.y) + Number(parentRect.height) / 2,
              }).catch(() => null);
            }
          }
        }
        if (!sizeRef && attempt < 5) await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      }
      if (!sizeRef) return null;
      // Flow's Angular menu accepts the BrowserOS ref reliably. A coordinate
      // click can report success while leaving the size menu open, which then
      // makes the filesystem poll falsely conclude that Download failed.
      // Prefer the fresh menu ref and use coordinates only as a bounded
      // compatibility fallback for bridge builds that reject menu refs.
      let sizeRefError = "";
      try {
        await this.click(page, sizeRef.reference);
        return { found: true, clicked: true, clickMethod: "browseros_download_size_ref", downloadSizeLabel: sizeRef.label };
      } catch (error) {
        sizeRefError = String(error?.message || error).slice(0, 300);
      }
      const sizeRect = await this.evaluate(page, `return (() => {
        const visible = (node) => {
          if (!node) return false;
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        };
        const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
        const roots = [document];
        for (let index = 0; index < roots.length; index += 1) {
          const root = roots[index];
          for (const node of root.querySelectorAll ? root.querySelectorAll('*') : []) if (node.shadowRoot) roots.push(node.shadowRoot);
        }
        const item = roots.flatMap((root) => [...(root.querySelectorAll ? root.querySelectorAll('[role="menuitem"], mat-menu-item') : [])])
          .find((node) => visible(node) && /^(?:1k\\s+original size|2k\\s+upscaled|4k\\s+upscaled)$/i.test(text(node)));
        if (!item) return { found: false };
        const rect = item.getBoundingClientRect();
        return { found: true, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })();`).catch(() => null);
      if (sizeRect?.found && sizeRect.width > 0 && sizeRect.height > 0) {
        await this.tool("act", {
          page,
          kind: "click_at",
          x: Number(sizeRect.x) + Number(sizeRect.width) / 2,
          y: Number(sizeRect.y) + Number(sizeRect.height) / 2,
          button: "left",
          clickCount: 1,
        });
        return { found: true, clicked: true, clickMethod: "browseros_coordinate_download_size", downloadSizeLabel: sizeRef.label };
      }
      let downloadDetail = sizeRefError ? `size_ref_error=${sizeRefError}` : "";
      try {
        // BrowserOS's download helper is appropriate only for the final Flow
        // size item. It may time out after Chrome has already started saving;
        // the filesystem poll below deliberately treats that timeout as
        // non-fatal and verifies the actual file instead.
        const result = await this.tool("download", { page, ref: sizeRef.reference }, { timeoutMs: 8_000 });
        downloadDetail = JSON.stringify(result).slice(0, 1600);
      } catch (error) {
        const message = String(error?.message || error);
        if (!/timeout/i.test(message)) {
          // If this bridge rejects the specialized helper before dispatching,
          // give the same menu item one normal trusted click as a bounded
          // compatibility fallback.
          await this.click(page, sizeRef.reference);
          downloadDetail = `download_helper_error=${message.slice(0, 300)}`;
        } else {
          downloadDetail = "download_helper_timeout_waiting_for_native_file";
        }
      }
      return { found: true, clicked: true, clickMethod: "browseros_download_size", downloadSizeLabel: sizeRef.label, downloadDetail };
    };
    // The Flow detail view can already be left with the size menu open after
    // a previous click. Consume that exact menu item before looking for the
    // parent Download button, otherwise the next click only toggles the menu.
    let clicked = await chooseDownloadSize();
    if (!clicked) clicked = await this.evaluate(page, exactBatchDownloadCode(shotId, revisionId, runId));
    if ((!clicked?.clicked || !clicked?.found) && mediaId) {
      // Some Flow renders omit flow-batch-info after the image is committed.
      // If the caller already proved this media ID is fresh for the current
      // run, open More options on that exact media card and select Download
      // from the newly opened context menu instead of using a page-wide
      // Download button.
      const alreadyOpenMenu = await this.snapshot(page);
      const alreadyOpenDownload = alreadyOpenMenu.refs.find((item) => /^download media$/i.test(item.label.trim()))
        || alreadyOpenMenu.refs.find((item) => /menuitem/i.test(item.role) && /^download\b/i.test(item.label.trim()));
      if (alreadyOpenDownload) {
        const exactAssetPath = await saveExactMediaAsset();
        if (exactAssetPath) clicked = { found: true, clicked: true, clickMethod: "browseros_exact_media_src", sourcePath: exactAssetPath };
        else {
          // Flow's custom Angular menu already triggers Chrome's real file
          // download when clicked. BrowserOS's higher-level `download` tool
          // can wait for a stream/path that Flow does not expose and time out
          // even though Chrome has saved the file. Use a normal trusted click
          // and let the Downloads filesystem poll below be authoritative.
          await this.click(page, alreadyOpenDownload.reference);
          clicked = { found: true, clicked: true, clickMethod: "browseros_act_exact_media_context_menu" };
        }
      }
      if (!clicked?.clicked) {
        let options = await this.evaluate(page, exactMediaOptionsCode(selectedMediaId));
        if (!options?.found) {
          const byShot = await this.evaluate(page, mediaByShotLabelCode(shotId, revisionId)).catch(() => null);
          if (byShot?.found && byShot.mediaId) {
            selectedMediaId = byShot.mediaId;
            options = await this.evaluate(page, exactMediaOptionsCode(selectedMediaId));
          }
        }
        if (!options?.clicked && options?.needsHover && options.rect?.width > 0 && options.rect?.height > 0) {
        await this.tool("act", {
          page,
          kind: "hover_at",
          x: Number(options.rect.x) + Number(options.rect.width) / 2,
          y: Number(options.rect.y) + Number(options.rect.height) / 2,
        });
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
        options = await this.evaluate(page, exactMediaOptionsCode(selectedMediaId));
        }
        if (options?.needsClick && options.rect?.width > 0 && options.rect?.height > 0) {
        await this.tool("act", {
          page,
          kind: "click_at",
          x: Number(options.mediaRect?.x ?? options.rect.x) + Number(options.mediaRect?.width ?? options.rect.width) / 2,
          y: Number(options.mediaRect?.y ?? options.rect.y) + Number(options.mediaRect?.height ?? options.rect.height) / 2,
          button: "right",
          clickCount: 1,
        });
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
        let menu = await this.snapshot(page);
        let menuDownload = menu.refs.find((item) => /^download media$/i.test(item.label.trim()))
          || menu.refs.find((item) => /menuitem/i.test(item.role) && /^download\b/i.test(item.label.trim()))
          || menu.refs.find((item) => /menuitem/i.test(item.role) && /download|save|export|tải xuống|lưu|xuất/i.test(item.label));
        if (!menuDownload) {
          await this.tool("act", {
            page,
            kind: "click_at",
            x: Number(options.rect.x) + Number(options.rect.width) / 2,
            y: Number(options.rect.y) + Number(options.rect.height) / 2,
            button: "left",
            clickCount: 1,
          });
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
          menu = await this.snapshot(page);
          menuDownload = menu.refs.find((item) => /^download media$/i.test(item.label.trim()))
            || menu.refs.find((item) => /menuitem/i.test(item.role) && /^download\b/i.test(item.label.trim()))
            || menu.refs.find((item) => /menuitem/i.test(item.role) && /download|save|export|tải xuống|lưu|xuất/i.test(item.label));
        }
        if (menuDownload) {
          const exactAssetPath = await saveExactMediaAsset();
          if (exactAssetPath) clicked = { found: true, clicked: true, clickMethod: "browseros_exact_media_src", sourcePath: exactAssetPath };
          else {
            await this.click(page, menuDownload.reference);
            clicked = { found: true, clicked: true, clickMethod: "browseros_act_exact_media_context_menu" };
          }
        } else {
          clicked = await this.evaluate(page, exactMediaMenuDownloadCode());
        }
        } else if (options?.clicked) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
        const menu = await this.snapshot(page);
        const menuDownload = menu.refs.find((item) => /^download media$/i.test(item.label.trim()))
          || menu.refs.find((item) => /menuitem/i.test(item.role) && /^download\b/i.test(item.label.trim()))
          || menu.refs.find((item) => /menuitem/i.test(item.role) && /download|save|export|tải xuống|lưu|xuất/i.test(item.label));
        if (menuDownload) {
          const exactAssetPath = await saveExactMediaAsset();
          if (exactAssetPath) clicked = { found: true, clicked: true, clickMethod: "browseros_exact_media_src", sourcePath: exactAssetPath };
          else {
            await this.click(page, menuDownload.reference);
            clicked = { found: true, clicked: true, clickMethod: "browseros_act_exact_media_context_menu" };
          }
        } else {
          clicked = await this.evaluate(page, exactMediaMenuDownloadCode());
        }
        } else {
          clicked = await this.evaluate(page, exactMediaDownloadCode(selectedMediaId));
        }
      }
    }
    if (!clicked?.found || !clicked?.clicked) {
      throw new Error(clicked?.reason || "Flow chưa xác nhận Download của đúng batch hiện tại");
    }
    // In the image detail editor, clicking Download media opens a Flow-owned
    // size menu instead of starting the browser download. Select the smallest
    // available output explicitly; the filesystem poll below remains the
    // authoritative proof that Chrome really saved the new image.
    const selectedDownloadSize = await chooseDownloadSize();
    if (selectedDownloadSize) clicked = { ...clicked, ...selectedDownloadSize };
    // The BrowserOS wait schema differs between bridge builds. Filesystem
    // polling below is the authoritative download evidence, so use only a
    // short settle delay here and never treat the click itself as success.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
    const detail = String(clicked?.downloadDetail || "");
    const paths = [...detail.matchAll(/([A-Za-z]:[\\/][^\r\n"']+\.(?:png|jpe?g|webp))/gi)].map((match) => match[1]);
    const candidates = [clicked?.sourcePath, ...paths].filter(Boolean);
    let source = null;
    const deadline = Date.now() + 60_000;
    while (!source && Date.now() < deadline) {
      const freshDownloads = downloadsDirectory
        ? (await readdir(downloadsDirectory).catch(() => []))
          .filter((name) => !beforeDownloadNames.has(name) && /\.(png|jpe?g|webp)$/i.test(name))
          .map((name) => resolve(downloadsDirectory, name))
        : [];
      const searchCandidates = [...candidates, ...freshDownloads];
      for (const candidate of searchCandidates) {
        if (!candidate.toLowerCase().match(/\.(png|jpe?g|webp)$/)) continue;
        const candidateName = candidate.split(/[\\/]/).pop();
        if (candidateName && beforeDownloadNames.has(candidateName)) continue;
        const info = await stat(candidate).catch(() => null);
        if (info?.isFile() && info.size > 0 && info.mtimeMs >= downloadStartedAt - 1_000) { source = candidate; break; }
      }
      if (!source) await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    }
    if (!source) throw new Error(`BrowserOS báo download nhưng không tìm thấy file ảnh thật: ${detail.slice(0, 1400)}`);
    const destinationDir = resolve(this.workspace, outputDir);
    const canonicalWorkspace = resolve(this.workspace);
    if (!(destinationDir === canonicalWorkspace || destinationDir.startsWith(`${canonicalWorkspace}${sep}`))) throw new Error("Flow download output vượt project workspace");
    await mkdir(destinationDir, { recursive: true });
    const extension = source.slice(source.lastIndexOf(".")).toLowerCase();
    const destination = resolve(destinationDir, `flow-${shotId}-${revisionId}${extension}`);
    await copyFile(source, destination);
    const info = await stat(destination);
    if (!info.isFile() || info.size === 0) throw new Error("Flow download copy rỗng");
return { status: "ready", downloadStarted: true, downloadName: destination.split(/[\\/]/).pop(), downloadSizeBytes: info.size, sourceMediaId: selectedMediaId || observed.mediaIds.at(-1) || null, downloadPath: destination, clickMethod: clicked.clickMethod, message: `BrowserOS đã click Download của đúng batch Flow và copy ảnh vào workspace (${info.size} bytes).` };
  }

  async execute(operation, spec) {
    const page = await this.ensurePage(spec.projectUrl);
    if (operation === "flow_select_model") return { ...(await this.model(page)), page, targetUrl: this.state.pageUrl };
    if (operation === "flow_inspect_composer") {
      const state = await this.evaluate(page, inspectComposerCode);
      const imageComposerReady = state.composerFound && state.promptEditorFound && state.imageModeFound;
      return { ...state, status: imageComposerReady ? "ready" : "blocked", page, targetUrl: this.state.pageUrl, message: imageComposerReady ? "BrowserOS đã xác nhận editor ảnh thật và nút Settings; model gate sẽ mở panel để xác nhận Nano Banana Pro." : "BrowserOS chưa xác nhận image composer/editor ảnh thật; không gõ vào chat." };
    }
    if (operation === "flow_observe") {
      const snapshot = await this.snapshot(page);
      const flowState = await this.inspect(page, spec.shotId, spec.revisionId, spec.runId);
      return { status: "ready", operation: "browseros_observe_flow", observed: { controlCount: snapshot.refs.length, uiRefs: snapshot.refs, flowState }, page, targetUrl: this.state.pageUrl };
    }
    if (operation === "flow_type_prompt") return { ...(await this.typePrompt(page, safePrompt(spec.prompt), spec.submit === true)), page, targetUrl: this.state.pageUrl };
    if (operation === "flow_click_generate") return { ...(await this.clickGenerate(page)), page, targetUrl: this.state.pageUrl };
    if (operation === "flow_animate_image") return { ...(await this.animate(page, safeId(spec.shotId, "shotId"), safeId(spec.revisionId, "revisionId"), spec.mediaId ? safeId(spec.mediaId, "mediaId") : null)), page, targetUrl: this.state.pageUrl };
    if (operation === "flow_inspect_output") {
      const snapshot = await this.snapshot(page);
      const state = await this.inspect(page, spec.shotId, spec.revisionId, spec.runId);
      return { ...state, uiRefs: snapshot.refs, page, targetUrl: this.state.pageUrl, status: state.mediaIds?.length > 0 || state.matchingBatchCount > 0 || state.generationActive || state.promptEditorFound ? "ready" : "blocked" };
    }
    if (operation === "flow_download_image") return { ...(await this.download(page, safeId(spec.shotId, "shotId"), safeId(spec.revisionId, "revisionId"), safeId(spec.runId, "runId", /^[a-z0-9][a-z0-9-]{2,80}$/), spec.mediaId ? safeId(spec.mediaId, "mediaId") : null, safeText(spec.outputDir, "outputDir", 300))), page, targetUrl: this.state.pageUrl };
    throw new Error(`BrowserOS Flow operation không được phép: ${operation}`);
  }
}

async function main() {
  const output = resolve(required("--output"));
  const operation = safeText(arg("--operation") || "flow_observe", "operation", 64);
  const workspace = resolve(process.cwd());
  const browser = new BrowserOsFlow(process.env.AUTO3DVIDEO_BROWSEROS_MCP_ENDPOINT || DEFAULT_ENDPOINT, resolve(workspace, ".auto3dvideo", "browseros", "mcp-session.json"), workspace);
  let report;
  try {
    await browser.initialize();
    const promptFile = arg("--prompt-file");
    const prompt = promptFile
      ? await readFile(resolve(workspace, promptFile), "utf8")
      : arg("--prompt");
    const result = await browser.execute(operation, {
      projectUrl: required("--project-url"),
      prompt,
      submit: arg("--submit") === "true",
      shotId: arg("--shot-id"),
      revisionId: arg("--revision-id"),
      runId: arg("--run-id"),
      mediaId: arg("--media-id"),
      outputDir: arg("--output-dir") || ".auto3dvideo/browseros/downloads",
    });
    report = { ...result, status: result.status || "ready", operation, reportPath: output, serverInfo: browser.serverInfo || { name: browser.endpoint.includes(":9000/") ? "browseros_mcp" : "browseros-neo", title: browser.endpoint.includes(":9000/") ? "BrowserOS MCP server" : "BrowserOS neo" }, protocolVersion: browser.protocolVersion, tools: browser.tools, browserSessionAttached: true, browserActionsPerformed: true, networkCallsMade: true, message: result.message || `BrowserOS ${operation} đã hoàn tất.` };
  } catch (error) {
    report = { status: "blocked", operation, reportPath: output, serverInfo: browser.serverInfo, protocolVersion: browser.protocolVersion, tools: browser.tools, browserSessionAttached: false, browserActionsPerformed: false, networkCallsMade: false, message: String(error?.message || error).slice(0, 1200) };
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2), "utf8");
  if (report.status === "blocked") process.exitCode = 2;
}

main().catch((error) => { console.error(String(error?.stack || error)); process.exitCode = 1; });
