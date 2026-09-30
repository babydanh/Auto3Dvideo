import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// GitHub BrowserOS exposes the local MCP proxy on 9000. BrowserOS neo can
// still be selected explicitly with AUTO3DVIDEO_BROWSEROS_MCP_ENDPOINT=9010.
const DEFAULT_ENDPOINT = "http://127.0.0.1:9000/mcp";
const REQUEST_TIMEOUT_MS = 45_000;
const TYPE_TIMEOUT_MS = 90_000;
// Flow can take several seconds to paint the project/media workspace. Ten
// seconds caused a screenshot timeout to masquerade as a route/composer
// failure, so keep the wait bounded but give the real page enough time.
const SCREENSHOT_TIMEOUT_MS = 30_000;
const ROUTE_SETTLE_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_SNAPSHOT_CHARS = 120_000;
const MAX_UI_REFS = 80;
const SAFE_HOSTS = new Set([
  "ai.google.dev",
  "aistudio.google.com",
  "gemini.google.com",
  "labs.google",
  "flow.google",
  "flow.google.com",
]);
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

function safeUrl(value) {
  const parsed = new URL(safeText(value, "URL Flow", 500));
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
    throw new Error("URL Flow phải là HTTPS, không có credential/query/hash/port");
  }
  if (!SAFE_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error("URL chỉ được dùng Google host allowlist");
  }
  return parsed.toString();
}

function isFlowUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && (parsed.hostname === "flow.google.com"
        || parsed.hostname === "flow.google"
        || parsed.hostname === "labs.google" && parsed.pathname.startsWith("/fx/tools/flow"));
  } catch {
    return false;
  }
}

function flowProjectIdFromUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname !== "flow.google.com") return null;
    const match = parsed.pathname.match(/^\/project\/([^/]+)(?:\/|$)/i);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function isFlowProjectRoot(value, projectId) {
  try {
    const parsed = new URL(value);
    return parsed.hostname === "flow.google.com"
      && parsed.pathname.replace(/\/$/, "") === `/project/${encodeURIComponent(projectId)}`;
  } catch {
    return false;
  }
}

function safePageId(value) {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 0 || page > 2 ** 31 - 1) {
    throw new Error("pageId không hợp lệ");
  }
  return page;
}

function parseSse(text, id) {
  const plain = String(text).trim();
  if (plain.startsWith("{") || plain.startsWith("[")) {
    try {
      const response = JSON.parse(plain);
      if (response?.id === id || response?.result || response?.error) {
        if (response.error) {
          throw new Error(`BrowserOS MCP ${response.error.code ?? "error"}: ${String(response.error.message || "request failed").slice(0, 900)}`);
        }
        return response.result ?? response;
      }
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("BrowserOS MCP không trả JSON-RPC response");
      throw error;
    }
  }
  const candidates = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      candidates.push(JSON.parse(payload));
    } catch {
      // Keep reading the SSE stream; BrowserOS also sends keepalive frames.
    }
  }
  const response = candidates.find((item) => item && item.id === id) || candidates.at(-1);
  if (!response) throw new Error("BrowserOS MCP không trả JSON-RPC response");
  if (response.error) {
    throw new Error(`BrowserOS MCP ${response.error.code ?? "error"}: ${String(response.error.message || "request failed").slice(0, 900)}`);
  }
  return response.result ?? response;
}

function contentText(result) {
  return (Array.isArray(result?.content) ? result.content : [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function imageContent(result) {
  return (Array.isArray(result?.content) ? result.content : [])
    .find((item) => item?.type === "image" && typeof item.data === "string");
}

function extractPageUrl(text, page) {
  const escaped = String(page).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text).match(new RegExp(`(?:^|\\n)\\[${escaped}\\]\\s+(\\S+)\\s+\\(`));
  if (!match) return null;
  try {
    return safeUrl(match[1]);
  } catch {
    return null;
  }
}

function extractUiRefs(text) {
  const refs = [];
  const seen = new Set();
  for (const line of String(text).split(/\r?\n/).slice(0, 1200)) {
    const refMatch = line.match(/\[ref=([^\]]+)\]/);
    if (!refMatch) continue;
    const reference = refMatch[1].trim();
    if (!reference || reference.length > 80 || seen.has(reference)) continue;
    const before = line.slice(0, refMatch.index).trim().replace(/^[-*]\s*/, "");
    const role = before.split(/\s+/, 1)[0] || "element";
    const quoted = before.match(/"([^"]*)"|“([^”]*)”/);
    const label = (quoted?.[1] ?? quoted?.[2] ?? role).slice(0, 120);
    refs.push({ role, label, reference });
    seen.add(reference);
  }

  const priority = ({ role, label }) => {
    const normalized = label.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi-VN");
    const kind = role.toLowerCase();
    if (kind === "button" && /^(?:bắt đầu tạo|start generation|generate|generate video|tạo video|tạo ảnh)$/.test(normalized)) return true;
    if (kind === "radio" && normalized === "video") return true;
    if (/^(?:textbox|textarea|input|contenteditable|generic|paragraph)$/.test(kind)
      && /^(?:văn bản có thể chỉnh sửa|textbox|generic|paragraph)$/.test(normalized)) return true;
    if (/thêm thành phần vào ô nhập câu lệnh|add ingredients.*prompt|prompt.*ingredients/.test(normalized)) return true;
    if (/\b(?:omni|veo)\b/.test(normalized) || /\b\d+\s*tín\s+dụng\b|\b\d+\s*credits?\b/.test(normalized)) return true;
    if (/out of credits?|credits? exhausted|no credits|not enough credits?|insufficient credits?|credit required|quota (?:exceeded|exhausted)|limit reached|hết credit|không đủ credit|hết hạn mức|payment required|upgrade to generate/.test(normalized)) return true;
    if (kind === "button" && /^(?:download|tải xuống|export|xuất)$/.test(normalized)) return true;
    return false;
  };
  const priorityRefs = refs.filter(priority);
  const priorityReferences = new Set(priorityRefs.map((item) => item.reference));
  const regularRefs = refs.filter((item) => !priorityReferences.has(item.reference));
  const reserved = Math.min(MAX_UI_REFS, priorityRefs.length);
  return [
    ...regularRefs.slice(0, MAX_UI_REFS - reserved),
    ...priorityRefs.slice(0, MAX_UI_REFS),
  ];
}

function normalizeControlLabel(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi-VN");
}

function boundedDetail(value) {
  return String(value || "").replace(/(api[_-]?key|access[_-]?token|authorization|password|secret|token)\s*[:=]\s*\S+/gi, "$1=[redacted]").slice(0, 900);
}

function operationErrorText(result) {
  if (!result || result.isError !== true) return "";
  return contentText(result) || result.error?.message || "BrowserOS act bị từ chối";
}

function isKnownMaterialClickCover(value) {
  const message = String(value?.message || value || "").toLowerCase();
  // BrowserOS can reject a semantic click when Angular Material's own
  // mat-focus-indicator span wins the center-point hit test. This is a
  // descendant visual layer, not an unrelated modal or consent surface.
  return message.includes("at its click point")
    && /covered by\s*<span\.mat-focus-indicator>/i.test(String(value?.message || value || ""));
}

function operationTool(operation) {
  switch (operation) {
    case "navigate": return "navigate";
    case "snapshot":
    case "verify_upload": return "snapshot";
    case "screenshot": return "screenshot";
    case "wait": return "wait";
    case "click":
    case "click_project":
    case "click_ingredients":
    case "click_storyboard":
    case "type":
    case "press_key": return "act";
    case "download": return "download";
    default: return null;
  }
}

function normalizeOperation(operation) {
  const value = safeText(operation, "operation", 32);
  if (value === "verify_upload") return "snapshot";
  if (["click_project", "click_ingredients", "click_storyboard"].includes(value)) return "click";
  return value;
}

function parseOpenedPage(text) {
  const match = String(text).match(/opened page (\d+)/i);
  return match ? safePageId(match[1]) : null;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}

class BrowserOsMcp {
  constructor({ endpoint, statePath, workspace }) {
    this.endpoint = endpoint;
    this.statePath = statePath;
    this.workspace = workspace;
    this.state = {};
    this.nextId = 1;
    this.sessionId = null;
    this.serverInfo = null;
    this.protocolVersion = null;
    this.tools = [];
  }

  async initialize() {
    this.state = await readJson(this.statePath);
    const storedEndpoint = typeof this.state.endpoint === "string" ? this.state.endpoint : null;
    const storedServerName = this.state.serverInfo?.name;
    const endpointChanged = storedEndpoint !== null && storedEndpoint !== this.endpoint;
    const legacyNeoStateOnGithubBrowser = storedEndpoint === null
      && storedServerName === "browseros-neo"
      && this.endpoint.includes(":9000/");
    if (endpointChanged || legacyNeoStateOnGithubBrowser) {
      // A page id belongs to one BrowserOS bridge/profile. Never carry a neo
      // page into the GitHub BrowserOS bridge (or vice versa).
      this.state = {};
    }
    this.serverInfo = this.state.serverInfo || null;
    this.protocolVersion = this.state.protocolVersion || null;
    if (typeof this.state.sessionId === "string") this.sessionId = this.state.sessionId;
    this.serverInfo = this.state.serverInfo || null;
    this.protocolVersion = this.state.protocolVersion || null;
    if (this.sessionId) {
      try {
        await this.call("tools/list", {});
        this.tools = this.state.tools || [];
        if (this.tools.length) {
          await this.reconcileStoredPage();
          await this.persistState();
          return;
        }
      } catch {
        this.sessionId = null;
        this.state = {};
      }
    }
    const result = await this.call("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "auto3dvideo-browseros", version: "1.0.0" },
    }, { includeSession: false });
    this.serverInfo = result.serverInfo || null;
    this.protocolVersion = result.protocolVersion || null;
    const listed = await this.call("tools/list", {});
    this.tools = Array.isArray(listed.tools) ? listed.tools.map((item) => item.name).filter(Boolean) : [];
    await this.reconcileStoredPage();
    await this.persistState();
  }

  async reconcileStoredPage() {
    if (!Number.isInteger(this.state.pageId)) return;
    try {
      const tabs = await this.listTabs();
      const tabsText = contentText(tabs).split("Other agents' tabs:")[0];
      const pageMarker = `[${this.state.pageId}]`;
      if (!tabsText.includes(pageMarker)) {
        this.state.pageId = null;
        this.state.automationPageId = null;
        this.state.pageUrl = null;
      }
    } catch {
      // The page will be revalidated by ensurePage; do not turn a transient
      // tabs-list failure into a false success.
    }
  }

  async persistState() {
    await writeJson(this.statePath, {
      schemaVersion: "1.0.0",
      endpoint: this.endpoint,
      sessionId: this.sessionId,
      pageId: this.state.pageId ?? null,
      automationPageId: this.state.automationPageId ?? null,
      pageUrl: this.state.pageUrl ?? null,
      // BrowserOS Flow worker stores the verified Nano Banana model gate in
      // the same session file. Keep it when the generic MCP worker refreshes
      // tabs/snapshots; otherwise the next type/generate process sees a
      // missing fingerprint and falsely blocks at the next shot.
      flowComposerFingerprint: this.state.flowComposerFingerprint ?? null,
      serverInfo: this.serverInfo,
      protocolVersion: this.protocolVersion,
      tools: this.tools.slice(0, 64),
      updatedAt: new Date().toISOString(),
    });
  }

  async call(method, params, options = {}) {
    const id = this.nextId++;
    const headers = {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "Mcp-Protocol-Version": "2025-03-26",
    };
    if (this.sessionId && options.includeSession !== false) headers["Mcp-Session-Id"] = this.sessionId;
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("BrowserOS MCP response vượt giới hạn");
      if (!response.ok) throw new Error(`BrowserOS MCP HTTP ${response.status}: ${boundedDetail(text)}`);
      const responseSession = response.headers.get("mcp-session-id");
      if (responseSession) this.sessionId = responseSession;
      const result = parseSse(text, id);
      const structuredSession = result?.structuredContent?.session;
      if (typeof structuredSession === "string" && structuredSession.trim()) this.sessionId = structuredSession;
      return result;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`BrowserOS MCP timeout sau ${timeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async tool(name, argumentsValue, options = {}) {
    if (!this.tools.includes(name)) throw new Error(`BrowserOS MCP thiếu tool ${name}`);
    const toolArguments = { ...argumentsValue };
    if (this.sessionId) toolArguments.session = this.sessionId;
    return this.call("tools/call", { name, arguments: toolArguments }, options);
  }

  async listTabs() {
    return this.tool("tabs", { action: "list" });
  }

  async pageUrl(page) {
    const result = await this.listTabs();
    const url = extractPageUrl(contentText(result), page);
    if (url) {
      this.state.pageUrl = url;
      await this.persistState();
    }
    return url;
  }

  async ensurePage(requestUrl) {
    const requested = requestUrl ? safeUrl(requestUrl) : null;
    if (requested && !isFlowUrl(requested)) {
      throw new Error("BLOCKED_NON_FLOW_BROWSEROS_URL: BrowserOS actions are restricted to a verified Google Flow page.");
    }
    const adoptOwnedPage = async () => {
      const tabs = await this.listTabs();
      const ownTabsText = contentText(tabs).split("Other agents' tabs:")[0];
      const candidates = [...ownTabsText.matchAll(/\[(\d+)\]\s+(https:\/\/flow\.google\.com\S*)/g)]
        .map((match) => ({ page: Number(match[1]), url: match[2].replace(/[)\],]+$/, "") }))
        .filter((item) => !requested || item.url === requested || item.url.startsWith(`${requested}/`));
      const preferredUrl = typeof this.state.pageUrl === "string" ? this.state.pageUrl : null;
      candidates.sort((left, right) => {
        const score = (url) => preferredUrl && (url === preferredUrl || url.startsWith(`${preferredUrl}/`)) ? 1 : 0;
        return score(right.url) - score(left.url);
      });
      for (const candidate of candidates) {
        const viewport = await this.viewport(candidate.page);
        if (viewport && viewport.width > 0 && viewport.height > 0) {
          this.state.pageId = candidate.page;
          this.state.pageUrl = safeUrl(candidate.url);
          await this.persistState();
          return candidate.page;
        }
      }
      return null;
    };
    let rejectedPageId = false;
    if (Number.isInteger(this.state.pageId)) {
      try {
        await this.tool("snapshot", { page: this.state.pageId });
        if (requestUrl) {
          const requested = safeUrl(requestUrl);
          const current = await this.pageUrl(this.state.pageId);
          const viewport = await this.viewport(this.state.pageId);
          if (viewport && (viewport.width <= 0 || viewport.height <= 0)) {
            // Keep DOM-only background tabs out of the action path. They can
            // report refs while still having no hit-testable viewport.
            this.state.pageId = null;
          } else if (!current || (current !== requested && !current.startsWith(`${requested}/`))) {
            await this.tool("navigate", { page: this.state.pageId, action: "url", url: requested });
            this.state.pageUrl = requested;
            await this.persistState();
            await this.waitForFlowReady(this.state.pageId);
            return this.state.pageId;
          } else {
            return this.state.pageId;
          }
        } else {
          const current = await this.pageUrl(this.state.pageId);
          if (!isFlowUrl(current)) {
            this.state.pageId = null;
            this.state.pageUrl = null;
            rejectedPageId = true;
            await this.persistState();
          } else {
            const viewport = await this.viewport(this.state.pageId);
            if (!viewport || viewport.width > 0 && viewport.height > 0) return this.state.pageId;
            this.state.pageId = null;
          }
        }
      } catch {
        this.state.pageId = null;
      }
    }
    const adopted = await adoptOwnedPage().catch(() => null);
    if (adopted !== null) return adopted;
    if (rejectedPageId) {
      throw new Error("BLOCKED_NON_FLOW_BROWSEROS_TAB: saved page ID no longer identifies a Google Flow page; no action or replacement tab was started.");
    }
    if (Number.isInteger(this.state.automationPageId)) {
      // A closed/crashed automation tab is recoverable. Only clear the guard
      // when BrowserOS explicitly lists that page id as gone; if it still
      // exists but is merely backgrounded/mismatched, keep blocking so a
      // retry cannot multiply Flow tabs.
      const tabs = await this.listTabs().catch(() => null);
      const tabsText = tabs ? contentText(tabs).split("Other agents' tabs:")[0] : null;
      const automationPageGone = tabsText !== null
        && !tabsText.includes(`[${this.state.automationPageId}]`);
      if (automationPageGone) {
        this.state.automationPageId = null;
        this.state.pageId = null;
        await this.persistState();
      } else {
        throw new Error("BrowserOS task tab không còn viewport; tab vẫn tồn tại hoặc chưa xác minh được. Không mở thêm tab để tránh nhân bản tab.");
      }
    }
    const url = requested || this.state.pageUrl || "https://flow.google.com/about";
    // BrowserOS can give background tabs a zero-sized viewport. Flow's visual
    // planner needs a real viewport, so the owned automation tab is visible.
    await this.tool("windows", { action: "create" }).catch(() => null);
    const opened = await this.tool("tabs", { action: "new", url: safeUrl(url), background: false });
    const page = parseOpenedPage(contentText(opened));
    if (page === null) throw new Error("BrowserOS MCP không trả page id khi mở tab");
    this.state.pageId = page;
    this.state.automationPageId = page;
    this.state.pageUrl = safeUrl(url);
    await this.persistState();
    await this.waitForFlowReady(page);
    const openedViewport = await this.viewport(page);
    if (openedViewport && (openedViewport.width <= 0 || openedViewport.height <= 0)) {
      throw new Error(`BrowserOS mở được Flow nhưng tab không có viewport thao tác (${openedViewport.width}x${openedViewport.height})`);
    }
    return page;
  }

  async viewport(page) {
    try {
      const result = await this.tool("evaluate", {
        page,
        code: "return {width: document.documentElement.clientWidth, height: document.documentElement.clientHeight};",
        timeout: 15_000,
      });
      const text = contentText(result);
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start < 0 || end <= start) return null;
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  async waitForFlowReady(page) {
    if (!Number.isInteger(page)) return;
    // A Flow project can expose only its shell for a few seconds after
    // navigation. This prevents the first snapshot from being mistaken for
    // the /about route while keeping the wait bounded and best-effort.
    for (const signal of ["Start generation", "Bắt đầu tạo", "What do you want to create"]) {
      try {
        await this.tool("wait", {
          page,
          for: "text",
          value: signal,
          timeout: ROUTE_SETTLE_TIMEOUT_MS,
        }, { timeoutMs: ROUTE_SETTLE_TIMEOUT_MS + 5_000 });
        return;
      } catch {
        // Try the next localized signal, then let the caller inspect the DOM.
      }
    }
  }

  async clickFlowVideoNavigation(page, currentUrl) {
    const projectId = flowProjectIdFromUrl(currentUrl);
    if (!projectId || !isFlowProjectRoot(currentUrl, projectId)) {
      throw new Error("BLOCKED_VIDEO_NAV_CONTEXT: Video chỉ được mở từ project Flow hiện tại.");
    }
    const code = `// AUTO3DVIDEO_FLOW_VIDEO_NAV
return (() => {
  const parts = location.pathname.split("/").filter(Boolean);
  if (location.protocol !== "https:" || location.hostname !== "flow.google.com" || parts.length !== 2 || parts[0] !== "project") {
    return JSON.stringify({ status: "blocked", reason: "not-project-root" });
  }
  const projectId = decodeURIComponent(parts[1]);
  const textNodes = [...document.querySelectorAll("body *")].filter((element) => {
    const label = (element.getAttribute("aria-label") || element.innerText || element.textContent || "").trim();
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return label === "Video" && rect.width > 0 && rect.height > 0
      && style.display !== "none" && style.visibility !== "hidden";
  });
  const targetSet = new Set();
  for (const element of textNodes) {
    let current = element;
    let selected = null;
    let pointerFallback = null;
    for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
      const style = getComputedStyle(current);
      if (current.matches('a[href],button,[role="link"],[role="button"],[role="tab"],[role="menuitem"],mat-list-item')) {
        selected = current;
        break;
      }
      if (!pointerFallback && current.tagName !== "SPAN" && style.cursor === "pointer") pointerFallback = current;
    }
    targetSet.add(selected || pointerFallback || element);
  }
  const targets = [...targetSet];
  const summaries = targets.slice(0, 4).map((element) => {
    const href = element.getAttribute("href");
    let sameProjectDestination = null;
    if (href) {
      try {
        const destination = new URL(href, location.href);
        const destinationParts = destination.pathname.split("/").filter(Boolean);
        sameProjectDestination = destination.hostname === location.hostname
          && destinationParts[0] === "project"
          && decodeURIComponent(destinationParts[1] || "") === projectId;
      } catch {
        sameProjectDestination = false;
      }
    }
    const style = getComputedStyle(element);
    const parentChain = [];
    for (let current = element, depth = 0; current && depth < 3; depth += 1, current = current.parentElement) {
      parentChain.push({
        tag: current.tagName.toLowerCase(),
        className: String(current.className || "").slice(0, 100),
        role: current.getAttribute("role"),
        tabIndex: current.tabIndex,
      });
    }
    return {
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role"),
      className: String(element.className || "").slice(0, 100),
      containsExactVideo: textNodes.some((node) => node === element || element.contains(node)),
      hrefPresent: Boolean(href),
      sameProjectDestination,
      tabIndex: element.tabIndex,
      pointerCursor: style.cursor === "pointer",
      disabled: Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true",
      parentChain,
    };
  });
  if (targets.length !== 1) {
    return JSON.stringify({
      status: "blocked",
      reason: "video-target-not-unique",
      matches: targets.length,
      exactTextCount: textNodes.length,
      candidates: summaries,
    });
  }
  const target = targets[0];
  if (target.disabled || target.getAttribute("aria-disabled") === "true") {
    return JSON.stringify({ status: "blocked", reason: "video-target-disabled" });
  }
  const href = target.getAttribute("href");
  if (href) {
    const destination = new URL(href, location.href);
    const destinationParts = destination.pathname.split("/").filter(Boolean);
    if (destination.hostname !== location.hostname || destinationParts[0] !== "project" || decodeURIComponent(destinationParts[1] || "") !== projectId) {
      return JSON.stringify({ status: "blocked", reason: "cross-project-video-target" });
    }
  }
  target.click();
  return JSON.stringify({ status: "clicked", label: "Video", projectId });
})()`;
    const evaluated = await this.tool("evaluate", { page, code, timeout: 15_000 });
    if (evaluated?.isError) throw new Error(operationErrorText(evaluated));
    const text = contentText(evaluated);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("BLOCKED_VIDEO_NAV_EVIDENCE: BrowserOS thiếu kết quả DOM xác minh Video.");
    const evidence = JSON.parse(text.slice(start, end + 1));
    if (evidence.status !== "clicked" || evidence.label !== "Video" || evidence.projectId !== projectId) {
      const diagnostics = JSON.stringify({
        matches: Number.isSafeInteger(evidence.matches) ? evidence.matches : null,
        exactTextCount: Number.isSafeInteger(evidence.exactTextCount) ? evidence.exactTextCount : null,
        candidates: Array.isArray(evidence.candidates) ? evidence.candidates.slice(0, 4) : [],
      }).slice(0, 1_500);
      throw new Error(`BLOCKED_VIDEO_NAV_TARGET: ${String(evidence.reason || evidence.status || "invalid evidence").slice(0, 120)} diagnostics=${diagnostics}`);
    }
    const afterUrl = await this.pageUrl(page);
    const afterPath = new URL(afterUrl).pathname.replace(/\/+$/, "");
    if (flowProjectIdFromUrl(afterUrl) !== projectId || afterPath.endsWith("/tools")) {
      throw new Error("BLOCKED_VIDEO_NAV_TARGET: điều hướng rời project hoặc mở trang Tools.");
    }
    return {
      result: { content: [{ type: "text", text: "DOM đã xác minh và mở đúng mục Video trong project Flow đang chọn." }] },
      resolvedTarget: { label: "Video", role: "link", reference: "dom:verified-flow-video-navigation" },
    };
  }

  async execute(request) {
    const operation = normalizeOperation(request.operation || "probe");
    const toolName = operationTool(operation);
    if (!toolName && operation !== "probe") throw new Error(`BrowserOS operation chưa allowlist: ${operation}`);
    if (operation !== "probe" && request.approved !== true) throw new Error("BrowserOS browser action cần approval rõ ràng");
    if (operation === "probe") return { result: null, page: null, currentUrl: null };

    let page = await this.ensurePage(request.url || undefined);
    let result;
    let interactionRecovery = null;
    let resolvedTarget = null;
    if (operation === "navigate") {
      result = await this.tool("navigate", { page, action: "url", url: safeUrl(request.url) });
    } else if (operation === "snapshot") {
      result = await this.tool("snapshot", { page });
    } else if (operation === "screenshot") {
      try {
        result = await this.tool("screenshot", { page, format: "png", fullPage: false }, { timeoutMs: SCREENSHOT_TIMEOUT_MS });
      } catch (error) {
        // A tab created by an earlier build may still be background-only. One
        // bounded foreground retry repairs that condition without guessing a
        // coordinate or silently marking the visual check as successful.
        if (!String(error?.message || error).toLowerCase().includes("0 width")) throw error;
        this.state.pageId = null;
        page = await this.ensurePage(this.state.pageUrl || request.url || undefined);
        result = await this.tool("screenshot", { page, format: "png", fullPage: false }, { timeoutMs: SCREENSHOT_TIMEOUT_MS });
      }
    } else if (operation === "wait") {
      const seconds = Number(request.time ?? 2);
      if (!Number.isFinite(seconds) || seconds < 0.1 || seconds > 30) throw new Error("wait time phải nằm trong khoảng 0.1..30 giây");
      result = await this.tool("wait", { page, for: "time", value: Math.round(seconds * 1000), timeout: Math.round((seconds + 5) * 1000) });
    } else if (operation === "download") {
      result = await this.tool("download", { page, ref: safeText(request.elementRef, "elementRef", 80) });
    } else if (operation === "click") {
      const requestedLabel = safeText(request.element, "element", 120);
      const freshSnapshot = await this.tool("snapshot", { page });
      if (freshSnapshot?.isError) throw new Error(operationErrorText(freshSnapshot));
      const requested = normalizeControlLabel(requestedLabel);
      const matchingTargets = extractUiRefs(contentText(freshSnapshot))
        .filter((item) => normalizeControlLabel(item.label) === requested);
      if (matchingTargets.length === 0) {
        if (requested !== "video") {
          throw new Error(`BLOCKED_STALE_FLOW_REF: không còn control có label chính xác “${requestedLabel}” trong snapshot mới.`);
        }
        const currentUrl = await this.pageUrl(page);
        const fallback = await this.clickFlowVideoNavigation(page, currentUrl);
        result = fallback.result;
        resolvedTarget = fallback.resolvedTarget;
      } else {
        if (matchingTargets.length > 1) {
          throw new Error(`BLOCKED_AMBIGUOUS_FLOW_TARGET: có nhiều control cùng label “${requestedLabel}” trong snapshot mới.`);
        }
        const target = matchingTargets[0];
        if (!["button", "link", "menuitem", "option", "tab", "checkbox", "radio", "switch"].includes(target.role)) {
          throw new Error(`BLOCKED_NONINTERACTIVE_FLOW_TARGET: label “${target.label}” có role “${target.role}”.`);
        }
        const ref = target.reference;
        resolvedTarget = { label: target.label, role: target.role, reference: ref };
        try {
          result = await this.tool("act", { page, kind: "click", ref });
          const toolError = operationErrorText(result);
          if (toolError && isKnownMaterialClickCover(toolError)) {
            result = await this.tool("act", { page, kind: "press", ref, key: "Enter" });
            interactionRecovery = "enter_after_benign_material_overlay";
          }
        } catch (error) {
          if (!isKnownMaterialClickCover(error)) throw error;
          // Material's focus indicator is part of the same link/button. Enter
          // activates that semantic control without guessing a coordinate.
          result = await this.tool("act", { page, kind: "press", ref, key: "Enter" });
          interactionRecovery = "enter_after_benign_material_overlay";
        }
      }
    } else if (operation === "type") {
      const text = safeText(request.text, "text", 12_000).replace(/\r\n?/g, "\n");
      const ref = safeText(request.elementRef, "elementRef", 80);
      result = await this.tool("act", { page, kind: "fill", ref, value: text }, { timeoutMs: TYPE_TIMEOUT_MS });
      if (request.submit === true) {
        result = await this.tool("act", { page, kind: "press", ref, key: "Enter" }, { timeoutMs: TYPE_TIMEOUT_MS });
      }
    } else if (operation === "press_key") {
      result = await this.tool("act", { page, kind: "press", ref: safeText(request.elementRef, "elementRef", 80), key: safeText(request.key, "key", 64) });
    } else {
      throw new Error(`BrowserOS operation chưa triển khai: ${operation}`);
    }
    const currentUrl = await this.pageUrl(page);
    return { result, page, currentUrl, interactionRecovery, resolvedTarget };
  }

  async saveScreenshot(result) {
    const image = imageContent(result);
    if (!image) return null;
    const bytes = Buffer.from(image.data.split(",").at(-1), "base64");
    if (!bytes.length || bytes.length > 18 * 1024 * 1024) throw new Error("BrowserOS screenshot rỗng hoặc vượt 18 MB");
    const relative = `.auto3dvideo/browseros/screenshots/flow-${Date.now()}-${Math.random().toString(16).slice(2)}.png`;
    const absolute = resolve(this.workspace, relative);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes, { flag: "wx" });
    return { screenshotPath: relative.replaceAll("\\", "/"), screenshotMimeType: image.mimeType || "image/png", screenshotBytes: bytes.length };
  }
}

function summarize(result, currentUrl, screenshot, interactionRecovery = null, resolvedTarget = null) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = contentText(result);
  const uiRefs = extractUiRefs(text);
  const isError = result?.isError === true;
  return {
    isError,
    contentItemCount: content.length,
    contentTypes: content.map((item) => item?.type).filter(Boolean).slice(0, 8),
    textBytes: Buffer.byteLength(text, "utf8"),
    hasImage: content.some((item) => item?.type === "image"),
    uiRefCount: uiRefs.length,
    uiRefs,
    currentUrl: currentUrl || null,
    ...(screenshot || {}),
    ...(interactionRecovery ? { interactionRecovery } : {}),
    ...(resolvedTarget ? { resolvedTarget } : {}),
    detail: isError ? boundedDetail(text) : "",
  };
}

async function main() {
  const workspace = resolve(process.cwd());
  const operation = arg("--operation") || "probe";
  const output = required("--output");
  const endpoint = process.env.AUTO3DVIDEO_BROWSEROS_MCP_ENDPOINT || DEFAULT_ENDPOINT;
  const statePath = resolve(workspace, ".auto3dvideo", "browseros", "mcp-session.json");
  const browser = new BrowserOsMcp({ endpoint, statePath, workspace });
  let report;
  try {
    await browser.initialize();
    const executed = await browser.execute({
      operation,
      approved: arg("--approved") === "true",
      url: arg("--url"),
      elementRef: arg("--element-ref"),
      element: arg("--element"),
      text: arg("--text"),
      submit: arg("--submit") === "true",
      key: arg("--key"),
      time: arg("--time"),
    });
    let screenshot = null;
    if (executed.result && operation === "screenshot") screenshot = await browser.saveScreenshot(executed.result);
    const result = executed.result || {};
    const operationResult = operation === "snapshot"
      ? summarize({ ...result, content: [{ type: "text", text: `- Page URL: ${executed.currentUrl || ""}\n${contentText(result)}` }] }, executed.currentUrl, screenshot)
      : summarize(result, executed.currentUrl, screenshot, executed.interactionRecovery, executed.resolvedTarget);
    const flowPageVerified = operation !== "probe"
      && !operationResult.isError
      && Boolean(executed.page)
      && isFlowUrl(executed.currentUrl);
    if (operation !== "probe" && !operationResult.isError && !flowPageVerified) {
      operationResult.isError = true;
      operationResult.detail = "BLOCKED_NON_FLOW_BROWSEROS_TAB: current page URL is not a verified Google Flow URL.";
    }
    report = {
      status: operationResult.isError ? "blocked" : "ready",
      operation,
      reportPath: output,
      serverInfo: browser.serverInfo || {
        name: browser.endpoint.includes(":9000/") ? "browseros_mcp" : "browseros-neo",
        title: browser.endpoint.includes(":9000/") ? "BrowserOS MCP server" : "BrowserOS neo",
      },
      protocolVersion: browser.protocolVersion || "2025-03-26",
      toolCount: browser.tools.length,
      tools: browser.tools,
      toolName: operation === "probe" ? null : operationTool(normalizeOperation(operation)),
      approved: arg("--approved") === "true",
      browserSessionAttached: flowPageVerified,
      browserActionsPerformed: operation !== "probe" && !operationResult.isError,
      networkCallsMade: operation !== "probe" && !operationResult.isError,
      operationResult,
      message: operationResult.isError
        ? `BrowserOS ${operation} bị từ chối: ${operationResult.detail || "không có chi tiết"}`
        : operation === "probe"
          ? "BrowserOS MCP endpoint đã sẵn sàng; dùng granular tools, không dùng run để tránh lỗi structuredContent của build hiện tại."
          : executed.interactionRecovery
            ? `BrowserOS ${operation} gặp lớp phủ Material nội bộ; đã kích hoạt bằng Enter trên cùng control và nhận diff xác nhận.`
            : `BrowserOS ${operation} đã hoàn tất; app không lưu cookie/token và chỉ giữ summary UI cần cho workflow.`,
      process: null,
    };
  } catch (error) {
    report = {
      status: "blocked",
      operation,
      reportPath: output,
      serverInfo: browser.serverInfo,
      protocolVersion: browser.protocolVersion,
      toolCount: browser.tools.length,
      tools: browser.tools,
      toolName: operation === "probe" ? null : operationTool(operation),
      approved: arg("--approved") === "true",
      browserSessionAttached: false,
      browserActionsPerformed: false,
      networkCallsMade: false,
      operationResult: { isError: true, contentItemCount: 0, contentTypes: [], textBytes: 0, hasImage: false, uiRefCount: 0, uiRefs: [], currentUrl: null, detail: boundedDetail(error?.message || error) },
      message: boundedDetail(error?.message || error),
      process: null,
    };
  }
  await mkdir(dirname(resolve(workspace, output)), { recursive: true });
  await writeFile(resolve(workspace, output), JSON.stringify(report, null, 2), "utf8");
  if (report.status === "blocked") process.exitCode = 2;
}

main().catch((error) => {
  console.error(String(error?.stack || error));
  process.exitCode = 1;
});
