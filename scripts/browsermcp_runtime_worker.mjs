#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { URL } from "node:url";

const ALLOWED_HOSTS = new Set(["aistudio.google.com", "gemini.google.com", "ai.google.dev", "labs.google", "flow.google"]);
const MAX_TEXT = 4000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const TIMEOUT_MS = 30000;
const DEFAULT_WS_URL = "ws://127.0.0.1:9009";
const OPERATIONS = new Set(["probe", "navigate", "snapshot", "screenshot", "wait", "click", "type", "press_key"]);
const BROWSERMCP_TOOLS = [
  "browser_navigate",
  "browser_go_back",
  "browser_go_forward",
  "browser_snapshot",
  "browser_click",
  "browser_hover",
  "browser_type",
  "browser_select_option",
  "browser_press_key",
  "browser_wait",
  "browser_get_console_logs",
  "browser_screenshot",
];
const require = createRequire(import.meta.url);
let WebSocketImplementation;

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name) {
  const value = arg(name);
  if (!value) throw new Error("Thiếu " + name);
  return value;
}

function boolArg(name) {
  return arg(name) === "true";
}

function safeText(value, name) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_TEXT) {
    throw new Error(name + " không hợp lệ");
  }
  const lower = value.toLowerCase();
  if (["api_key=", "apikey=", "access_token=", "authorization=", "bearer ", "password=", "secret=", "token="].some((marker) => lower.includes(marker))) {
    throw new Error(name + " có dấu hiệu credential");
  }
  return value;
}

function validateUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname) || parsed.username || parsed.password || parsed.port) {
    throw new Error("URL không nằm trong BrowserMCP Google allowlist");
  }
  return parsed.toString();
}

function bounded(value, limit = 400) {
  if (typeof value !== "string") return "";
  return value.replace(/(?:api[_-]?key|access[_-]?token|authorization|password|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").slice(0, limit);
}

function errorText(value) {
  if (value instanceof Error) return bounded(value.message, 900);
  if (typeof value === "string") return bounded(value, 900);
  try {
    return bounded(JSON.stringify(value), 900);
  } catch {
    return "BrowserMCP trả lỗi không đọc được";
  }
}

function loadWebSocket(serverEntry) {
  const modulePath = require.resolve("ws", { paths: [dirname(serverEntry)] });
  const loaded = require(modulePath);
  const implementation = loaded.WebSocket ?? loaded.default ?? loaded;
  if (typeof implementation !== "function") throw new Error("Không nạp được thư viện websocket của BrowserMCP");
  return implementation;
}

function contentSummary(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content
    .map((item) => typeof item?.text === "string" ? item.text : "")
    .filter(Boolean)
    .join("\n");
  return {
    isError: result?.isError === true,
    contentItemCount: content.length,
    contentTypes: content.map((item) => typeof item?.type === "string" ? item.type : "unknown").slice(0, 8),
    textBytes: Buffer.byteLength(text, "utf8"),
    hasImage: content.some((item) => item?.type === "image"),
    detail: bounded(text, 900),
  };
}

class BrowserExtensionSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.openPromise = new Promise((resolvePromise, rejectPromise) => {
      this.resolveOpen = resolvePromise;
      this.rejectOpen = rejectPromise;
    });
    this.ws = new WebSocketImplementation(wsUrl);
    this.ws.on("open", () => this.resolveOpen());
    this.ws.on("message", (raw) => this.onMessage(raw));
    this.ws.on("error", (error) => {
      const message = new Error("WebSocket BrowserMCP lỗi: " + errorText(error));
      this.rejectOpen(message);
      for (const pending of this.pending.values()) pending.reject(message);
      this.pending.clear();
    });
    this.ws.on("close", () => {
      const message = new Error("BrowserMCP WebSocket đã đóng");
      for (const pending of this.pending.values()) pending.reject(message);
      this.pending.clear();
    });
  }

  async ready() {
    await Promise.race([
      this.openPromise,
      new Promise((_, rejectPromise) => setTimeout(() => rejectPromise(new Error("Không kết nối được BrowserMCP server tại " + this.wsUrl)), 2500)),
    ]);
  }

  onMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }
    const payload = message?.payload;
    const requestId = payload?.requestId ?? message?.requestId;
    const pending = requestId !== undefined ? this.pending.get(String(requestId)) : undefined;
    if (!pending) return;
    this.pending.delete(String(requestId));
    if (payload?.error) {
      pending.reject(new Error(errorText(payload.error)));
    } else {
      pending.resolve(payload?.result);
    }
  }

  async request(type, payload = {}) {
    await this.ready();
    const id = String(this.nextRequestId++);
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error("BrowserMCP request timeout: " + type));
      }, TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolvePromise(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectPromise(error);
        },
      });
      this.ws.send(JSON.stringify({ id, type, payload }));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // The process is exiting; there is no useful recovery action here.
    }
  }
}

async function packageInfo(serverEntry) {
  try {
    const packagePath = join(dirname(serverEntry), "..", "package.json");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    return { name: "Browser MCP", version: typeof packageJson.version === "string" ? packageJson.version : "unknown" };
  } catch {
    return { name: "Browser MCP", version: "unknown" };
  }
}

function operationTool(operation) {
  return {
    navigate: "browser_navigate",
    snapshot: "browser_snapshot",
    screenshot: "browser_screenshot",
    wait: "browser_wait",
    click: "browser_click",
    type: "browser_type",
    press_key: "browser_press_key",
  }[operation] ?? null;
}

function operationPayload(operation) {
  if (operation === "navigate") return { url: validateUrl(required("--url")) };
  if (operation === "wait") {
    const seconds = Number(arg("--time"));
    if (!Number.isFinite(seconds) || seconds < 0.1 || seconds > 30) throw new Error("wait time phải trong khoảng 0.1..30 giây");
    return { time: seconds };
  }
  if (operation === "click") {
    const element = arg("--element");
    const ref = arg("--ref");
    if (!element || !ref) throw new Error("click cần cả --element và --ref từ cùng một snapshot");
    return {
      ...(element ? { element: safeText(element, "element") } : {}),
      ...(ref ? { ref: safeText(ref, "ref") } : {}),
    };
  }
  if (operation === "type") {
    const element = arg("--element");
    const ref = arg("--ref");
    if (!element || !ref) throw new Error("type cần cả --element và --ref từ cùng một snapshot");
    return {
      ...(element ? { element: safeText(element, "element") } : {}),
      ...(ref ? { ref: safeText(ref, "ref") } : {}),
      text: safeText(required("--text"), "text"),
      submit: boolArg("--submit"),
    };
  }
  if (operation === "press_key") return { key: safeText(required("--key"), "key") };
  return {};
}

async function writeReport(outputPath, report) {
  const serialized = JSON.stringify(report, null, 2) + "\n";
  if (Buffer.byteLength(serialized, "utf8") > MAX_OUTPUT_BYTES) throw new Error("BrowserMCP report vượt giới hạn kích thước");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, { encoding: "utf8", flag: "wx" });
}

async function main() {
  const serverEntry = resolve(required("--server-entry"));
  const outputPath = resolve(required("--output"));
  const operation = required("--operation");
  const wsUrl = arg("--ws-url") ?? DEFAULT_WS_URL;
  if (!OPERATIONS.has(operation)) throw new Error("Operation không được allowlist: " + operation);
  const approved = boolArg("--approved");
  if (operation !== "probe" && !approved) throw new Error("Browser operation cần approval=true");

  const serverInfo = await packageInfo(serverEntry);
  if (operation === "probe") {
    const report = {
      schemaVersion: "1.0.0",
      status: "ready",
      operation,
      serverInfo,
      protocolVersion: "2025-03-26",
      toolCount: BROWSERMCP_TOOLS.length,
      tools: BROWSERMCP_TOOLS,
      toolName: null,
      approved,
      browserSessionAttached: false,
      browserActionsPerformed: false,
      networkCallsMade: false,
      operationResult: { isError: false, contentItemCount: 0, contentTypes: [], textBytes: 0, hasImage: false, detail: "Probe package; chưa kiểm tra tab Chrome." },
      message: "BrowserMCP package sẵn sàng; bước này chưa kiểm tra phiên Chrome.",
    };
    await writeReport(outputPath, report);
    process.stdout.write(JSON.stringify({ status: report.status, operation, browserSessionAttached: false, toolCount: report.toolCount, outputPath }) + "\n");
    return;
  }

  let session;
  try {
    WebSocketImplementation = loadWebSocket(serverEntry);
    session = new BrowserExtensionSession(wsUrl);
    const toolName = operationTool(operation);
    const result = await session.request(toolName, operationPayload(operation));
    const summary = contentSummary(result);
    const report = {
      schemaVersion: "1.0.0",
      status: summary.isError ? "blocked" : "ready",
      operation,
      serverInfo,
      protocolVersion: "2025-03-26",
      toolCount: BROWSERMCP_TOOLS.length,
      tools: BROWSERMCP_TOOLS,
      toolName,
      approved,
      browserSessionAttached: !summary.isError,
      browserActionsPerformed: !summary.isError,
      networkCallsMade: !summary.isError,
      operationResult: summary,
      message: summary.isError
        ? "BrowserMCP " + operation + " bị từ chối: " + (summary.detail || "tab chưa kết nối")
        : "BrowserMCP " + operation + " đã trả phản hồi; không lưu nội dung trang/cookie/token.",
    };
    await writeReport(outputPath, report);
    process.stdout.write(JSON.stringify({ status: report.status, operation, browserSessionAttached: report.browserSessionAttached, toolCount: report.toolCount, outputPath }) + "\n");
    if (report.status === "blocked") process.exitCode = 2;
  } catch (error) {
    const detail = errorText(error);
    const report = {
      schemaVersion: "1.0.0",
      status: "blocked",
      operation,
      serverInfo,
      protocolVersion: "2025-03-26",
      toolCount: BROWSERMCP_TOOLS.length,
      tools: BROWSERMCP_TOOLS,
      toolName: operationTool(operation),
      approved,
      browserSessionAttached: false,
      browserActionsPerformed: false,
      networkCallsMade: false,
      operationResult: { isError: true, contentItemCount: 0, contentTypes: [], textBytes: 0, hasImage: false, detail },
      message: "Không kiểm tra được BrowserMCP: " + detail,
    };
    await writeReport(outputPath, report);
    process.stderr.write(JSON.stringify({ status: report.status, operation, detail }) + "\n");
    process.exitCode = 2;
  } finally {
    session?.close();
  }
}

main().catch(async (error) => {
  const outputArg = arg("--output");
  if (outputArg) {
    try {
      await writeReport(resolve(outputArg), {
        schemaVersion: "1.0.0",
        status: "blocked",
        operation: arg("--operation") ?? "unknown",
        browserSessionAttached: false,
        browserActionsPerformed: false,
        networkCallsMade: false,
        toolCount: 0,
        tools: [],
        message: errorText(error),
      });
    } catch {
      // Preserve the original process failure when the report itself cannot be written.
    }
  }
  process.stderr.write(errorText(error) + "\n");
  process.exitCode = 2;
});
