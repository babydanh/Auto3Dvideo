import { copyFile, link, mkdir, open, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  flowExactMediaMessage,
  flowProjectIdFromProjectUrl,
  isSafeFlowMediaIdArgument,
  MAX_FLOW_IMAGE_CARDS,
  normalizeFlowImageCards,
  verifyExactMediaPresence,
  verifyFlowIngredientChip,
} from "./flow_exact_media.mjs";

// GitHub BrowserOS exposes the local MCP proxy on 9000. BrowserOS neo can
// still be selected explicitly with AUTO3DVIDEO_BROWSEROS_MCP_ENDPOINT=9010.
const DEFAULT_ENDPOINT = "http://127.0.0.1:9000/mcp";
const REQUEST_TIMEOUT_MS = 45_000;
const FLOW_READY_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_FLOW_DOWNLOAD_ZIP_BYTES = 512 * 1024 * 1024;
const MAX_FLOW_DOWNLOAD_MEDIA_BYTES = 512 * 1024 * 1024;
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

// A request that names the media to act on is checked against the same card
// contract discovery, the session schema and the Rust parser use, so a card
// that could be discovered and saved is never refused here for length. The one
// non-card value is the newest-media sentinel the download route sends.
function safeMediaIdArgument(value) {
  const normalized = safeText(value, "mediaId", 256);
  if (!isSafeFlowMediaIdArgument(normalized)) throw new Error("mediaId không hợp lệ");
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

async function extractFlowDownloadZip(zipPath, workspace, runId, shotId, mediaKind = "image", outputDirectory = null) {
  const userProfile = process.env.USERPROFILE;
  const toolOutputRoot = userProfile ? resolve(userProfile, ".browseros", "tool-output") : null;
  const canonicalZip = resolve(zipPath);
  const relativeZip = toolOutputRoot && canonicalZip.startsWith(`${toolOutputRoot}${sep}`)
    ? canonicalZip.slice(toolOutputRoot.length + 1)
    : "";
  const zipParts = relativeZip.split(sep);
  if (
    zipParts.length !== 2
    || !/^download-[^\\/]+$/i.test(zipParts[0])
    || !/\.zip$/i.test(zipParts[1])
  ) {
    throw new Error("BrowserOS download zip nằm ngoài thư mục tool-output/download-* được phép");
  }
  const archiveInfo = await stat(canonicalZip);
  if (!archiveInfo.isFile() || archiveInfo.size < 22 || archiveInfo.size > MAX_FLOW_DOWNLOAD_ZIP_BYTES) {
    throw new Error("BrowserOS download zip rỗng hoặc vượt giới hạn 512 MiB");
  }
  const archive = await readFile(canonicalZip);
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const localSignature = 0x04034b50;
  const minEocdOffset = Math.max(0, archive.length - 22 - 0xffff);
  let eocdOffset = -1;
  for (let offset = archive.length - 22; offset >= minEocdOffset; offset -= 1) {
    if (
      archive.readUInt32LE(offset) === eocdSignature
      && offset + 22 + archive.readUInt16LE(offset + 20) === archive.length
    ) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("BrowserOS download zip thiếu end-of-central-directory");
  const diskNumber = archive.readUInt16LE(eocdOffset + 4);
  const centralDisk = archive.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = archive.readUInt16LE(eocdOffset + 8);
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralSize = archive.readUInt32LE(eocdOffset + 12);
  const centralOffset = archive.readUInt32LE(eocdOffset + 16);
  const centralEnd = centralOffset + centralSize;
  if (
    diskNumber !== 0
    || centralDisk !== 0
    || entriesOnDisk !== entryCount
    || entryCount > 128
    || centralSize > 1024 * 1024
    || centralOffset > eocdOffset
    || centralEnd > eocdOffset
  ) {
    throw new Error("BrowserOS download zip có cấu trúc phân vùng hoặc central directory không hợp lệ");
  }

  const mediaPattern = mediaKind === "video"
    ? /\.(?:mp4|m4v|mov|webm)$/i
    : mediaKind === "image"
      ? /\.(?:png|jpe?g|webp)$/i
      : null;
  if (!mediaPattern) throw new Error("Loại media ZIP Flow không hợp lệ");
  const files = [];
  let cursor = centralOffset;
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (cursor + 46 > centralEnd || archive.readUInt32LE(cursor) !== centralSignature) {
      throw new Error("BrowserOS download zip có central directory entry không hợp lệ");
    }
    const flags = archive.readUInt16LE(cursor + 8);
    const compression = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > centralEnd) throw new Error("BrowserOS download zip có tên file vượt central directory");
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor = entryEnd;
    if (!mediaPattern.test(name)) continue;
    if (name.includes("..") || name.includes("/") || name.includes("\\") || name.includes("\0")) {
      throw new Error("BrowserOS download zip chứa tên media không an toàn");
    }
    if ((flags & 1) !== 0 || ![0, 8].includes(compression)) {
      throw new Error("BrowserOS download zip chứa media mã hóa hoặc compression không hỗ trợ");
    }
    if (
      compressedSize === 0
      || uncompressedSize === 0
      || compressedSize > MAX_FLOW_DOWNLOAD_ZIP_BYTES
      || uncompressedSize > MAX_FLOW_DOWNLOAD_MEDIA_BYTES
      || localOffset + 30 > centralOffset
      || archive.readUInt32LE(localOffset) !== localSignature
    ) {
      throw new Error("BrowserOS download zip chứa video/ảnh rỗng hoặc local header không hợp lệ");
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataStart > centralOffset || dataEnd > centralOffset) {
      throw new Error("BrowserOS download zip có media data vượt local file area");
    }
    const compressed = archive.subarray(dataStart, dataEnd);
    const data = compression === 0
      ? compressed
      : inflateRawSync(compressed, { maxOutputLength: MAX_FLOW_DOWNLOAD_MEDIA_BYTES });
    if (data.length === 0 || data.length !== uncompressedSize) {
      throw new Error("BrowserOS download zip chứa media không đọc được");
    }
    files.push({ name, data });
  }
  if (files.length !== 1) {
    throw new Error(`BrowserOS download zip phải có đúng một ${mediaKind === "video" ? "video" : "ảnh"}, nhận ${files.length}`);
  }

  const extension = files[0].name.slice(files[0].name.lastIndexOf(".")).toLowerCase();
  const destinationRoot = outputDirectory
    ? resolve(outputDirectory)
    : resolve(workspace, ".auto3dvideo", "browseros", "downloads");
  const outputName = outputDirectory
    ? `flow-${runId}-${shotId}-${randomUUID()}${extension}`
    : `flow-raw-${runId}-${shotId}${extension}`;
  const rawPath = resolve(destinationRoot, outputName);
  await mkdir(dirname(rawPath), { recursive: true });
  if (outputDirectory) {
    const temporaryPath = `${rawPath}.${process.pid}.part`;
    let temporaryCreated = false;
    let temporaryFile = null;
    try {
      temporaryFile = await open(temporaryPath, "wx");
      temporaryCreated = true;
      await temporaryFile.writeFile(files[0].data);
      await temporaryFile.sync();
      await temporaryFile.close();
      temporaryFile = null;
      await link(temporaryPath, rawPath);
      temporaryCreated = false;
      await unlink(temporaryPath).catch(() => {});
    } catch (error) {
      await temporaryFile?.close().catch(() => {});
      if (temporaryCreated) await unlink(temporaryPath).catch(() => {});
      throw error;
    }
  } else {
    await writeFile(rawPath, files[0].data);
  }
  const info = await stat(rawPath);
  if (!info.isFile() || info.size === 0 || info.size !== files[0].data.length) {
    if (outputDirectory) await unlink(rawPath).catch(() => {});
    throw new Error(`${mediaKind === "video" ? "Video" : "Ảnh"} giải nén từ BrowserOS rỗng hoặc không ổn định`);
  }
  return { rawPath, sourceName: files[0].name, sizeBytes: info.size };
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
    // Flow keeps the SHOT/REVISION/RUN identity in <flow-batch-info>, while
    // its toolbar controls are rendered in the surrounding batch container.
    // Searching only inside the metadata element falsely reported that the
    // direct Download button was missing even when the fresh snapshot exposed
    // a scoped "Download batch" ref.
    const scopes = [];
    let scope = batch.closest?.('.batch-container') || batch;
    for (let level = 0; scope && level < 4; level += 1, scope = scope.parentElement) {
      if (!scopes.includes(scope)) scopes.push(scope);
    }
    let button = null;
    const controlValue = (node) => (text(node) + ' ' + (node.getAttribute?.('aria-label') || '') + ' ' + (node.getAttribute?.('title') || '')).replace(/\s+/g, ' ').trim();
    const isExactDownloadControl = (node) => /^(?:download(?: batch| media)?|download image|download video|tải xuống|tải ảnh|tải video)$/i.test(controlValue(node));
    const isInteractive = (node) => node.tagName?.toLowerCase() === 'button'
      || node.getAttribute?.('role') === 'button'
      || node.hasAttribute?.('aria-label')
      || node.hasAttribute?.('title')
      || node.hasAttribute?.('tabindex')
      || typeof node.onclick === 'function';
    const findDownloadControl = (root) => {
      const nodes = deepElements(root).filter((node) => visible(node));
      const direct = nodes.find((candidate) => isInteractive(candidate) && isExactDownloadControl(candidate));
      if (direct) return { node: direct, clickMethod: 'browseros_dom_exact_batch' };
      // Flow sometimes renders the toolbar as icon-only divs. The
      // accessibility tree calls that control "Download batch", while the
      // DOM exposes only a <mat-icon>download</mat-icon> without role/label.
      // Restrict this fallback to the exact download icon inside the already
      // identity-matched batch; never search the page globally.
      const icon = nodes.find((candidate) => {
        const value = text(candidate).toLowerCase();
        const className = String(candidate.className || '').toLowerCase();
        return /^(?:download|file_download|download_for_offline|save_alt)$/.test(value)
          || (className.includes('download') && /icon|button|control/.test(className));
      });
      if (!icon) return null;
      let target = icon;
      for (let level = 0; level < 4 && target; level += 1, target = target.parentElement) {
        if (isExactDownloadControl(target) || isInteractive(target)) return { node: target, clickMethod: 'browseros_dom_download_icon' };
      }
      return { node: icon, clickMethod: 'browseros_dom_download_icon' };
    };
    for (const root of scopes) {
      const found = findDownloadControl(root);
      if (found) {
        button = found.node;
        button.dataset.auto3dvideoDownloadClickMethod = found.clickMethod;
        break;
      }
    }
    if (!button) {
      const diagnostics = scopes.map((root, index) => ({
        index,
        tag: root.tagName?.toLowerCase() || root.nodeName || 'root',
        className: String(root.className || '').slice(0, 120),
        controls: deepElements(root)
          .filter((node) => visible(node))
          .map((node) => {
            const label = (text(node) + ' ' + (node.getAttribute?.('aria-label') || '') + ' ' + (node.getAttribute?.('title') || '')).replace(/\s+/g, ' ').trim();
            return {
              tag: node.tagName?.toLowerCase() || '',
              role: node.getAttribute?.('role') || '',
              className: String(node.className || '').slice(0, 120),
              aria: node.getAttribute?.('aria-label') || '',
              title: node.getAttribute?.('title') || '',
              text: text(node).slice(0, 120),
              label: label.slice(0, 180),
              tabIndex: node.getAttribute?.('tabindex') || '',
              onclick: typeof node.onclick === 'function',
            };
          })
          .filter((item) => /download|trash|reuse|expand|tải|lưu|xoá|xóa/i.test(item.label + ' ' + item.className))
          .slice(0, 80),
      }));
      return { found: true, clicked: false, reason: 'Batch đúng shot/revision chưa có nút Download hiển thị. scope=' + JSON.stringify(diagnostics).slice(0, 1800) };
    }
    button.scrollIntoView({ block: 'center', inline: 'center' });
    if (!visible(button)) return { found: true, clicked: false, reason: 'Nút Download batch không còn hiển thị.' };
    const clickMethod = button.dataset?.auto3dvideoDownloadClickMethod || 'browseros_dom_exact_batch';
    // Mark the exact identity-scoped control so the BrowserOS download tool
    // can receive a fresh accessibility ref. A raw DOM .click() can report
    // success without producing a native browser download in Flow.
    const marker = 'auto3dvideo-exact-download-batch';
    button.setAttribute('data-auto3dvideo-download-target', marker);
    button.setAttribute('aria-label', 'Auto3DVideo exact Download batch');
    if (!button.getAttribute('role') && button.tagName?.toLowerCase() !== 'button') button.setAttribute('role', 'button');
    return { found: true, clicked: false, prepared: true, clickMethod, marker, buttonLabel: 'Auto3DVideo exact Download batch' };
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
        .find((candidate) => visible(candidate) && /^(?:download|download media|download image|download video|tải xuống|tải ảnh|tải video)$/i.test((
          text(candidate) + ' ' + (candidate.getAttribute('aria-label') || '') + ' ' + (candidate.getAttribute('title') || '')
        ).replace(/\s+/g, ' ').trim()));
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
    // Counts travel with the answer so an explicit shot binding can refuse a
    // duplicated or hidden media ID instead of silently using the first match.
    const matchCount = mediaNodes.length;
    const visibleCount = mediaNodes.filter((node) => visible(node)).length;
    const media = mediaNodes.find((node) => visible(node)) || mediaNodes[0];
    if (!media) return { found: false, clicked: false, matchCount, visibleCount, reason: 'Không tìm thấy media ID mới để mở More options.' };
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
      return { found: true, clicked: false, matchCount, visibleCount, needsClick: true, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, mediaRect: { x: mediaRect.x, y: mediaRect.y, width: mediaRect.width, height: mediaRect.height }, clickMethod: 'browseros_coordinate_exact_media_more_options' };
    }
    return { found: true, clicked: false, matchCount, visibleCount, needsHover: true, rect: { x: mediaRect.x, y: mediaRect.y, width: mediaRect.width, height: mediaRect.height }, reason: 'More options của card chỉ hiện khi hover media.' };
  })();`;
}

function newestMediaOptionsCode() {
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
    const roots = [document];
    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      for (const node of root.querySelectorAll ? root.querySelectorAll('*') : []) if (node.shadowRoot) roots.push(node.shadowRoot);
    }
    const tiles = roots.flatMap((root) => [...(root.querySelectorAll ? root.querySelectorAll('flow-grid-tile-container') : [])])
      .filter(visible);
    const candidates = tiles.map((tile) => {
      const media = deepElements(tile).filter((node) => {
        const tag = node.tagName?.toLowerCase();
        const rect = node.getBoundingClientRect();
        return visible(node) && (tag === 'img' || tag === 'video') && rect.width >= 160 && rect.height >= 90;
      }).at(-1);
      return media ? { tile, media } : null;
    }).filter(Boolean);
    const selected = candidates.at(-1);
    if (!selected) return { found: false, clicked: false, reason: 'Không tìm thấy tile media mới nhất trong Flow grid.' };
    const media = selected.media;
    media.scrollIntoView?.({ block: 'center', inline: 'center' });
    const mediaRect = media.getBoundingClientRect();
    let scope = selected.tile;
    for (let level = 0; level < 8 && scope; level += 1, scope = scope.parentElement) {
      const button = deepElements(scope)
        .filter((node) => node.tagName?.toLowerCase() === 'button' || node.getAttribute?.('role') === 'button')
        .find((candidate) => visible(candidate) && /more options|tùy chọn khác|thêm tùy chọn/i.test(
          String(candidate.innerText || candidate.textContent || '') + ' ' + (candidate.getAttribute('aria-label') || '') + ' ' + (candidate.getAttribute('title') || '')
        ));
      if (!button) continue;
      button.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = button.getBoundingClientRect();
      return {
        found: true,
        clicked: false,
        needsClick: true,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        mediaRect: { x: mediaRect.x, y: mediaRect.y, width: mediaRect.width, height: mediaRect.height },
        sourceMediaId: media.getAttribute('data-media-id') || media.getAttribute('data-mediaid') || null,
        clickMethod: 'browseros_coordinate_newest_media_tile',
      };
    }
    return {
      found: true,
      clicked: false,
      needsHover: true,
      rect: { x: mediaRect.x, y: mediaRect.y, width: mediaRect.width, height: mediaRect.height },
      mediaRect: { x: mediaRect.x, y: mediaRect.y, width: mediaRect.width, height: mediaRect.height },
      sourceMediaId: media.getAttribute('data-media-id') || media.getAttribute('data-mediaid') || null,
      reason: 'More options của tile mới nhất chỉ hiện khi hover media.',
    };
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
    const describe = (chip) => {
      const image = ([chip, ...all.filter((node) => chip.contains?.(node))].find((node) => node.tagName?.toLowerCase() === 'img') || null);
      return {
        mediaId: String(image?.getAttribute?.('data-media-id') || image?.getAttribute?.('data-mediaid') || chip?.getAttribute?.('data-media-id') || chip?.getAttribute?.('data-mediaid') || ''),
        source: String(image?.currentSrc || image?.src || '').slice(0, 1200),
      };
    };
    // Every visible chip is reported. An explicit binding must see the whole
    // ingredient set, because a second chip means the composer is holding a
    // different image even when the first one happens to look right.
    const describedChips = chips.map(describe);
    const [chip] = describedChips;
    const source = chip?.source || '';
    const sourceMediaId = chip?.mediaId || '';
    const referenceAttached = Boolean(chip && ((source && mediaId && source.includes(mediaId)) || (sourceMediaId && sourceMediaId === mediaId)));
    return {
      editorFound: Boolean(editor),
      ingredientCount: chips.length,
      chips: describedChips,
      referenceAttached,
      sourceMediaId: sourceMediaId || (referenceAttached ? mediaId : null),
      chipSource: source,
    };
  })();`;
}

function exactMediaAssetCode(mediaId) {
  const mediaToken = JSON.stringify(mediaId);
  return `return (async () => {
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
    // Flow frequently renders the image from a cross-origin CDN. In that
    // case canvas is intentionally tainted even though the browser can fetch
    // the exact authenticated resource. Read that resource in the page
    // context so the worker can persist the actual image without relying on
    // BrowserOS's native-download event (which is not exposed by every bridge).
    try {
      const response = await fetch(source, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) return { found: true, reason: 'Media đúng ID nhưng CDN trả HTTP ' + response.status + '.' };
      const mime = String(response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
      if (!/^image\\/(?:png|jpeg|webp)$/i.test(mime)) return { found: true, reason: 'Media đúng ID nhưng MIME không phải PNG/JPEG/WebP.' };
      const buffer = await response.arrayBuffer();
      if (!buffer.byteLength || buffer.byteLength > 16 * 1024 * 1024) return { found: true, reason: 'Media đúng ID nhưng kích thước ảnh vượt giới hạn.' };
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
      }
      return { found: true, mime, base64: btoa(binary), sourceKind: 'authenticated_fetch' };
    } catch (_) {
      return { found: true, reason: 'Media đúng ID chưa đọc được pixels trực tiếp từ canvas hoặc fetch.' };
    }
  })();`;
}

// Read-only, bounded discovery of the image cards Flow currently shows in the
// pinned project. It clicks nothing, navigates nowhere, and returns only
// stable media IDs, a sanitized label and a small canvas thumbnail. A card the
// page cannot read pixels for stays unselectable, so an unreadable thumbnail
// blocks a manual comparison instead of showing an empty box.
function flowImageCardsCode(limit) {
  const limitToken = JSON.stringify(limit);
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
    const limit = ${limitToken};
    const mediaNodes = deepElements(document).filter((node) => {
      const tag = node.tagName?.toLowerCase();
      return visible(node)
        && tag === 'img'
        && (node.getAttribute('data-media-id') || node.getAttribute('data-mediaid'));
    });
    const cards = [];
    for (const media of mediaNodes) {
      if (cards.length >= limit) break;
      let label = '';
      for (let scope = media, depth = 0; scope && depth < 6; depth += 1, scope = scope.parentElement) {
        const candidate = text(scope);
        if (!candidate) continue;
        if (candidate.length <= 160) { label = candidate; break; }
        if (!label) label = candidate;
      }
      const card = {
        mediaId: media.getAttribute('data-media-id') || media.getAttribute('data-mediaid') || '',
        label: label.slice(0, 160),
        preview: null,
        previewNote: '',
        selectable: true,
      };
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = 96;
        canvas.getContext('2d').drawImage(media, 0, 0, 96, 96);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        if (dataUrl.startsWith('data:image/jpeg;base64,')) card.preview = dataUrl;
      } catch (_) {
        // Cross-origin cards taint the canvas; that is reported, not hidden.
      }
      if (!card.preview) {
        card.previewNote = 'Card ảnh không đọc được thumbnail trong project này.';
        card.selectable = false;
      }
      cards.push(card);
    }
    return { found: cards.length > 0, visibleMediaCount: mediaNodes.length, cards };
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

function downloadedBrowserOsZipPath(result) {
  return contentText(result)
    .match(/Downloaded\s+"[^"]+"\s+to:\s*([^\r\n]+?\.zip)\s*(?:\r?\n|$)/i)?.[1]
    ?.trim() || null;
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

function findFlowPromptRef(refs) {
  const normalized = refs.map((item, index) => ({
    item,
    index,
    role: String(item.role || '').toLowerCase(),
    label: String(item.label || '').trim().toLowerCase(),
  }));
  const addIngredientsIndex = normalized.findIndex(({ label }) =>
    (label.includes('add ingredients') && label.includes('prompt'))
    || label.includes('thêm thành phần vào ô nhập câu lệnh')
    || (label.includes('thành phần') && label.includes('câu lệnh')),
  );
  const imageModeIndex = normalized.findIndex(({ label }) =>
    /nano banana|image generation|image generator|create image|generate image|tạo ảnh|hình ảnh|bạn muốn thay đổi gì/.test(label),
  );
  const candidates = normalized.map((entry) => {
    const { item, index, role, label } = entry;
    if (label === 'editable text' || /^(search|filter|find|address|url|email|title|name)$/.test(label)) return { item, score: -1 };
    const isTextInput = /textbox|textarea|input|contenteditable/.test(role);
    const isGenericComposer = /paragraph|generic/.test(role)
      && /^(paragraph|generic)$/.test(label)
      && addIngredientsIndex > index
      && addIngredientsIndex - index <= 2;
    const nearPromptControls = addIngredientsIndex >= 0 && Math.abs(addIngredientsIndex - index) <= 16;
    const nearImageMode = imageModeIndex >= 0 && Math.abs(imageModeIndex - index) <= 10;
    const explicitPrompt = /prompt|describe|what do you want|what would you like|bạn muốn thay đổi gì|ô nhập câu lệnh|câu lệnh|nano banana|tạo ảnh|image/.test(label);
    if (!isTextInput && !isGenericComposer && !explicitPrompt) return { item, score: -1 };
    if (!explicitPrompt && !isGenericComposer && !nearPromptControls && !nearImageMode) return { item, score: -1 };
    let score = isGenericComposer ? 30 : nearPromptControls ? 22 : nearImageMode ? 20 : 12;
    if (explicitPrompt) score += 16;
    return { item, score };
  });
  return candidates
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)[0]?.item || null;
}

const normalizePromptText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

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
  const generatedText = (node) => {
    const pseudo = (selector) => {
      try {
        const value = getComputedStyle(node, selector).content;
        return value && value !== 'none' && value !== 'normal' ? value.replace(/^["']|["']$/g, '') : '';
      } catch {
        return '';
      }
    };
    return [text(node), node?.textContent || '', node?.getAttribute?.('aria-label') || '', node?.getAttribute?.('title') || '', pseudo('::before'), pseudo('::after')]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  };
  const editor = all.find((node) => visible(node) && node.matches?.('flow-rich-text-editor.prompt-input div.ProseMirror[contenteditable="true"]'));
  const controlText = (node) => generatedText(node);
  const controls = all.filter((node) => visible(node) && (node.matches?.('button,[role="button"], [aria-label], [title]')));
  const priceContexts = new Set();
  const creditPattern = /\b(?:\d{1,3}(?:,\d{3})*|\d+)\s*(?:credits?|tín\s+dụng)\b/i;
  const priceCandidates = new Set([...all.filter((node) => !node.children?.length), ...controls]);
  for (const node of priceCandidates) {
    const ownText = generatedText(node);
    if (!creditPattern.test(ownText) || !visible(node)) continue;
    let current = node;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      const value = controlText(current);
      if (value.length <= 320 && /(?:cost|price|generate|video|tốn|giá)/i.test(value) && creditPattern.test(value)) {
        priceContexts.add(value.slice(0, 320));
      }
    }
  }
  const selectedSettingsEvidence = all
    .filter((node) => node.matches?.('[role="radio"],[role="option"],input[type="radio"],button,[role="button"]') && visible(node))
    .filter((node) => node.matches?.(':checked')
      || node.getAttribute?.('aria-checked') === 'true'
      || node.getAttribute?.('aria-selected') === 'true'
      || node.getAttribute?.('aria-pressed') === 'true'
      || node.getAttribute?.('data-state') === 'checked'
      || node.getAttribute?.('data-state') === 'active')
    .map((node) => controlText(node).slice(0, 240))
    .filter((label) => /(?:16:9|9:16|1:1|360p|720p|1080p|\b\d+\s*(?:s|sec(?:onds?)?|giây)\b)/i.test(label))
    .filter((label, index, labels) => labels.indexOf(label) === index)
    .slice(0, 8);
  const exactImageEditor = Boolean(editor && editor.matches?.('flow-rich-text-editor.prompt-input div.ProseMirror[contenteditable="true"]'));
  const generationControl = controls.find((node) => {
    if (!node.matches?.('button,[role="button"]')) return false;
    const value = controlText(node).toLowerCase();
    return /^(?:start generation|generate image|generate|tạo ảnh)$/.test(value)
      && !/chat|assistant|video/.test(value);
  });
  const generationButton = generationControl && !generationControl.disabled && generationControl.getAttribute?.('aria-disabled') !== 'true'
    ? generationControl
    : null;
  const editorRect = editor?.getBoundingClientRect();
  const videoArrowCandidates = controls.filter((node) => {
    if (!node.matches?.('button,[role="button"]')) return false;
    const label = controlText(node).toLowerCase();
    if (!/\b(?:arrow_forward|send|submit)\b/.test(label) || /chat|assistant/.test(label) || !editorRect) return false;
    const rect = node.getBoundingClientRect();
    return rect.right >= editorRect.right - 80
      && rect.right <= editorRect.right + 48
      && rect.top >= editorRect.top - 40
      && rect.top <= editorRect.bottom + 100;
  });
  const textVideoGenerateControl = controls.find((node) => node.matches?.('button,[role="button"]')
    && /^(?:start generation|generate video|generate|bắt đầu tạo|tạo video)$/i.test(controlText(node)));
  const videoGenerationControl = textVideoGenerateControl
    || (videoArrowCandidates.length === 1 ? videoArrowCandidates[0] : null);
  const videoGenerateButton = videoGenerationControl && !videoGenerationControl.disabled && videoGenerationControl.getAttribute?.('aria-disabled') !== 'true'
    ? videoGenerationControl
    : null;
  const addIngredients = controls.find((node) => {
    const value = controlText(node).toLowerCase();
    return /add ingredients to the prompt box|thêm thành phần vào ô nhập câu lệnh|thành phần.*câu lệnh/.test(value);
  });
  const settingsTrigger = controls.find((node) => {
    const value = controlText(node).toLowerCase();
    const aria = String(node.getAttribute?.('aria-label') || '').toLowerCase();
    return aria.includes('settings trigger') || value.includes('agent settings') || aria === 'settings' || value === 'settings';
  });
  const videoPicker = controls.find((node) => node.matches?.('button,[role="button"],[role="combobox"]')
    && /\b(?:omni\s+1\.1\s+flash|veo(?:\s+\d[\w.]*)?)\b/i.test(controlText(node)));
  const picker = videoPicker
    || controls.find((node) => node.matches?.('button[aria-label="Image generation default model"], [role="button"][aria-label="Image generation default model"]'))
    || controls.find((node) => /image generation default model/i.test(controlText(node)))
    || controls.find((node) => /nano banana(?:\s+pro|\s+2|\s+2\s+lite)?/i.test(controlText(node)));
  const selectedModel = controlText(picker);
  const videoModeFound = Boolean(videoPicker);
  const videoComposerReady = Boolean(videoModeFound && editor && videoGenerationControl);
  const currentUrl = String(location?.href || '').split(/[?#]/, 1)[0];
  const projectKey = currentUrl.match(/\/project\/([A-Za-z0-9-]+)/i)?.[1] || '';
  const composerFingerprint = [
    exactImageEditor ? 'image-editor' : '',
    addIngredients ? 'ingredients' : '',
    generationControl ? 'generate' : '',
    /Nano Banana Pro/i.test(selectedModel) ? 'nano-banana-pro' : '',
    /Omni 1\.1 Flash/i.test(selectedModel) ? 'video-omni-1-1-flash' : '',
  ].filter(Boolean).join('|');
  return {
    composerFound: Boolean(editor || picker),
    promptEditorFound: Boolean(editor),
    exactImageEditorFound: exactImageEditor,
    settingsTriggerFound: Boolean(settingsTrigger),
    // The image composer requires image-only controls; a selected video
    // model is a separate proof and must not be inferred from chat text.
    generationButtonFound: Boolean(generationControl),
    generationButtonEnabled: Boolean(generationButton),
    addIngredientsFound: Boolean(addIngredients),
    imageModeFound: Boolean(!videoModeFound && (picker && !videoPicker || (exactImageEditor && generationControl && addIngredients))),
    videoModeFound,
    videoComposerReady,
    videoGenerateButtonFound: Boolean(videoGenerationControl),
    videoGenerateButtonEnabled: Boolean(videoGenerateButton),
    videoGenerateButtonCandidateCount: textVideoGenerateControl ? 1 : videoArrowCandidates.length,
    videoGenerateButtonLabel: videoGenerationControl ? controlText(videoGenerationControl).slice(0, 120) : '',
    selectedModel: selectedModel.slice(0, 240),
    visibleCreditTexts: [...priceContexts],
    selectedSettingsEvidence,
    promptText: editor ? text(editor).slice(0, 12_000) : '',
    currentUrl,
    projectKey,
    composerFingerprint,
  };
})();`;

const openVideoModelPickerCode = (expectedProjectId) => String.raw`
return (() => {
  const visible = (node) => {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const controlText = (node) => [text(node), node?.getAttribute?.('aria-label') || '', node?.getAttribute?.('title') || ''].join(' ').replace(/\s+/g, ' ').trim();
  const currentUrl = String(location?.href || '').split(/[?#]/, 1)[0];
  const projectKey = currentUrl.match(/\/project\/([A-Za-z0-9-]+)/i)?.[1] || '';
  if (projectKey !== ${JSON.stringify(expectedProjectId)}) {
    return { status: 'blocked', reason: 'project-mismatch', projectKey };
  }
  const candidates = [...document.querySelectorAll('button,[role="button"],[role="combobox"]')]
    .filter((node) => visible(node) && /\bNano Banana 2\b/i.test(controlText(node)))
    .filter((node) => !/\b(?:generate|start generation|bắt đầu tạo|tạo ảnh|tạo video|trash|delete|download|upload)\b/i.test(controlText(node)));
  if (candidates.length !== 1) {
    return {
      status: 'blocked',
      reason: 'model-picker-not-unique',
      matches: candidates.length,
      projectKey,
      labels: candidates.map((node) => controlText(node).slice(0, 160)),
    };
  }
  const target = candidates[0];
  if (target.disabled || target.getAttribute('aria-disabled') === 'true') {
    return { status: 'blocked', reason: 'model-picker-disabled', projectKey };
  }
  const controlLabel = controlText(target).slice(0, 160);
  target.click();
  return { status: 'opened', projectKey, controlLabel, tagName: target.tagName.toLowerCase() };
})();
`;

const openVideoSettingsCode = (expectedProjectId) => String.raw`
return (() => {
  const visible = (node) => {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const currentUrl = String(location?.href || '').split(/[?#]/, 1)[0];
  const projectKey = currentUrl.match(/\/project\/([A-Za-z0-9-]+)/i)?.[1] || '';
  if (projectKey !== ${JSON.stringify(expectedProjectId)}) {
    return { status: 'blocked', reason: 'project-mismatch', projectKey };
  }
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
  const controlText = (node) => [text(node), node?.getAttribute?.('aria-label') || '', node?.getAttribute?.('title') || ''].join(' ').replace(/\s+/g, ' ').trim();
  const editor = all.find((node) => visible(node) && node.matches?.('flow-rich-text-editor.prompt-input div.ProseMirror[contenteditable="true"]'));
  if (!editor) {
    return { status: 'blocked', reason: 'video-prompt-editor-not-found', projectKey, promptEditorFound: false };
  }
  const controls = all.filter((node) => visible(node) && node.matches?.('button,[role="button"],[role="combobox"],[role="radio"],[role="link"]'));
  const controlLabels = controls.map(controlText);
  const visibleControlText = controlLabels.join(' ');
  const alreadyOpen =
    /\bvideo\b/i.test(visibleControlText)
    && /\b(?:360p|720p|1080p)\b/i.test(visibleControlText)
    && /\b(?:4|6|8|10)\s*(?:s|sec(?:onds?)?|giây)\b/i.test(visibleControlText)
    && /\b(?:omni|veo)\b/i.test(visibleControlText)
    && all.some((node) => visible(node) && /\b\d+\s*(?:tín\s+dụng|credits?)\b/i.test(controlText(node)));
  if (alreadyOpen) {
    return { status: 'opened', projectKey, alreadyOpen: true, message: 'Video settings are already visible; left the current model, settings and price unchanged.' };
  }
  const settings = controls.filter((node) => {
    const label = [text(node), node.getAttribute('aria-label') || '', node.getAttribute('title') || ''].join(' ').replace(/\s+/g, ' ').trim();
    const aria = String(node.getAttribute('aria-label') || '').toLowerCase();
    const settingsTrigger = /settings trigger|điều kiện kích hoạt cài đặt|cài đặt/i.test(aria);
    const videoMode = /\bvideo\b/i.test(text(node));
    const hasQuality = /\b(?:360p|720p|1080p)\b/i.test(text(node));
    const hasDuration = /\b(?:4|6|8|10)\s*(?:s|sec(?:onds?)?|giây)\b/i.test(text(node));
    return settingsTrigger && videoMode && hasQuality && hasDuration
      && !/\b(?:generate|trash|delete|remove|download|upload)\b/i.test(label);
  });
  if (settings.length !== 1) {
    return {
      status: 'blocked',
      reason: 'video-settings-control-not-unique',
      projectKey,
      matches: settings.length,
      controls: controls.map((node) => ({
        text: text(node).slice(0, 120),
        ariaLabel: String(node.getAttribute('aria-label') || '').slice(0, 120),
        title: String(node.getAttribute('title') || '').slice(0, 120),
      })).filter((item) => /video|720p|1080p|8\s*(?:s|sec|giây)|settings|cài đặt/i.test(item.text + ' ' + item.ariaLabel + ' ' + item.title)).slice(0, 12),
    };
  }
  const target = settings[0];
  if (target.disabled || target.getAttribute('aria-disabled') === 'true') {
    return { status: 'blocked', reason: 'video-settings-control-disabled', projectKey };
  }
  const controlLabel = [text(target), target.getAttribute('aria-label') || '', target.getAttribute('title') || '']
    .join(' ').replace(/\s+/g, ' ').trim().slice(0, 240);
  target.click();
  return { status: 'opened', projectKey, controlLabel, message: 'Opened the exact visible Video settings control; no model/settings were changed and no prompt or Generate action was sent.' };
})();
`;

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
  const popupRoots = all.filter((node) => visible(node)
    && (node.matches?.('[role="menu"],[role="listbox"],[role="dialog"],mat-menu,mat-select-panel,.cdk-overlay-pane')
      || /menu|listbox|dialog|overlay/i.test(String(node.className || ''))));
  const popupNodes = popupRoots.flatMap((root) => [root, ...all.filter((node) => root.contains?.(node))]);
  const optionPool = [...new Set([...popupNodes, ...all])];
  const option = optionPool.find((node) => visible(node)
    && (node.matches?.('button,[role="menuitem"],[role="option"],mat-option,[data-value]'))
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
  if (!target) {
    const candidates = optionPool
      .filter((node) => visible(node) && text(node).toLowerCase().includes(model.toLowerCase()))
      .map((node) => ({
        tag: node.tagName?.toLowerCase() || '',
        role: node.getAttribute?.('role') || '',
        text: controlText(node).slice(0, 180),
      }))
      .slice(0, 12);
    return { found: false, clicked: false, kind, candidates, reason: 'DOM không tìm thấy control Flow an toàn cho bước này.' };
  }
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
    for (let depth = 0; current && depth < 10; depth += 1) {
      const value = text(current);
      if (value) contexts.push(value);
      current = current.parentElement || current.getRootNode?.()?.host || null;
    }
    const exactRunContext = requestedRun
      ? contexts.find((value) => value.includes(requestedShot) && value.includes(requestedRevision) && value.includes(requestedRun))
      : null;
    const identityContext = contexts.find((value) => /SHOT[-_ ]?\d{3}/i.test(value) && /REV(?:ISION)?[-_ ]?\d{3}/i.test(value));
    const shotContext = contexts.find((value) => /SHOT[-_ ]?\d{3}/i.test(value) || (shotLabelPattern && shotLabelPattern.test(value)));
    return (exactRunContext || identityContext || shotContext || contexts[0] || '').slice(0, 1400);
  };
  const hasVideoSettings = (value) => /\bOmni\s+1\.1\s+Flash\b/i.test(value)
    && /\b(?:360p|720p|1080p)\b/i.test(value)
    && /\b(?:16:9|9:16|1:1)\b/.test(value)
    && /(?:^|\b)(?:4|6|8|10)\s*(?:s|sec(?:onds?)?|giây)(?=\s|$|[.,|·])/i.test(value);
  const videoOutputContext = (node) => {
    for (let current = node, depth = 0; current && depth < 10; current = current.parentElement || current.getRootNode?.()?.host || null, depth += 1) {
      const value = text(current);
      if (!value.includes(requestedShot) || !value.includes(requestedRevision) || !value.includes(requestedRun) || !hasVideoSettings(value)) continue;
      const contained = mediaNodes.filter((candidate) => current.contains(candidate));
      const ids = [...new Set(contained.map((candidate) => candidate.getAttribute('data-media-id') || candidate.getAttribute('data-mediaid') || '').filter(Boolean))];
      if ((ids.length > 0 ? ids.length : contained.length) === 1) return value.slice(0, 1400);
    }
    return '';
  };
  const isVideoOutputMedia = (node) => node.tagName?.toLowerCase() === 'video' || Boolean(videoOutputContext(node));
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
  const matchingBatchVideoMedia = matchingMedia.filter(isVideoOutputMedia);
  const matchingBatchVideoMediaIds = [...new Set(matchingBatchVideoMedia
    .map((node) => node.getAttribute('data-media-id') || node.getAttribute('data-mediaid') || '')
    .filter(Boolean))];
  const matchingBatchVideoMediaCount = matchingBatchVideoMediaIds.length > 0 ? matchingBatchVideoMediaIds.length : matchingBatchVideoMedia.length;
  const matchingPromptMedia = requestedShot && requestedRevision && requestedRun
    ? mediaNodes.filter((node) => {
      const context = mediaContext(node);
      return context.includes(requestedShot) && context.includes(requestedRevision) && context.includes(requestedRun);
    })
    : [];
  const matchingPromptMediaIds = [...new Set(matchingPromptMedia
    .map((node) => node.getAttribute('data-media-id') || node.getAttribute('data-mediaid') || '')
    .filter(Boolean))];
  const matchingPromptMediaCount = matchingPromptMedia.length;
  const matchingPromptVideoMedia = matchingPromptMedia.filter(isVideoOutputMedia);
  const matchingPromptVideoMediaIds = [...new Set(matchingPromptVideoMedia
    .map((node) => node.getAttribute('data-media-id') || node.getAttribute('data-mediaid') || '')
    .filter(Boolean))];
  const matchingPromptVideoMediaCount = matchingPromptVideoMediaIds.length > 0 ? matchingPromptVideoMediaIds.length : matchingPromptVideoMedia.length;
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
  const exactImageEditor = all.find((node) => visible(node) && node.matches?.('flow-rich-text-editor.prompt-input div.ProseMirror[contenteditable="true"]'));
  const composerControls = all.filter((node) => visible(node) && node.matches?.('button,[role="button"],[aria-label],[title]'));
  const controlText = (node) => [text(node), node?.getAttribute?.('aria-label') || '', node?.getAttribute?.('title') || ''].join(' ').replace(/\s+/g, ' ').trim();
  const generationButton = composerControls.find((node) => {
    if (!node.matches?.('button,[role="button"]') || node.disabled || node.getAttribute?.('aria-disabled') === 'true') return false;
    const value = controlText(node).toLowerCase();
    return /^(?:start generation|generate image|generate|tạo ảnh)$/.test(value) && !/chat|assistant|video/.test(value);
  });
  const addIngredients = composerControls.find((node) => /add ingredients to the prompt box|thêm thành phần vào ô nhập câu lệnh|thành phần.*câu lệnh/i.test(controlText(node)));
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
  const picker = all.find((node) => visible(node) && node.matches?.('button[aria-label="Image generation default model"]'))
    || composerControls.find((node) => /nano banana(?:\s+pro|\s+2|\s+2\s+lite)?/i.test(controlText(node)));
  const exactImageComposerFound = Boolean(exactImageEditor && generationButton && addIngredients);
  return {
    mediaCount: media.length,
    mediaIds: [...new Set(media.map((item) => item.mediaId).filter(Boolean))],
    historicalShotMediaIds,
    historicalShotMediaCount: historicalShotMediaIds.length,
    matchingBatchCount: matching.length,
    matchingBatchMediaCount,
    matchingPromptMediaCount,
    matchingPromptMediaIds,
    matchingBatchVideoMediaCount,
    matchingBatchVideoMediaIds,
    matchingPromptVideoMediaCount,
    matchingPromptVideoMediaIds,
    matchingBatchMediaIds,
    shotRevisionBatchCount: shotRevisionMatching.length,
    shotRevisionBatchMediaCount,
    shotRevisionBatchMediaIds,
    generatedMessageCount,
    assistantClaimsGenerated: generatedMessageCount > 0,
    generationActive,
    downloadControlFound,
    selectedModel: picker ? controlText(picker) : '',
    composerFound: Boolean(exactImageEditor || picker),
    promptEditorFound: Boolean(exactImageEditor),
    exactImageEditorFound: Boolean(exactImageEditor),
    generationButtonFound: Boolean(generationButton),
    addIngredientsFound: Boolean(addIngredients),
    imageModeFound: Boolean(picker || exactImageComposerFound),
  };
})();`;

const downloadVideoOutputCode = (expectedProjectId, shotId, revisionId, runId) => String.raw`
return (() => {
  const requestedShot = ${JSON.stringify(shotId)};
  const requestedRevision = ${JSON.stringify(revisionId)};
  const requestedRun = ${JSON.stringify(runId)};
  const expectedProjectId = ${JSON.stringify(expectedProjectId)};
  const currentProjectId = String(location?.href || '').match(/\/project\/([A-Za-z0-9-]+)/i)?.[1] || '';
  if (!expectedProjectId || currentProjectId !== expectedProjectId) {
    return { status: 'blocked', downloadClicked: false, message: 'Project Flow hiện tại không khớp project đã chọn.' };
  }
  const visible = (node) => {
    const rect = node?.getBoundingClientRect?.();
    const style = node && getComputedStyle(node);
    return Boolean(rect?.width > 0 && rect?.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden');
  };
  const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const roots = [];
  const visit = (root) => {
    if (!root || roots.includes(root)) return;
    roots.push(root);
    for (const node of root.querySelectorAll ? root.querySelectorAll('*') : []) if (node.shadowRoot) visit(node.shadowRoot);
  };
  visit(document);
  const all = roots.flatMap((root) => [...(root.querySelectorAll ? root.querySelectorAll('*') : [])]);
  const parentOf = (node) => node?.parentElement || node?.getRootNode?.()?.host || null;
  const within = (node, ancestor) => {
    for (let current = node, depth = 0; current && depth < 20; current = parentOf(current), depth += 1) {
      if (current === ancestor) return true;
    }
    return false;
  };
  const mediaNodes = all.filter((node) => (node.tagName?.toLowerCase() === 'img' || node.tagName?.toLowerCase() === 'video') && visible(node));
  const hasVideoSettings = (value) => /\bOmni\s+1\.1\s+Flash\b/i.test(value)
    && /\b(?:360p|720p|1080p)\b/i.test(value)
    && /\b(?:16:9|9:16|1:1)\b/.test(value)
    && /(?:^|\b)(?:4|6|8|10)\s*(?:s|sec(?:onds?)?|giây)(?=\s|$|[.,|·])/i.test(value);
  const batches = all.filter((node) => node.tagName?.toLowerCase() === 'flow-batch-info'
    && text(node).includes(requestedShot) && text(node).includes(requestedRevision) && text(node).includes(requestedRun));
  if (batches.length !== 1) {
    return { status: 'blocked', downloadClicked: false, message: 'Flow output batch match count is not exactly one: ' + batches.length };
  }
  const batchText = text(batches[0]);
  const hasExactBatchIdentity = (value) => value.includes(requestedShot) && value.includes(requestedRevision) && value.includes(requestedRun);
  let card = null;
  let video = null;
  let outputHasVideoSettings = false;
  for (let current = parentOf(batches[0]), depth = 0; current && depth < 10; current = parentOf(current), depth += 1) {
    const contextText = text(current);
    const containedMedia = mediaNodes.filter((node) => within(node, current));
    if (containedMedia.length === 1 && (hasVideoSettings(batchText) || hasVideoSettings(contextText))) {
      card = current;
      video = containedMedia[0];
      outputHasVideoSettings = true;
      break;
    }
  }
  if (!card || !video || !hasExactBatchIdentity(batchText) || !outputHasVideoSettings) {
    return { status: 'blocked', downloadClicked: false, message: 'Exact Flow output card lacks one media item or verified video settings.' };
  }
  const videoOutputContext = (node) => node.tagName?.toLowerCase() === 'video'
    || (node.tagName?.toLowerCase() === 'img' && outputHasVideoSettings);
  if (!videoOutputContext(video)) {
    return { status: 'blocked', downloadClicked: false, message: 'Unique media in the Flow output card is not verified as video.' };
  }
  const controls = all.filter((node) => {
    const tag = node.tagName?.toLowerCase();
    if ((tag !== 'button' && node.getAttribute?.('role') !== 'button') || !within(node, card)) return false;
    if (!visible(node) || node.disabled || node.getAttribute('aria-disabled') === 'true') return false;
    const label = [text(node), node.getAttribute('aria-label') || '', node.getAttribute('title') || '', node.getAttribute('data-tooltip') || ''].join(' ').toLowerCase();
    return /download|save video|export video|tải xuống|lưu video|xuất video/.test(label);
  });
  const controlLabel = (node) => [text(node), node.getAttribute('aria-label') || '', node.getAttribute('title') || '', node.getAttribute('data-tooltip') || ''].join(' ').trim();
  const isBatchDownload = (node) => /(?:download|tải xuống)\s*(?:all|batch|hàng loạt)|(?:all|batch)\s+(?:download|tải xuống)/i.test(controlLabel(node));
  const directControls = controls.filter((node) => !isBatchDownload(node));
  const batchControls = controls.filter(isBatchDownload);
  let control = null;
  if (directControls.length === 1 && batchControls.length === 0) {
    control = directControls[0];
  } else if (directControls.length === 0 && batchControls.length === 1) {
    const cardMedia = mediaNodes.filter((node) => within(node, card));
    if (cardMedia.length === 1 && cardMedia[0] === video) control = batchControls[0];
  }
  if (!control) return { status: 'blocked', downloadClicked: false, message: 'Output card không có đúng một Download an toàn cho duy nhất video đã xác minh; không mở menu dự phòng.' };
  const marker = 'Auto3DVideo exact Flow video download';
  const originalControlLabel = controlLabel(control);
  const originalAriaLabel = control.getAttribute('aria-label');
  control.setAttribute('data-auto3dvideo-had-original-aria-label', originalAriaLabel === null ? '0' : '1');
  control.setAttribute('data-auto3dvideo-original-aria-label', originalAriaLabel || '');
  control.setAttribute('aria-label', marker);
  return {
    status: 'ready',
    downloadClicked: false,
    downloadControlFound: true,
    marker,
    mediaId: video.getAttribute('data-media-id') || video.getAttribute('data-mediaid') || '',
    controlLabel: originalControlLabel,
    message: 'Exact video Download control prepared for a fresh BrowserOS action; no DOM click was dispatched.',
  };
})();`;

const restoreVideoOutputMarkerCode = String.raw`
return (() => {
  const marker = 'Auto3DVideo exact Flow video download';
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
  let restored = 0;
  for (const node of all) {
    if (node.getAttribute?.('aria-label') !== marker) continue;
    const hadOriginalLabel = node.getAttribute('data-auto3dvideo-had-original-aria-label');
    const originalLabel = node.getAttribute('data-auto3dvideo-original-aria-label');
    if (hadOriginalLabel === '1') {
      node.setAttribute('aria-label', originalLabel || '');
    } else if (hadOriginalLabel === '0') {
      node.removeAttribute('aria-label');
    } else {
      const fallback = [node.innerText, node.textContent, node.getAttribute('title'), node.getAttribute('data-tooltip')]
        .map((value) => String(value || '').trim())
        .find(Boolean);
      if (fallback) node.setAttribute('aria-label', fallback);
      else node.removeAttribute('aria-label');
    }
    node.removeAttribute('data-auto3dvideo-had-original-aria-label');
    node.removeAttribute('data-auto3dvideo-original-aria-label');
    restored += 1;
  }
  return { status: 'ready', restored };
})();
`;

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
    this.pageAttached = false;
    this.browserActionsPerformed = false;
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
    const result = await this.call("tools/call", { name, arguments: toolArguments }, options);
    if (["act", "download", "upload", "navigate", "wait"].includes(name)) this.browserActionsPerformed = true;
    return result;
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

  async downloadVideoOutput(page, projectUrl, shotId, revisionId, runId) {
    const expectedProjectId = String(projectUrl || '').match(/\/project\/([A-Za-z0-9-]+)/i)?.[1] || '';
    const userProfile = process.env.USERPROFILE;
    const downloadsDirectory = userProfile ? resolve(userProfile, 'Downloads') : null;
    const downloadsInfo = downloadsDirectory ? await stat(downloadsDirectory).catch(() => null) : null;
    if (!downloadsInfo?.isDirectory()) {
      return {
        status: 'blocked',
        downloadClicked: false,
        downloadControlFound: false,
        message: 'Flow download bị chặn: không xác minh được thư mục Downloads của người dùng.',
      };
    }

    const restoreMarkers = () => this.evaluate(page, restoreVideoOutputMarkerCode).catch(() => null);
    await restoreMarkers();
    const prepared = await this.evaluate(page, downloadVideoOutputCode(expectedProjectId, shotId, revisionId, runId));
    if (prepared?.status !== 'ready' || prepared.downloadControlFound !== true || prepared.marker !== 'Auto3DVideo exact Flow video download') {
      return { ...(prepared || {}), status: prepared?.status || 'blocked', downloadClicked: false };
    }
    const snapshot = await this.snapshot(page).catch(() => ({ refs: [] }));
    const downloadRefs = snapshot.refs.filter(
      (item) => item.role === 'button' && item.label.trim() === prepared.marker,
    );
    if (downloadRefs.length !== 1) {
      await restoreMarkers();
      return {
        status: 'blocked',
        downloadClicked: false,
        downloadControlFound: false,
        message: `Flow video Download ref không duy nhất sau snapshot mới (${downloadRefs.length}); không click.`,
      };
    }

    let downloadResult;
    try {
      downloadResult = await this.tool(
        'download',
        { page, ref: downloadRefs[0].reference },
        { timeoutMs: REQUEST_TIMEOUT_MS },
      );
    } catch (error) {
      await restoreMarkers();
      return {
        status: 'blocked',
        downloadClicked: false,
        downloadControlFound: true,
        message: `BrowserOS không xác nhận được tải Flow video: ${String(error?.message || error).slice(0, 300)}; không thử click lần hai.`,
      };
    }
    await restoreMarkers();

    const downloadDetail = contentText(downloadResult);
    const zipPath = downloadedBrowserOsZipPath(downloadResult);
    if (!zipPath) {
      return {
        status: 'blocked',
        downloadClicked: false,
        downloadControlFound: true,
        message: `BrowserOS chưa trả đường dẫn ZIP video có thể xác minh; không import. ${downloadDetail.slice(0, 500)}`,
      };
    }

    let extracted;
    try {
      extracted = await extractFlowDownloadZip(
        zipPath,
        this.workspace,
        runId,
        shotId,
        'video',
        downloadsDirectory,
      );
    } catch (error) {
      return {
        status: 'blocked',
        downloadClicked: false,
        downloadControlFound: true,
        message: `BrowserOS đã tải nhưng không thể xác minh ZIP Flow video: ${String(error?.message || error).slice(0, 400)}; không import.`,
      };
    }
    return {
      status: 'ready',
      downloadClicked: true,
      downloadControlFound: true,
      downloadName: extracted.rawPath.split(sep).at(-1),
      downloadSizeBytes: extracted.sizeBytes,
      downloadPath: extracted.rawPath,
      mediaId: prepared.mediaId || null,
      downloadSourceName: extracted.sourceName,
      clickMethod: 'browseros_exact_output_download_zip',
      message: `BrowserOS đã tải ZIP của đúng Flow video và giải nén một file ${extracted.sizeBytes} bytes vào Downloads.`,
    };
  }

  async ensureImageComposer(page) {
    const readComposer = async () => this.evaluate(page, inspectComposerCode).catch(() => ({}));
    const readEvidence = async () => {
      const state = await readComposer();
      const snapshot = await this.snapshot(page).catch(() => ({ refs: [] }));
      const snapshotGenerate = snapshot.refs.some((item) => item.role === "button" && /^(?:start generation|generate image|generate|tạo ảnh)$/i.test(item.label.trim()));
      const ready = Boolean(state?.promptEditorFound && state?.addIngredientsFound && (state?.generationButtonFound || snapshotGenerate));
      return { ...state, generationButtonFound: Boolean(state?.generationButtonFound || snapshotGenerate), imageModeFound: Boolean(state?.imageModeFound || ready), snapshotGenerate, ready };
    };
    const ready = (state) => Boolean(state?.ready || (state?.promptEditorFound && state?.imageModeFound && state?.generationButtonFound && state?.addIngredientsFound));
    let state = await readEvidence();
    if (ready(state)) return state;

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
      state = await readEvidence();
      if (ready(state)) return state;
    }
    return state;
  }

  async selectVideoModel(page, model) {
    const requestedModel = safeText(model, "videoModel", 80);
    if (requestedModel !== "Omni 1.1 Flash") {
      throw new Error("Chỉ cho phép chọn model video Omni 1.1 Flash theo model người dùng đã xác nhận.");
    }
    const currentUrl = String(this.state.pageUrl || "");
    const expectedProjectId = new URL(currentUrl).pathname.match(/\/project\/([A-Za-z0-9-]+)/i)?.[1] || "";
    const before = await this.evaluate(page, inspectComposerCode);
    if (!expectedProjectId || before.projectKey !== expectedProjectId) {
      throw new Error(`BLOCKED_VIDEO_MODEL_SOURCE: không xác nhận đúng project Flow trước khi chọn model (project=${before.projectKey || "trống"}).`);
    }
    if (before.videoModeFound && before.videoComposerReady && /Omni 1\.1 Flash/i.test(before.selectedModel || "")) {
      return {
        ...before,
        status: "ready",
        modelSelected: true,
        saved: true,
        currentUrl,
        message: "Flow đã xác nhận Omni 1.1 Flash cùng video prompt composer; chưa nhập prompt, chưa Generate.",
      };
    }
    if (!before.imageModeFound || !/Nano Banana 2/i.test(before.selectedModel || "")) {
      throw new Error("BLOCKED_VIDEO_MODEL_SOURCE: chỉ chuyển từ composer Nano Banana 2 hoặc model video đã xác nhận; không chạm chat hoặc project khác.");
    }
    const modelPickerState = await this.evaluate(page, openVideoModelPickerCode(expectedProjectId));
    if (modelPickerState?.status !== "opened" || modelPickerState.projectKey !== expectedProjectId) {
      throw new Error(`BLOCKED_VIDEO_MODEL_MENU: không mở được đúng model picker của project hiện tại (${JSON.stringify(modelPickerState).slice(0, 360)}).`);
    }
    this.browserActionsPerformed = true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));

    const videoSnapshot = await this.snapshot(page);
    const videoTargets = videoSnapshot.refs.filter((item) => item.role === "radio" && item.label.trim().toLowerCase() === "video");
    if (videoTargets.length !== 1) {
      throw new Error(`BLOCKED_VIDEO_MODE: model picker ${modelPickerState.controlLabel}; Video radio không duy nhất trong snapshot mới; matches=${videoTargets.length}.`);
    }
    await this.click(page, videoTargets[0].reference);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
    await this.tool("wait", { page, for: "text", value: "Chọn nhóm mô hình", timeout: 5_000 }, { timeoutMs: 10_000 }).catch(() => null);
    const pickerSnapshot = await this.snapshot(page);
    const modelPickers = pickerSnapshot.refs.filter((item) => item.role === "button" && /^(?:choose model group|chọn nhóm mô hình)$/i.test(item.label.trim()));
    if (modelPickers.length !== 1) {
      throw new Error(`BLOCKED_VIDEO_MODEL_PICKER: nút Chọn nhóm mô hình không duy nhất; matches=${modelPickers.length}.`);
    }
    await this.click(page, modelPickers[0].reference);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
    await this.tool("wait", { page, for: "text", value: requestedModel, timeout: 5_000 }, { timeoutMs: 10_000 }).catch(() => null);
    const optionSnapshot = await this.snapshot(page);
    const optionRoles = new Set(["radio", "option", "menuitem", "button"]);
    const options = optionSnapshot.refs.filter((item) => optionRoles.has(item.role)
      && /\bOmni 1\.1 Flash\b/i.test(item.label));
    if (options.length !== 1) {
      const visibleOptions = optionSnapshot.refs
        .filter((item) => optionRoles.has(item.role))
        .map((item) => item.label.trim())
        .filter(Boolean)
        .slice(-24);
      throw new Error(`BLOCKED_VIDEO_MODEL_OPTION: Omni 1.1 Flash không duy nhất trong menu model; matches=${options.length}; options=${JSON.stringify(visibleOptions).slice(0, 480)}`);
    }
    await this.click(page, options[0].reference);
    let verification = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
      verification = await this.evaluate(page, inspectComposerCode).catch(() => null);
      if (verification?.projectKey === expectedProjectId
        && verification.videoModeFound
        && verification.videoComposerReady
        && /Omni 1\.1 Flash/i.test(verification.selectedModel || "")) break;
    }
    const verified = Boolean(verification?.projectKey === expectedProjectId
      && verification.videoModeFound
      && verification.videoComposerReady
      && /Omni 1\.1 Flash/i.test(verification.selectedModel || ""));
    if (verified) {
      this.state.flowComposerFingerprint = {
        pageId: page,
        projectKey: expectedProjectId,
        model: requestedModel,
        outputCount: "",
        fingerprint: `video-editor|generate|${requestedModel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      };
      await this.persist();
    }
    return {
      ...verification,
      modelPickerOpened: true,
      modelPickerLabel: modelPickerState.controlLabel,
      status: verified ? "ready" : "blocked",
      modelSelected: verified,
      saved: verified,
      currentUrl,
      message: verified
        ? `Flow đã chọn và xác nhận ${requestedModel} cùng video prompt composer; chưa nhập prompt, chưa Generate.`
        : `Flow chưa xác nhận ${requestedModel} + video prompt composer; không nhập prompt và không Generate (${verification?.selectedModel || "verification failed"}).`,
    };
  }

  async model(page, reopened = false) {
    await this.evaluate(page, `
      const node = document.querySelector('button[aria-label="Settings trigger"], button[aria-label="Image generation default model"], [contenteditable="true"]');
      if (node) node.scrollIntoView({ block: 'center', inline: 'center' });
      return Boolean(node);
    `).catch(() => false);
    await this.ensureImageComposer(page);
    const composerBeforeSettings = await this.evaluate(page, inspectComposerCode).catch(() => ({}));
    const composerModelText = typeof composerBeforeSettings.selectedModel === 'string'
      ? composerBeforeSettings.selectedModel
      : '';
    const composerAlreadyUsesPro = /Nano Banana Pro/i.test(composerModelText);
    const composerOutputCount = /\bx1\b/i.test(composerModelText)
      ? 'x1'
      : /\bx2\b/i.test(composerModelText) ? 'x2' : '';
    // The live composer can already be configured. In that state the picker
    // option is intentionally not rendered, so clicking the current model
    // button and searching for a menu item creates a false "option missing"
    // failure. Only open settings when the model or x1 output count still
    // needs changing.
    if (composerAlreadyUsesPro && composerOutputCount === 'x1') {
      this.state.flowComposerFingerprint = {
        pageId: page,
        projectKey: composerBeforeSettings.projectKey || '',
        model: 'Nano Banana Pro',
        outputCount: 'x1',
        fingerprint: composerBeforeSettings.composerFingerprint || 'image-editor|ingredients|generate|nano-banana-pro',
      };
      await this.persist();
      return {
        status: 'ready',
        modelSelected: true,
        saved: true,
        selectedModel: composerModelText,
        outputCount: 'x1',
        composerFound: Boolean(composerBeforeSettings.composerFound),
        promptEditorFound: Boolean(composerBeforeSettings.promptEditorFound),
        imageModeFound: Boolean(composerBeforeSettings.imageModeFound),
        currentUrl: composerBeforeSettings.currentUrl || this.state.pageUrl,
        projectKey: composerBeforeSettings.projectKey || '',
        composerFingerprint: composerBeforeSettings.composerFingerprint || '',
        message: 'Flow đã ở đúng project image composer với Nano Banana Pro x1; không mở picker và không click thừa.',
      };
    }
    const initial = await this.snapshot(page);
    const modelRef = (item) => textMatches(item.label, ["image generation default model", "nano banana", "image model"]);
    let picker = initial.refs.find(modelRef);
    if (composerAlreadyUsesPro && composerOutputCount !== 'x1') picker = null;
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
    let modelAlreadySelected = composerAlreadyUsesPro;
    let selectedModel = composerAlreadyUsesPro
      ? { selected: true, pickerText: composerModelText }
      : null;
    if (!picker) {
      // Flow's Agent settings picker can be visible in the real DOM/shadow DOM
      // while BrowserOS omits it from the accessibility snapshot. Use a
      // bounded, label-scored DOM recovery for settings/model only; it never
      // guesses coordinates or touches the prompt/generate controls.
      for (let attempt = 0; !picker && attempt < 4; attempt += 1) {
        let domState = await this.evaluate(page, imageModelDomStateCode).catch(() => ({}));
        if (domState.settingsFound && (!domState.pickerFound || composerOutputCount !== 'x1')) {
          await this.evaluate(page, imageModelDomActionCode("settings")).catch(() => null);
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
          domState = await this.evaluate(page, imageModelDomStateCode).catch(() => ({}));
        }
        if (domState.pickerFound) {
          pickerViaDom = true;
          picker = { role: "dom", label: domState.picker?.text || "Image generation default model", reference: "dom:image-model-picker" };
          modelAlreadySelected = /Nano Banana Pro/i.test(domState.picker?.text || '') || modelAlreadySelected;
          if (modelAlreadySelected) selectedModel = { selected: true, pickerText: domState.picker?.text || composerModelText };
          break;
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      }
    }
    if (!picker && !modelAlreadySelected) {
      const refs = pickerSnapshotRefs.map((item) => `${item.role}:${item.label}`).slice(-24).join(" | ");
      throw new Error(`Không tìm thấy image model picker trong snapshot BrowserOS; refs=${refs}`);
    }
    let afterOption;
    if (!modelAlreadySelected) {
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
        if (!domOption?.clicked) {
          const candidateDetail = Array.isArray(domOption?.candidates)
            ? ` candidates=${JSON.stringify(domOption.candidates).slice(0, 900)}`
            : '';
          throw new Error(`Không tìm thấy Nano Banana Pro option trong menu Flow.${candidateDetail}`);
        }
      }
      afterOption = await this.snapshot(page);
    } else {
      // The current composer already proves the requested model. Do not click
      // its display button: Flow may not render an option menu for a selected
      // model, and a stale click can leave the settings route ambiguous.
      afterOption = await this.snapshot(page);
    }
    const readSelectedModel = async () => {
      const state = await this.evaluate(page, inspectComposerCode).catch(() => ({}));
      const pickerText = typeof state.selectedModel === "string" ? state.selectedModel : "";
      if (/Nano Banana Pro/i.test(pickerText)) return { selected: true, pickerText };
      const domState = await this.evaluate(page, imageModelDomStateCode).catch(() => ({}));
      const domText = typeof domState.picker?.text === "string" ? domState.picker.text : "";
      return { selected: /Nano Banana Pro/i.test(domText), pickerText: pickerText || domText };
    };
    selectedModel = selectedModel || await readSelectedModel();
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
      // Some Flow builds close/apply Agent settings as soon as x1 is chosen
      // and do not expose a textual Save button. Accept only a fresh live
      // composer proof showing Nano Banana Pro x1; never infer success from
      // the click response alone.
      const appliedComposer = await this.evaluate(page, inspectComposerCode).catch(() => ({}));
      const appliedModelText = typeof appliedComposer.selectedModel === 'string'
        ? appliedComposer.selectedModel
        : '';
      const applied = /Nano Banana Pro/i.test(appliedModelText)
        && /\bx1\b/i.test(appliedModelText)
        && Boolean(appliedComposer.promptEditorFound && appliedComposer.addIngredientsFound && appliedComposer.generationButtonFound);
      if (applied) {
        this.state.flowComposerFingerprint = {
          pageId: page,
          projectKey: appliedComposer.projectKey || composerBeforeSettings.projectKey || '',
          model: 'Nano Banana Pro',
          outputCount: 'x1',
          fingerprint: appliedComposer.composerFingerprint || 'image-editor|ingredients|generate|nano-banana-pro',
        };
        await this.persist();
        return {
          status: 'ready',
          modelSelected: true,
          saved: true,
          selectedModel: appliedModelText,
          outputCount: 'x1',
          composerFound: true,
          promptEditorFound: true,
          imageModeFound: true,
          currentUrl: appliedComposer.currentUrl || this.state.pageUrl,
          projectKey: appliedComposer.projectKey || '',
          composerFingerprint: appliedComposer.composerFingerprint || '',
          message: 'Flow đã áp dụng Nano Banana Pro x1 và composer live đã phản ánh cấu hình; không cần nút Save riêng.',
        };
      }
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
    if (selected && saved) {
      this.state.flowComposerFingerprint = {
        pageId: page,
        projectKey: state.projectKey || composerBeforeSettings.projectKey || '',
        model: 'Nano Banana Pro',
        outputCount: 'x1',
        fingerprint: state.composerFingerprint || 'image-editor|ingredients|generate|nano-banana-pro',
      };
      await this.persist();
    }
    return { status: selected && saved ? "ready" : "blocked", modelSelected: selected, saved, selectedModel: pickerText, outputCount: "x1", composerFound: Boolean(state.composerFound), promptEditorFound: Boolean(state.promptEditorFound), imageModeFound: Boolean(state.imageModeFound), currentUrl: state.currentUrl || this.state.pageUrl, projectKey: state.projectKey || '', composerFingerprint: state.composerFingerprint || '', message: selected && saved ? "BrowserOS đã chọn Nano Banana Pro, đặt x1 và bấm Save trong Google Flow." : `Flow chưa xác nhận đủ bước chọn model và Save (modelSelected=${selected}, saved=${saved}, picker=${pickerText || "trống"}).` };
  }

  async typePrompt(page, prompt, submit) {
    const promptToken = JSON.stringify(prompt);
    const projectKey = String(this.state.pageUrl || '').match(/\/project\/([A-Za-z0-9-]+)/i)?.[1] || '';
    let configured = this.state.flowComposerFingerprint;
    if (!configured || configured.projectKey !== projectKey || configured.model !== 'Nano Banana Pro' || configured.outputCount !== 'x1') {
      // The generic BrowserOS MCP worker may have refreshed the shared session
      // file and dropped the Flow-only fingerprint. Re-read the live model
      // gate once (non-generating) instead of blocking a resumable shot.
      const recovered = await this.model(page).catch((error) => ({ status: 'blocked', message: String(error?.message || error) }));
      configured = this.state.flowComposerFingerprint;
      if (recovered.status !== 'ready' || !configured || configured.projectKey !== projectKey || configured.model !== 'Nano Banana Pro' || configured.outputCount !== 'x1') {
        throw new Error(`Flow composer fingerprint chưa được xác nhận cho project ${projectKey || 'trống'} (model gate phải hoàn tất trước khi type): ${recovered.message || 'không khôi phục được model gate'}.`);
      }
    }
    const composer = await this.ensureImageComposer(page);
    if (!composer.promptEditorFound || !composer.imageModeFound || !composer.generationButtonFound || !composer.addIngredientsFound) {
      throw new Error(`Flow chưa chứng minh image composer thật trước khi nhập prompt (editor=${Boolean(composer.promptEditorFound)}, imageMode=${Boolean(composer.imageModeFound)}, generate=${Boolean(composer.generationButtonFound)}, ingredients=${Boolean(composer.addIngredientsFound)}, model=${composer.selectedModel || "trống"})`);
    }
    const snapshot = await this.snapshot(page).catch(() => ({ refs: [] }));
    const promptRef = findFlowPromptRef(snapshot.refs);
    let entered = null;
    let inputMethod = 'dom_fallback';
    if (promptRef) {
      try {
        await this.tool('act', { page, kind: 'fill', ref: promptRef.reference, value: prompt });
        const trustedState = await this.evaluate(page, inspectComposerCode).catch(() => ({}));
        if (trustedState.promptText?.includes('SHOT_ID:') && trustedState.promptText?.includes('REVISION_ID:')) {
          entered = { found: true, accepted: true, charCount: trustedState.promptText.length, inputMethod: 'browseros_fill_ref', reference: promptRef.reference };
          inputMethod = 'browseros_fill_ref';
        }
      } catch {
        // The accessibility ref can disappear while Flow re-renders. Keep a
        // bounded DOM fallback, then require a fresh prompt read below.
      }
    }
    if (!entered) entered = await this.evaluate(page, `
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
        return { found: true, accepted: text.includes('SHOT_ID:') && text.includes('REVISION_ID:'), charCount: text.length, inserted, inputMethod: 'dom_fallback' };
      })();
    `).catch((error) => ({ found: false, accepted: false, charCount: 0, error: String(error?.message || error).slice(0, 400) }));
    if (!entered.found) throw new Error(`Không tìm thấy đúng Flow ProseMirror prompt editor${entered.error ? `: ${entered.error}` : ""}`);
    if (submit) {
      const current = await this.snapshot(page);
      const editor = current.refs.find((item) => (item.role === "textbox" || item.role === "paragraph" || item.role === "generic") && textMatches(item.label, ["what do you want to create", "what do you want to change", "bạn muốn thay đổi gì", "prompt"]));
      if (editor) await this.tool("act", { page, kind: "press", ref: editor.reference, key: "Enter" });
    }
    const state = await this.evaluate(page, inspectComposerCode);
    const finalSnapshot = await this.snapshot(page).catch(() => ({ refs: [] }));
    const snapshotGenerate = finalSnapshot.refs.some((item) => item.role === "button" && /^(?:start generation|generate image|generate|tạo ảnh)$/i.test(item.label.trim()));
    const accepted = state.promptText?.includes("SHOT_ID:") && state.promptText?.includes("REVISION_ID:");
    const composerStillReady = Boolean(state.promptEditorFound && state.addIngredientsFound && (state.generationButtonFound || snapshotGenerate));
    return { status: accepted && composerStillReady ? "ready" : "blocked", editorFound: Boolean(state.promptEditorFound), promptAccepted: Boolean(accepted), generateClicked: Boolean(submit), inputMethod: entered.inputMethod || inputMethod, promptRef: promptRef?.reference || null, message: accepted && composerStillReady ? `BrowserOS đã nhập prompt vào đúng ProseMirror image composer (${entered.inputMethod || inputMethod}).` : `BrowserOS chưa xác nhận prompt trong image composer (editor=${Boolean(state.promptEditorFound)}, imageMode=${Boolean(state.imageModeFound)}, generate=${Boolean(state.generationButtonFound)}, ingredients=${Boolean(state.addIngredientsFound)}).` };
  }

  async typeVideoPrompt(page, prompt, projectUrl, expectedCreditCost, expectedModel, referenceMediaId = null) {
    const expectedProjectId = String(projectUrl || '').match(/\/project\/([A-Za-z0-9-]+)/i)?.[1] || '';
    const currentProjectId = String(this.state.pageUrl || '').match(/\/project\/([A-Za-z0-9-]+)/i)?.[1] || '';
    if (!expectedProjectId || currentProjectId !== expectedProjectId) {
      throw new Error(`BLOCKED_VIDEO_PROJECT: project Flow hiện tại không khớp project đã chọn (${currentProjectId || "trống"}).`);
    }
    const before = await this.evaluate(page, inspectComposerCode);
    const visibleCreditPrices = (before.visibleCreditTexts || [])
      .map((value) => Number(String(value).match(/\b(\d{1,3}(?:,\d{3})*|\d+)\s*(?:credits?|tín\s+dụng)\b/i)?.[1]?.replace(/,/g, "")))
      .filter((value) => Number.isSafeInteger(value) && value > 0);
    const uniqueCreditPrices = [...new Set(visibleCreditPrices)];
    const visibleCreditCost = uniqueCreditPrices.length === 1 ? uniqueCreditPrices[0] : null;
    if (!before.videoModeFound || !before.promptEditorFound
      || !String(before.selectedModel || '').toLowerCase().includes(String(expectedModel || '').toLowerCase())
      || !Array.isArray(before.selectedSettingsEvidence) || before.selectedSettingsEvidence.length < 3
      || visibleCreditCost !== expectedCreditCost) {
      throw new Error(`BLOCKED_VIDEO_COMPOSER: không xác minh được Video, model, settings và giá ${expectedCreditCost} credits/shot trước khi nhập prompt.`);
    }
    // Animate proved this chip once, but the run can then wait for batch
    // approval and take snapshots. A chip that was removed or swapped in that
    // window is read again here, immediately before anything is typed.
    const reference = await this.verifyVideoReferenceChip(page, referenceMediaId);
    if (referenceMediaId && !reference.referenceVerified) {
      throw new Error(`BLOCKED_VIDEO_REFERENCE: ${reference.referenceChipReason || "không xác minh được chip reference"} (${reference.referenceChipMessage || "chip không còn khớp media đã xác nhận"}).`);
    }
    const normalizedPrompt = normalizePromptText(prompt);
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
          for (const node of root.querySelectorAll ? root.querySelectorAll('*') : []) if (node.shadowRoot) collect(node.shadowRoot);
        };
        collect(document);
        const normalized = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
        const expectedPrompt = ${JSON.stringify(normalizedPrompt)};
        const editor = roots.flatMap((root) => [...root.querySelectorAll('flow-rich-text-editor.prompt-input div.ProseMirror[contenteditable="true"]')]).filter(visible);
        if (editor.length !== 1) return { found: false, accepted: false, count: editor.length };
        const node = editor[0];
        node.scrollIntoView({ block: 'center', inline: 'center' });
        node.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
        try { document.execCommand('insertText', false, ${JSON.stringify(prompt)}); } catch (_) {}
        let text = String(node.innerText || '').replace(/\\r/g, '').trim();
        if (text !== ${JSON.stringify(prompt.trim())}) {
          node.replaceChildren();
          const paragraph = document.createElement('p');
          paragraph.textContent = ${JSON.stringify(prompt)};
          node.appendChild(paragraph);
          node.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(prompt)} }));
          node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(prompt)} }));
          node.dispatchEvent(new Event('change', { bubbles: true }));
          text = String(node.innerText || '').replace(/\\r/g, '').trim();
        }
        return { found: true, accepted: normalized(text) === expectedPrompt, charCount: text.length };
      })();
    `);
    if (!entered?.found || !entered.accepted) {
      throw new Error(`BLOCKED_VIDEO_PROMPT: prompt chưa được xác nhận trong video composer (found=${Boolean(entered?.found)}, accepted=${Boolean(entered?.accepted)}).`);
    }
    const after = await this.evaluate(page, inspectComposerCode);
    return {
      status: normalizePromptText(after.promptText) === normalizedPrompt ? "ready" : "blocked",
      promptAccepted: normalizePromptText(after.promptText) === normalizedPrompt,
      generateClicked: false,
      videoModeFound: Boolean(after.videoModeFound),
      promptEditorFound: Boolean(after.promptEditorFound),
      selectedModel: after.selectedModel || "",
      visibleCreditTexts: after.visibleCreditTexts || [],
      promptCharCount: after.promptText?.length || 0,
      ...reference,
      message: normalizePromptText(after.promptText) !== normalizedPrompt
        ? "BrowserOS chưa xác nhận nội dung prompt chính xác; chưa bấm Generate."
        : referenceMediaId
          ? "BrowserOS đã xác minh lại chip reference đúng media đã xác nhận ngay trước khi nhập prompt, và đã xác nhận nội dung trong video composer; chưa bấm Generate."
          : "BrowserOS đã xác nhận prompt trong video composer; chưa bấm Generate.",
    };
  }

  // The bound reference is re-read here, at the last moment before a paid
  // action, with the same explicit-chip rule Animate used. A missing, swapped
  // or ambiguous chip is a refusal, never a paid prompt or a paid Generate; a
  // legacy shot with no binding has no chip to re-check and reads nothing.
  async verifyVideoReferenceChip(page, referenceMediaId) {
    if (!referenceMediaId) {
      return { referenceVerified: null, referenceSourceMediaId: null };
    }
    const expected = safeMediaIdArgument(referenceMediaId);
    const state = await this.evaluate(page, animateIngredientStateCode(expected)).catch(() => ({}));
    const verified = verifyFlowIngredientChip(state, expected, { explicit: true });
    return {
      referenceVerified: Boolean(verified.ready),
      referenceSourceMediaId: verified.sourceMediaId ?? state?.sourceMediaId ?? null,
      referenceChipReason: verified.reason ?? null,
      referenceChipMessage: verified.ready ? null : flowExactMediaMessage(verified.reason),
    };
  }

  async clickVideoGenerate(page, prompt, projectUrl, expectedCreditCost, expectedModel, referenceMediaId = null) {
    const expectedProjectId = String(projectUrl || '').match(/\/project\/([A-Za-z0-9-]+)/i)?.[1] || '';
    const currentProjectId = String(this.state.pageUrl || '').match(/\/project\/([A-Za-z0-9-]+)/i)?.[1] || '';
    if (!expectedProjectId || currentProjectId !== expectedProjectId) {
      throw new Error(`BLOCKED_VIDEO_PROJECT: project Flow hiện tại không khớp project đã chọn (${currentProjectId || "trống"}).`);
    }
    const liveComposer = await this.evaluate(page, inspectComposerCode);
    if (!String(liveComposer.selectedModel || '').toLowerCase().includes(String(expectedModel || '').toLowerCase())) {
      throw new Error(`BLOCKED_VIDEO_MODEL: model hiện tại không khớp ${expectedModel}.`);
    }
    // The last read before the click: a chip that drifted since Animate, or
    // since the prompt was typed, must not buy a paid generation.
    const reference = await this.verifyVideoReferenceChip(page, referenceMediaId);
    if (referenceMediaId && !reference.referenceVerified) {
      throw new Error(`BLOCKED_VIDEO_REFERENCE: ${reference.referenceChipReason || "không xác minh được chip reference"} (${reference.referenceChipMessage || "chip không còn khớp media đã xác nhận"}).`);
    }
    const clickResult = await this.evaluate(page, `
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
          for (const node of root.querySelectorAll ? root.querySelectorAll('*') : []) if (node.shadowRoot) collect(node.shadowRoot);
        };
        collect(document);
        const all = roots.flatMap((root) => [...root.querySelectorAll('*')]);
        const expectedModel = ${JSON.stringify(expectedModel)};
        const expectedPrompt = ${JSON.stringify(normalizePromptText(prompt))};
        const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
        const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
        const controlText = (node) => [text(node), node?.getAttribute?.('aria-label') || '', node?.getAttribute?.('title') || ''].join(' ').replace(/\\s+/g, ' ').trim();
        const editorMatches = all.filter((node) => visible(node) && node.matches?.('flow-rich-text-editor.prompt-input div.ProseMirror[contenteditable="true"]'));
        if (editorMatches.length !== 1) return { clicked: false, reason: 'video-editor-not-unique', editorCount: editorMatches.length };
        const editor = editorMatches[0];
        const promptText = normalize(editor.innerText);
        if (promptText !== expectedPrompt) return { clicked: false, reason: 'prompt-mismatch' };
        const controls = all.filter((node) => visible(node) && node.matches?.('button,[role="button"],[aria-label],[title]'));
        const model = controls.find((node) => node.matches?.('button,[role="button"],[role="combobox"]') && controlText(node).toLowerCase().includes(expectedModel.toLowerCase()));
        const settings = controls.filter((node) => node.matches?.('[role="radio"],[role="option"],input[type="radio"],button,[role="button"]') && visible(node)
          && (node.matches?.(':checked') || node.getAttribute?.('aria-checked') === 'true' || node.getAttribute?.('aria-selected') === 'true' || node.getAttribute?.('aria-pressed') === 'true' || node.getAttribute?.('data-state') === 'checked' || node.getAttribute?.('data-state') === 'active'))
          .map(controlText).filter((label) => /(?:16:9|9:16|1:1|360p|720p|1080p|\\b\\d+\\s*(?:s|sec(?:onds?)?|giây)\\b)/i.test(label));
        const prices = all.filter((node) => visible(node)).map(controlText)
          .filter((value) => /\\b(?:\\d{1,3}(?:,\\d{3})*|\\d+)\\s*(?:credits?|tín\\s+dụng)\\b/i.test(value) && /(?:cost|price|generate|video|tốn|giá)/i.test(value))
          .map((value) => Number(value.match(/\\b(\\d{1,3}(?:,\\d{3})*|\\d+)\\s*(?:credits?|tín\\s+dụng)\\b/i)?.[1]?.replace(/,/g, '') || 0))
          .filter((value) => Number.isSafeInteger(value) && value > 0);
        const uniquePrices = [...new Set(prices)];
        const actualCost = uniquePrices.length === 1 ? uniquePrices[0] : 0;
        if (!model || settings.length < 3 || actualCost !== ${Number(expectedCreditCost)}) return { clicked: false, reason: 'live-model-settings-price-changed', model: controlText(model), settings, actualCost };
        const rect = editor.getBoundingClientRect();
        const candidates = controls.filter((node) => {
          if (!node.matches?.('button,[role="button"]')) return false;
          const label = controlText(node).toLowerCase();
          if (!/\\b(?:arrow_forward|send|submit)\\b/.test(label) || /chat|assistant/.test(label)) return false;
          const box = node.getBoundingClientRect();
          return box.right >= rect.right - 80 && box.right <= rect.right + 48 && box.top >= rect.top - 40 && box.top <= rect.bottom + 100;
        });
        const explicit = controls.filter((node) => node.matches?.('button,[role="button"]') && /^(?:start generation|generate video|generate|bắt đầu tạo|tạo video)$/i.test(controlText(node)));
        const unique = explicit.length === 1 ? explicit : candidates;
        if (unique.length !== 1) return { clicked: false, reason: 'generate-control-not-unique', candidateCount: unique.length };
        const button = unique[0];
        if (button.disabled || button.getAttribute?.('aria-disabled') === 'true') return { clicked: false, reason: 'generate-control-disabled' };
        button.click();
        return { clicked: true, label: controlText(button), actualCost, model: controlText(model), settings: settings.slice(0, 6) };
      })();
    `);
    if (!clickResult?.clicked) {
      throw new Error(`BLOCKED_VIDEO_GENERATE: ${String(clickResult?.reason || "live control not verified")} (${JSON.stringify(clickResult).slice(0, 420)}).`);
    }
    return {
      status: "ready",
      generateClicked: true,
      selectedModel: clickResult.model,
      selectedSettingsEvidence: clickResult.settings,
      visibleCreditTexts: [String(expectedCreditCost)],
      ...reference,
      message: `Đã xác minh lại chip reference ngay trước click và click đúng nút Generate của video composer ${clickResult.model}; giá trực tiếp tại click ${clickResult.actualCost} credits/shot.`,
    };
  }


  async clickGenerate(page) {
    const projectKey = String(this.state.pageUrl || '').match(/\/project\/([A-Za-z0-9-]+)/i)?.[1] || '';
    let configured = this.state.flowComposerFingerprint;
    if (!configured || configured.projectKey !== projectKey || configured.model !== 'Nano Banana Pro' || configured.outputCount !== 'x1') {
      const recovered = await this.model(page).catch((error) => ({ status: 'blocked', message: String(error?.message || error) }));
      configured = this.state.flowComposerFingerprint;
      if (recovered.status !== 'ready' || !configured || configured.projectKey !== projectKey || configured.model !== 'Nano Banana Pro' || configured.outputCount !== 'x1') {
        throw new Error(`Flow composer fingerprint chưa được xác nhận cho project ${projectKey || 'trống'} (model gate phải hoàn tất trước khi Generate): ${recovered.message || 'không khôi phục được model gate'}.`);
      }
    }
    await this.evaluate(page, "const node = document.querySelector('button[aria-label=\"Start generation\"], button[aria-label=\"Generate\"]'); if (node) node.scrollIntoView({ block: 'center', inline: 'center' }); return Boolean(node);").catch(() => false);
    const current = await this.snapshot(page);
    const composer = await this.evaluate(page, inspectComposerCode);
    const snapshotGenerate = current.refs.some((item) => item.role === "button" && /^(?:start generation|generate image|generate|tạo ảnh)$/i.test(item.label.trim()));
    if (!composer.promptEditorFound || !composer.addIngredientsFound || (!composer.generationButtonEnabled && !snapshotGenerate)) {
      throw new Error(`Flow chưa sẵn sàng Generate (editor=${Boolean(composer.promptEditorFound)}, imageMode=${Boolean(composer.imageModeFound)}, generateControl=${Boolean(composer.generationButtonFound)}, generateEnabled=${Boolean(composer.generationButtonEnabled)}, generateSnapshot=${snapshotGenerate}, ingredients=${Boolean(composer.addIngredientsFound)}, model=${composer.selectedModel || "trống"})`);
    }
    const generate = pickRef(current.refs, (item) => item.role === "button" && textMatches(item.label, ["start generation", "generate image", "generate", "tạo ảnh"]) && !textMatches(item.label, ["chat"]), "nút Generate của Flow");
    await this.click(page, generate.reference);
    return { status: "ready", generateClicked: true, controlLabel: generate.label, message: "BrowserOS đã click nút Generate thật trong Google Flow." };
  }

  async listImageCards(page, limit) {
    // One extra card past the bound is read so a grid that overflows is
    // reported as truncated instead of looking complete at exactly the limit.
    const observed = await this.evaluate(page, flowImageCardsCode(limit + 1)).catch(() => null);
    const rawCards = Array.isArray(observed?.cards) ? observed.cards : [];
    const visibleMediaCount = Number(observed?.visibleMediaCount ?? rawCards.length);
    // Truncation is decided from the raw page, never from the cards that
    // survived sanitizing. A malformed ID is dropped, so a grid whose tail was
    // never read could otherwise fit the bound exactly, look complete, and
    // leave a sampled card selectable and confirmable.
    const normalized = normalizeFlowImageCards(rawCards, {
      limit,
      truncated: rawCards.length > limit || visibleMediaCount > rawCards.length,
    });
    return {
      status: normalized.cards.length > 0 ? "ready" : "blocked",
      ...normalized,
      visibleMediaCount,
      found: Boolean(observed?.found) && normalized.cards.length > 0,
    };
  }

  async animate(page, shotId, revisionId, mediaId) {
    // An explicit binding carries the exact media ID the human confirmed. That
    // ID is the only card this shot may use: no shot/revision label, no
    // history, and no "nearest" card. The legacy label route is kept below for
    // Flow-origin references that have no explicit binding at all.
    const explicit = Boolean(mediaId);
    let selectedMediaId = mediaId || null;
    if (!explicit) {
      const byShot = await this.evaluate(page, mediaByShotLabelCode(shotId, revisionId)).catch(() => null);
      if (!byShot?.found || !byShot.mediaId) {
        throw new Error(byShot?.reason || "BrowserOS không tìm thấy card ảnh Flow theo shot/revision đã có");
      }
      selectedMediaId = byShot.mediaId;
    }

    const current = await this.evaluate(page, animateIngredientStateCode(selectedMediaId)).catch(() => ({}));
    const before = verifyFlowIngredientChip(current, selectedMediaId, { explicit });
    if (before.ready) {
      return {
        status: "ready",
        editorFound: true,
        referenceAttached: true,
        sourceMediaId: before.sourceMediaId || selectedMediaId,
        chipCount: Number(current.ingredientCount ?? 1),
        message: explicit
          ? "BrowserOS đã xác nhận ingredient đúng media ID đã xác nhận thủ công vẫn còn trong video composer."
          : "BrowserOS đã xác nhận ingredient đúng media đã gắn sẵn trong video composer.",
      };
    }
    if (Number(current.ingredientCount ?? 0) > 0) {
      throw new Error(flowExactMediaMessage(before.reason));
    }

    let options = await this.evaluate(page, exactMediaOptionsCode(selectedMediaId)).catch(() => null);
    if (!options?.found && !explicit) {
      const byShot = await this.evaluate(page, mediaByShotLabelCode(shotId, revisionId)).catch(() => null);
      if (byShot?.found && byShot.mediaId) {
        selectedMediaId = byShot.mediaId;
        options = await this.evaluate(page, exactMediaOptionsCode(selectedMediaId)).catch(() => null);
      }
    }
    if (options?.found && explicit) {
      const presence = verifyExactMediaPresence(options, selectedMediaId);
      if (!presence.ok) throw new Error(flowExactMediaMessage(presence.reason));
    }
    if (!options?.found) {
      if (explicit) {
        // An explicit binding reports why its own card is unusable instead of
        // relaying a raw DOM message that reads like a failed lookup.
        throw new Error(flowExactMediaMessage(verifyExactMediaPresence(options, selectedMediaId).reason));
      }
      throw new Error(options?.reason || "BrowserOS không tìm thấy card ảnh Flow để Animate");
    }
    if (options.needsHover && options.rect?.width > 0 && options.rect?.height > 0) {
      await this.tool("act", {
        page,
        kind: "hover_at",
        x: Number(options.rect.x) + Number(options.rect.width) / 2,
        y: Number(options.rect.y) + Number(options.rect.height) / 2,
      });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
      options = await this.evaluate(page, exactMediaOptionsCode(selectedMediaId)).catch(() => options);
      if (explicit) {
        // The re-read after hover is the only state that may be acted on, so a
        // card that became ambiguous while hovering stops the run here.
        const presence = verifyExactMediaPresence(options, selectedMediaId);
        if (!presence.ok) throw new Error(flowExactMediaMessage(presence.reason));
      }
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
      throw new Error(clicked?.reason || "Flow chưa xác nhận menu Animate của đúng card ảnh");
    }

    let verified = {};
    let lastReason = "no_ingredient_chip";
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt === 0 ? 700 : 400));
      verified = await this.evaluate(page, animateIngredientStateCode(selectedMediaId)).catch(() => ({}));
      const state = verifyFlowIngredientChip(verified, selectedMediaId, { explicit });
      if (state.ready) {
        return {
          status: "ready",
          editorFound: true,
          referenceAttached: true,
          sourceMediaId: state.sourceMediaId || selectedMediaId,
          chipCount: Number(verified.ingredientCount ?? 1),
          explicitMedia: explicit,
          message: explicit
            ? "BrowserOS đã click Animate và xác nhận ingredient đúng media ID đã xác nhận thủ công."
            : "BrowserOS đã click Animate và xác nhận ingredient đúng media ID trong video composer.",
        };
      }
      lastReason = state.reason;
    }
    throw new Error(flowExactMediaMessage(lastReason));
  }

  async download(page, shotId, revisionId, runId, mediaId, outputDir) {
    const observed = await this.inspect(page, shotId, revisionId, runId);
    const safetySnapshot = await this.snapshot(page).catch(() => ({ refs: [] }));
    const destructiveOverlay = safetySnapshot.refs.some((item) => {
      const label = String(item.label || "").trim().toLowerCase();
      return label.includes("delete permanently")
        || label.includes("moved to trash")
        || label === "trashed";
    });
    if (destructiveOverlay) {
      throw new Error("FLOW_DESTRUCTIVE_OVERLAY_VISIBLE: Flow đang ở màn hình Trash/Delete; dừng mọi click để bảo vệ asset. Hãy bấm Undo/Back thủ công rồi chạy resume.");
    }
    const newestMediaRequested = mediaId === "__newest__";
    if (!newestMediaRequested && !observed.generationActive && observed.matchingBatchMediaCount === 0 && (!mediaId || !observed.mediaIds.includes(mediaId))) {
      throw new Error("Flow chưa có media mới đúng batch hiện tại; không tải card lịch sử");
    }
    let selectedMediaId = newestMediaRequested ? null : mediaId;
    // A page-wide snapshot has many Download buttons for history cards. Use a
    // fresh DOM query scoped to the exact batch identity before triggering the
    // browser download; never select the first generic Download ref.
    const userProfile = process.env.USERPROFILE;
    const downloadsDirectory = userProfile ? resolve(userProfile, "Downloads") : null;
    const beforeDownloadNames = downloadsDirectory
      ? new Set(await readdir(downloadsDirectory).catch(() => []))
      : new Set();
    const downloadStartedAt = Date.now();
    let exactAssetDiagnostic = "not_attempted";
    const saveExactMediaAsset = async () => {
      if (!selectedMediaId) return null;
      const asset = await this.evaluate(page, exactMediaAssetCode(selectedMediaId)).catch((error) => {
        exactAssetDiagnostic = `evaluate_failed=${String(error?.message || error).slice(0, 240)}`;
        return null;
      });
      if (!asset?.base64 || !/^image\/(?:png|jpeg|webp)$/i.test(String(asset.mime || ''))) {
        exactAssetDiagnostic = String(asset?.reason || "exact_media_asset_not_available").slice(0, 320);
        return null;
      }
      const extension = /png/i.test(asset.mime) ? '.png' : /webp/i.test(asset.mime) ? '.webp' : '.jpg';
      const rawPath = resolve(this.workspace, '.auto3dvideo', 'browseros', 'downloads', `flow-raw-${runId}-${shotId}${extension}`);
      await mkdir(dirname(rawPath), { recursive: true });
      await writeFile(rawPath, Buffer.from(asset.base64, 'base64'));
      const info = await stat(rawPath).catch(() => null);
      if (!info?.isFile() || info.size === 0) {
        exactAssetDiagnostic = "exact_media_asset_file_empty";
        return null;
      }
      exactAssetDiagnostic = `saved_${asset.sourceKind || "browser_asset"}`;
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
      // Use BrowserOS's download helper for the final size item first. A
      // normal act/click can report success while leaving the Angular menu
      // open without dispatching Chrome's native download event.
      let sizeRefError = "";
      try {
        const result = await this.tool("download", { page, ref: sizeRef.reference }, { timeoutMs: 8_000 });
        return { found: true, clicked: true, clickMethod: "browseros_download_size_tool", downloadSizeLabel: sizeRef.label, downloadDetail: JSON.stringify(result).slice(0, 1600) };
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
        // Compatibility fallback for bridge builds that reject the
        // specialized helper before dispatching the click.
        await this.click(page, sizeRef.reference);
        downloadDetail = `download_helper_error=${sizeRefError || "unknown"}`;
      } catch (error) {
        downloadDetail = `download_helper_error=${String(error?.message || error).slice(0, 300)}`;
      }
      return { found: true, clicked: true, clickMethod: "browseros_download_size", downloadSizeLabel: sizeRef.label, downloadDetail };
    };
    // A fresh media ID is stronger evidence than a page-wide Download ref.
    // Prefer saving that exact resource directly; this handles BrowserOS
    // bridges that click the Flow menu but do not expose the native file path.
    let clicked = null;
    if (selectedMediaId) {
      const exactAssetPath = await saveExactMediaAsset();
      if (exactAssetPath) clicked = { found: true, clicked: true, clickMethod: "browseros_exact_media_asset", sourcePath: exactAssetPath };
    }
    // The Flow detail view exposes one toolbar button named "Download media"
    // even when the current card has no flow-batch-info identity. Prefer that
    // unique detail-route control over a tile/history scan; the filesystem
    // check below remains the only success evidence.
    const detailRoute = /\/edit\/[^/?#]+/i.test(this.state.pageUrl || "");
    if (!clicked && detailRoute) {
      const detailSnapshot = await this.snapshot(page).catch(() => ({ refs: [] }));
      const detailDownloads = detailSnapshot.refs.filter((item) => item.role === "button" && /^download media$/i.test(item.label.trim()));
      if (detailDownloads.length === 1) {
        await this.click(page, detailDownloads[0].reference);
        clicked = { found: true, clicked: true, clickMethod: "browseros_detail_toolbar_download_media", buttonLabel: detailDownloads[0].label };
        const nestedSizeDownload = await chooseDownloadSize();
        if (nestedSizeDownload?.clicked) clicked = nestedSizeDownload;
      }
    }
    // The Flow detail view can already be left with the size menu open after
    // a previous click. Consume that exact menu item before looking for the
    // parent Download button, otherwise the next click only toggles the menu.
    if (!clicked && !newestMediaRequested) clicked = await chooseDownloadSize();
    if (!clicked && !newestMediaRequested) {
      const prepared = await this.evaluate(page, exactBatchDownloadCode(shotId, revisionId, runId));
      if (prepared?.prepared && prepared.marker) {
        const freshDownloadSnapshot = await this.snapshot(page).catch(() => ({ refs: [] }));
        const exactDownloadRef = freshDownloadSnapshot.refs.find((item) => item.role === 'button' && item.label.trim() === 'Auto3DVideo exact Download batch');
        if (exactDownloadRef) {
          try {
            const result = await this.tool('download', { page, ref: exactDownloadRef.reference }, { timeoutMs: 8_000 });
            const downloadDetail = contentText(result);
            const zipPath = downloadedBrowserOsZipPath(result);
            const extracted = zipPath ? await extractFlowDownloadZip(zipPath, this.workspace, runId, shotId) : null;
            clicked = { found: true, clicked: true, clickMethod: 'browseros_snapshot_exact_batch_download', sourcePath: extracted?.rawPath || null, downloadDetail: JSON.stringify(result).slice(0, 1600), extractedSourceName: extracted?.sourceName || null, extractedSizeBytes: extracted?.sizeBytes || null };
          } catch (error) {
            exactAssetDiagnostic = `exact_batch_download_tool_failed=${String(error?.message || error).slice(0, 300)}`;
            try {
              await this.click(page, exactDownloadRef.reference);
              clicked = { found: true, clicked: true, clickMethod: 'browseros_snapshot_exact_batch_click', downloadDetail: exactAssetDiagnostic };
            } catch (clickError) {
              exactAssetDiagnostic += `; exact_batch_click_failed=${String(clickError?.message || clickError).slice(0, 260)}`;
            }
          }
        } else {
          exactAssetDiagnostic = 'exact_batch_download_ref_not_exposed_after_dom_marker';
        }
      }
    }
    // Fail closed here. The old implementation opened More options, then
    // tried right-click/left-click fallbacks on a tile. In Flow those refs can
    // resolve to the project-level Trash/Delete controls after a route change.
    // A missing direct Download control is a recoverable block, never a reason
    // to guess another coordinate or menu.
    if (!clicked?.clicked || !clicked?.found) {
      const reason = clicked?.reason ? ` ${String(clicked.reason).slice(0, 420)}` : "";
      throw new Error(`FLOW_DOWNLOAD_CONTROL_NOT_EXPOSED: không có Download trực tiếp đã scope vào media/batch hiện tại; không mở More options, lightbox, context menu hoặc click tọa độ dự phòng để bảo vệ asset.${reason} diagnostic=${exactAssetDiagnostic}`);
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
    if (!source) {
      const visibleFiles = downloadsDirectory
        ? (await readdir(downloadsDirectory).catch(() => [])).filter((name) => /\\.(png|jpe?g|webp)$/i.test(name)).slice(-20)
        : [];
      const diagnostic = [
        `mediaId=${selectedMediaId || "none"}`,
        `observedMediaIds=${(observed.mediaIds || []).join(",") || "none"}`,
        `clickMethod=${clicked?.clickMethod || "none"}`,
        `downloadDir=${downloadsDirectory || "unresolved"}`,
        `exactAsset=${exactAssetDiagnostic}`,
        `candidates=${candidates.join("|") || "none"}`,
        `visibleFiles=${visibleFiles.join("|") || "none"}`,
        detail ? `detail=${detail.slice(0, 900)}` : "detail=none",
      ].join("; ");
      throw new Error(`BrowserOS báo download nhưng không tìm thấy file ảnh thật: ${diagnostic}`);
    }
    const destinationDir = resolve(this.workspace, outputDir);
    const canonicalWorkspace = resolve(this.workspace);
    if (!(destinationDir === canonicalWorkspace || destinationDir.startsWith(`${canonicalWorkspace}${sep}`))) throw new Error("Flow download output vượt project workspace");
    await mkdir(destinationDir, { recursive: true });
    const extension = source.slice(source.lastIndexOf(".")).toLowerCase();
    const destination = resolve(destinationDir, `flow-${shotId}-${revisionId}${extension}`);
    await copyFile(source, destination);
    const info = await stat(destination);
    if (!info.isFile() || info.size === 0) throw new Error("Flow download copy rỗng");
 return { status: "ready", downloadStarted: true, downloadName: destination.split(/[\\/]/).pop(), downloadSizeBytes: info.size, sourceMediaId: selectedMediaId || (newestMediaRequested ? null : observed.mediaIds.at(-1)) || null, downloadPath: destination, clickMethod: clicked.clickMethod, message: newestMediaRequested ? `BrowserOS đã tải tile media mới nhất sau khi DOM chứng minh delta +1 (${info.size} bytes).` : `BrowserOS đã click Download của đúng batch Flow và copy ảnh vào workspace (${info.size} bytes).` };
  }

  async execute(operation, spec) {
    const page = await this.ensurePage(spec.projectUrl);
    this.pageAttached = true;
    if (operation === "flow_select_video_model") {
      const result = await this.selectVideoModel(page, spec.model).catch((error) => ({
        status: "blocked",
        modelSelected: false,
        currentUrl: this.state.pageUrl,
        message: String(error?.message || error).slice(0, 800),
      }));
      return { ...result, page, targetUrl: result.currentUrl || this.state.pageUrl };
    }
    if (operation === "flow_inspect_video_settings") {
      const beforeSnapshot = await this.snapshot(page);
      const generateRefs = beforeSnapshot.refs.filter((item) => item.role === "button" && /^bắt đầu tạo$/i.test(item.label.trim()));
      if (generateRefs.length !== 1) {
        return {
          status: "blocked",
          page,
          targetUrl: this.state.pageUrl,
          generateButtonCount: generateRefs.length,
          message: "Snapshot mới không xác nhận đúng một nút Bắt đầu tạo; không mở cài đặt video và không Generate.",
        };
      }
      const projectKey = new URL(this.state.pageUrl).pathname.match(/\/project\/([A-Za-z0-9-]+)/i)?.[1] || "";
      const opened = await this.evaluate(page, openVideoSettingsCode(projectKey)).catch(() => null);
      if (opened?.status !== "opened" || opened.projectKey !== projectKey) {
        return {
          ...(opened || {}),
          status: "blocked",
          page,
          targetUrl: this.state.pageUrl,
          message: "Flow không xác nhận đúng nút cài đặt video của project hiện tại; không nhập prompt và không Generate.",
        };
      }
      let state = {};
      const evidenceReady = (value) =>
        value?.videoModeFound === true
        && value?.promptEditorFound === true
        && /\b(?:omni|veo)\b/i.test(String(value?.selectedModel || ""))
        && Array.isArray(value?.selectedSettingsEvidence)
        && value.selectedSettingsEvidence.length >= 3
        && Array.isArray(value?.visibleCreditTexts)
        && value.visibleCreditTexts.length > 0;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        state = await this.evaluate(page, inspectComposerCode).catch(() => ({}));
        if (evidenceReady(state)) break;
        if (attempt < 11) await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      }
      const snapshot = await this.snapshot(page).catch(() => ({ refs: [] }));
      const ready = evidenceReady(state);
      return {
        ...opened,
        ...state,
        settingsMenuOpened: ready,
        uiRefs: snapshot.refs,
        status: ready ? "ready" : "blocked",
        page,
        targetUrl: this.state.pageUrl,
        message: ready
          ? "Đã xác minh model, cài đặt Video và giá trong đúng project; không đổi model/cài đặt, không nhập prompt và không Generate."
          : "Đã mở bảng cài đặt nhưng Flow chưa phơi bày đủ model, settings và giá; không nhập prompt và không Generate.",
      };
    }
    if (operation === "flow_select_model") {
      const result = await this.model(page);
      return { ...result, page, targetUrl: result.currentUrl || this.state.pageUrl };
    }
    if (operation === "flow_inspect_composer") {
      const state = await this.evaluate(page, inspectComposerCode);
      const snapshot = await this.snapshot(page).catch(() => ({ refs: [] }));
      const snapshotGenerate = snapshot.refs.some((item) => item.role === "button" && /^(?:start generation|generate image|generate video|generate|tạo ảnh|tạo video|bắt đầu tạo)$/i.test(item.label.trim()));
      const imageComposerReady = state.imageModeFound && state.promptEditorFound && state.addIngredientsFound && (state.generationButtonFound || snapshotGenerate);
      const videoComposerReady = state.videoModeFound && state.promptEditorFound && (state.videoGenerateButtonFound || snapshotGenerate);
      const ready = imageComposerReady || videoComposerReady;
      return {
        ...state,
        generationButtonFound: Boolean(state.generationButtonFound || (imageComposerReady && snapshotGenerate)),
        videoGenerateButtonFound: Boolean(state.videoGenerateButtonFound || (videoComposerReady && snapshotGenerate)),
        imageModeFound: Boolean(state.imageModeFound || imageComposerReady),
        videoModeFound: Boolean(state.videoModeFound || videoComposerReady),
        videoComposerReady,
        status: ready ? "ready" : "blocked",
        page,
        targetUrl: state.currentUrl || this.state.pageUrl,
        message: videoComposerReady
          ? `BrowserOS đã xác nhận ${state.selectedModel} cùng video prompt composer; chưa nhập prompt và chưa Generate.`
          : imageComposerReady
            ? "BrowserOS đã xác nhận exact image editor + Add ingredients + Generate bằng DOM/snapshot mới."
            : "BrowserOS chưa xác nhận image hoặc video composer thật; không gõ vào chat.",
      };
    }
    if (operation === "flow_observe") {
      const snapshot = await this.snapshot(page);
      const flowState = await this.inspect(page, spec.shotId, spec.revisionId, spec.runId);
      return { status: "ready", operation: "browseros_observe_flow", observed: { controlCount: snapshot.refs.length, uiRefs: snapshot.refs, flowState }, page, targetUrl: this.state.pageUrl };
    }
    if (operation === "flow_type_prompt") return { ...(await this.typePrompt(page, safePrompt(spec.prompt), spec.submit === true)), page, targetUrl: this.state.pageUrl };
    if (operation === "flow_type_video_prompt") {
      return { ...(await this.typeVideoPrompt(page, safePrompt(spec.prompt), spec.projectUrl, Number(spec.expectedCreditCost), spec.model, spec.mediaId ? safeMediaIdArgument(spec.mediaId) : null)), page, targetUrl: this.state.pageUrl };
    }
    if (operation === "flow_click_video_generate") {
      return { ...(await this.clickVideoGenerate(page, safePrompt(spec.prompt), spec.projectUrl, Number(spec.expectedCreditCost), spec.model, spec.mediaId ? safeMediaIdArgument(spec.mediaId) : null)), page, targetUrl: this.state.pageUrl };
    }
    if (operation === "flow_click_generate") return { ...(await this.clickGenerate(page)), page, targetUrl: this.state.pageUrl };
    if (operation === "flow_animate_image") return { ...(await this.animate(page, safeId(spec.shotId, "shotId"), safeId(spec.revisionId, "revisionId"), spec.mediaId ? safeMediaIdArgument(spec.mediaId) : null)), page, targetUrl: this.state.pageUrl };
    if (operation === "flow_list_image_cards") {
      const listed = await this.listImageCards(page, Math.min(Math.max(Number(spec.limit) || MAX_FLOW_IMAGE_CARDS, 1), MAX_FLOW_IMAGE_CARDS));
      return {
        ...listed,
        page,
        targetUrl: this.state.pageUrl,
        flowProjectId: flowProjectIdFromProjectUrl(this.state.pageUrl || spec.projectUrl),
        message: listed.found
          ? `Đã đọc ${listed.cards.length} card ảnh đang hiển thị trong project Flow; không click, không upload, không Generate.`
          : "Project Flow hiện tại không có card ảnh nào đang hiển thị để đối chiếu.",
      };
    }
    if (operation === "flow_inspect_output") {
      const snapshot = await this.snapshot(page);
      const state = await this.inspect(page, spec.shotId, spec.revisionId, spec.runId);
      return { ...state, uiRefs: snapshot.refs, page, targetUrl: this.state.pageUrl, status: state.mediaIds?.length > 0 || state.matchingBatchCount > 0 || state.generationActive || state.promptEditorFound ? "ready" : "blocked" };
    }
    if (operation === "flow_download_image") return { ...(await this.download(page, safeId(spec.shotId, "shotId"), safeId(spec.revisionId, "revisionId"), safeId(spec.runId, "runId", /^[a-z0-9][a-z0-9-]{2,80}$/), spec.mediaId ? safeMediaIdArgument(spec.mediaId) : null, safeText(spec.outputDir, "outputDir", 300))), page, targetUrl: this.state.pageUrl };
    if (operation === "flow_download_video_output") {
      return {
        ...(await this.downloadVideoOutput(
          page,
          spec.projectUrl,
          safeId(spec.shotId, "shotId"),
          safeId(spec.revisionId, "revisionId"),
          safeId(spec.runId, "runId", /^[a-z0-9][a-z0-9-]{2,80}$/),
        )),
        page,
        targetUrl: this.state.pageUrl,
      };
    }
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
      model: arg("--model"),
      expectedCreditCost: Number(arg("--expected-credit-cost")),
      limit: Number(arg("--limit")) || undefined,
    });
    report = { ...result, status: result.status || "ready", operation, reportPath: output, serverInfo: browser.serverInfo || { name: browser.endpoint.includes(":9000/") ? "browseros_mcp" : "browseros-neo", title: browser.endpoint.includes(":9000/") ? "BrowserOS MCP server" : "BrowserOS neo" }, protocolVersion: browser.protocolVersion, tools: browser.tools, browserSessionAttached: true, browserActionsPerformed: true, networkCallsMade: true, message: result.message || `BrowserOS ${operation} đã hoàn tất.` };
  } catch (error) {
    report = {
      status: "blocked",
      operation,
      reportPath: output,
      serverInfo: browser.serverInfo,
      protocolVersion: browser.protocolVersion,
      tools: browser.tools,
      browserSessionAttached: browser.pageAttached || Number.isInteger(browser.state.pageId),
      browserActionsPerformed: browser.browserActionsPerformed,
      networkCallsMade: browser.pageAttached,
      message: String(error?.message || error).slice(0, 1200),
    };
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2), "utf8");
  if (report.status === "blocked") process.exitCode = 2;
}

// The worker is a CLI entry point, but its decision methods are also exercised
// directly by focused tests, so it only runs when invoked as a script.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(String(error?.stack || error)); process.exitCode = 1; });
}

export { BrowserOsFlow };
