#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sendJsonRpc(response, payload, sessionId = "preview-test-session") {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Mcp-Session-Id": sessionId,
  });
  response.end(`data: ${JSON.stringify(payload)}\n\n`);
}

async function startMockBrowserOs(mode) {
  const actions = [];
  let currentUrl = "https://www.tiktok.com/explore";
  let pageOpened = false;
  let scrollCount = 0;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk.toString("utf8");
    const message = JSON.parse(body);
    if (message.method === "initialize") {
      sendJsonRpc(response, { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-03-26", serverInfo: { name: "browseros-neo-test", version: "1.0.0" } } });
      return;
    }
    if (message.method === "tools/list") {
      sendJsonRpc(response, { jsonrpc: "2.0", id: message.id, result: { tools: ["tabs", "navigate", "wait", "snapshot", "evaluate"].map((name) => ({ name })) } });
      return;
    }
    if (message.method !== "tools/call") {
      sendJsonRpc(response, { jsonrpc: "2.0", id: message.id, result: {} });
      return;
    }
    const name = message.params?.name;
    const args = message.params?.arguments || {};
    actions.push({ name, page: args.page, url: args.url || null, code: String(args.code || "").slice(0, 32) });
    if (name === "tabs") {
      if (args.action === "new") {
        pageOpened = true;
        currentUrl = args.url;
        sendJsonRpc(response, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "opened page 7" }] } });
        return;
      }
      const text = pageOpened ? `[7] ${currentUrl} (Preview)` : "No tabs";
      sendJsonRpc(response, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text }] } });
      return;
    }
    if (name === "navigate") {
      currentUrl = args.url;
      scrollCount = 0;
      sendJsonRpc(response, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "navigated" }] } });
      return;
    }
    if (name === "wait") {
      sendJsonRpc(response, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "waited" }] } });
      return;
    }
    if (name === "snapshot") {
      const blocked = mode === "captcha" && currentUrl.includes("douyin.com");
      const text = blocked ? "安全验证 CAPTCHA 请完成验证" : `Public discovery ${currentUrl}`;
      sendJsonRpc(response, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text }] } });
      return;
    }
    if (name === "evaluate") {
      if (String(args.code).includes("window.scrollBy")) {
        scrollCount += 1;
        sendJsonRpc(response, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify({ before: scrollCount * 800, after: scrollCount * 1_600, height: 4_000 }) }] } });
        return;
      }
      const blocked = mode === "captcha" && currentUrl.includes("douyin.com");
      const cards = blocked ? [] : currentUrl.includes("douyin.com")
        ? [{ href: "https://www.douyin.com/video/987654321", title: "Douyin fresh story", author: "creator-cn", thumbnail: "https://cdn.example.com/douyin-thumb.jpg", timeText: "2小时前", observedMetrics: { views: 3000 }, observedSignals: ["trending"], freshSignal: true }]
        : [
          { href: "https://www.tiktok.com/item/create", title: "Navigation item", author: "site-ui" },
          { href: "https://www.tiktok.com/item/digg", title: "Navigation item", author: "site-ui" },
          { href: "https://www.tiktok.com/@creator/video/123456789", title: "Fresh science hook", author: "creator-one", thumbnail: "https://cdn.example.com/tiktok-one.jpg", timeText: "1 giờ trước", observedMetrics: { views: 1000, likes: 120 }, observedSignals: ["featured"], freshSignal: true },
          { href: "https://www.tiktok.com/@creator/video/123456790", title: "Quiet lab story", author: "creator-two", thumbnail: "https://cdn.example.com/tiktok-two.jpg", timeText: "3 ngày trước", observedMetrics: { views: 400, likes: 20 }, observedSignals: [], freshSignal: false },
        ];
      sendJsonRpc(response, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify({ cards }) }] } });
      return;
    }
    sendJsonRpc(response, { jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: "unsupported mock tool" }] } });
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("listening", resolvePromise);
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1");
  });
  const address = server.address();
  return { server, actions, endpoint: `http://127.0.0.1:${address.port}/mcp` };
}

function runWorker(worker, workspace, endpoint, output, platforms) {
  return new Promise((resolvePromise, rejectPromise) => {
    const environment = {
      PATH: process.env.PATH || "",
      SystemRoot: process.env.SystemRoot || "",
      TEMP: process.env.TEMP || "",
      TMP: process.env.TMP || "",
      AUTO3DVIDEO_BROWSEROS_MCP_ENDPOINT: endpoint,
    };
    const child = spawn(process.execPath, [
      worker,
      "--platforms-json", JSON.stringify(platforms),
      "--max-results", "4",
      "--run-id", "preview-test-run",
      "--output", output,
    ], { cwd: workspace, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-4096); });
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error("Preview scan worker test timeout"));
    }, 20_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once("exit", async (code) => {
      clearTimeout(timer);
      try {
        const report = JSON.parse(await readFile(resolve(workspace, output), "utf8"));
        resolvePromise({ code, report, stderr });
      } catch (error) {
        rejectPromise(new Error(`Không đọc được preview worker report: ${error.message}; stderr=${stderr}`));
      }
    });
  });
}

async function main() {
  const workspace = await mkdtemp(resolve(tmpdir(), "auto3dvideo-preview-test-"));
  const worker = resolve(dirname(fileURLToPath(import.meta.url)), "browseros_preview_scan_worker.mjs");
  try {
    const happyMock = await startMockBrowserOs("happy");
    const happy = await runWorker(worker, workspace, happyMock.endpoint, "happy.json", ["tiktok", "douyin"]);
    assert(happy.code === 0, `happy exit ${happy.code}: ${happy.stderr}`);
    assert(happy.report.status === "success", `happy status ${happy.report.status}`);
    assert(happy.report.cards.length === 3, `expected 3 deduped cards, got ${happy.report.cards.length}`);
    assert(happy.report.cards.every((card) => !("observedMetrics" in card) && !("observedSignals" in card)), "raw ranking data leaked into card report");
    assert(happy.report.cards.some((card) => card.radarBuckets.includes("hot_new")), "hot bucket missing");
    assert(happy.report.cards.some((card) => card.radarBuckets.includes("low_clone")), "within-scan low-clone heuristic missing");
    assert(happy.report.cards.every((card) => typeof card.topic === "string" && Number.isInteger(card.potentialScore)), "topic/potential sort fields missing");
    assert(happy.report.cards.some((card) => card.topic === "knowledge"), "topic classifier did not detect knowledge content");
    assert(happyMock.actions.filter((action) => action.name === "tabs" && action.url).length === 1, "worker opened more than one preview tab");
    assert(new Set(happyMock.actions.filter((action) => action.name === "navigate").map((action) => action.page)).size === 1, "platforms did not reuse one page");
    await new Promise((resolvePromise) => happyMock.server.close(resolvePromise));

    const captchaMock = await startMockBrowserOs("captcha");
    const captcha = await runWorker(worker, workspace, captchaMock.endpoint, "captcha.json", ["tiktok", "douyin"]);
    assert(captcha.code === 0, `partial captcha exit ${captcha.code}: ${captcha.stderr}`);
    assert(captcha.report.status === "partial", `captcha status ${captcha.report.status}`);
    assert(captcha.report.platformResults.find((result) => result.platform === "douyin")?.status === "waiting_user", "CAPTCHA did not stop for user");
    assert(captcha.report.platformResults.find((result) => result.platform === "douyin")?.message.includes("CAPTCHA"), "CAPTCHA reason missing");
    await new Promise((resolvePromise) => captchaMock.server.close(resolvePromise));
    process.stdout.write(JSON.stringify({ status: "passed", oneTab: true, dedupedCards: 3, captcha: "waiting_user" }) + "\n");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
