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

function startMock() {
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const page = Number(url.searchParams.get("pn"));
    const list = page === 1 ? [
      { bvid: "BV1TestTech", title: "AI robot explains a science fact", desc: "A concise technology explainer", pubdate: Math.floor(Date.now() / 1000), pic: "http://i0.hdslb.com/bfs/archive/test-tech.jpg", owner: { name: "Tech Lab" }, stat: { view: 120000, like: 5000, reply: 300, share: 100 } },
      { bvid: "BV1TestStory", title: "旅行故事：一条河流的秘密", desc: "Documentary story", pubdate: 1, pic: "https://i1.hdslb.com/bfs/archive/test-story.jpg", owner: { name: "Story Lab" }, stat: { view: 50000, like: 1800, reply: 90, share: 40 } },
    ] : [];
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ code: 0, message: "OK", data: { list } }));
  });
  return new Promise((resolvePromise, rejectPromise) => {
    server.once("listening", () => resolvePromise(server));
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1");
  });
}

function runWorker(worker, workspace, output, endpoint) {
  return new Promise((resolvePromise, rejectPromise) => {
    const environment = { ...process.env, AUTO3DVIDEO_PUBLIC_CATALOG_ENDPOINT: endpoint };
    const child = spawn(process.execPath, [worker, "--max-results", "4", "--run-id", "test-run", "--output", output], {
      cwd: workspace,
      env: environment,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-4000); });
    const timer = setTimeout(() => { child.kill(); rejectPromise(new Error("public catalog worker test timeout")); }, 10_000);
    child.once("error", (error) => { clearTimeout(timer); rejectPromise(error); });
    child.once("exit", async (code) => {
      clearTimeout(timer);
      try {
        const report = JSON.parse(await readFile(resolve(workspace, output), "utf8"));
        resolvePromise({ code, report, stderr });
      } catch (error) {
        rejectPromise(new Error(`Không đọc được catalog report: ${error.message}; stderr=${stderr}`));
      }
    });
  });
}

async function main() {
  const workspace = await mkdtemp(resolve(tmpdir(), "auto3dvideo-public-catalog-test-"));
  const server = await startMock();
  const address = server.address();
  const worker = resolve(dirname(fileURLToPath(import.meta.url)), "public_preview_catalog_worker.mjs");
  try {
    const result = await runWorker(worker, workspace, "report.json", `http://127.0.0.1:${address.port}/popular`);
    assert(result.code === 0, `worker exit ${result.code}: ${result.stderr}`);
    assert(result.report.status === "success", `status ${result.report.status}`);
    assert(result.report.cards.length === 2, `expected 2 cards, got ${result.report.cards.length}`);
    assert(result.report.cards[0].platform === "bilibili", "platform missing");
    assert(result.report.cards[0].embedUrl.includes("player.bilibili.com"), "embed missing");
    assert(result.report.cards[0].thumbnailUrl.startsWith("https://"), "thumbnail was not normalized to https");
    assert(result.report.cards.some((card) => card.topic === "technology"), "technology topic missing");
    assert(result.report.cards.every((card) => !Object.hasOwn(card, "_metricScore") && !Object.hasOwn(card, "_topic")), "worker-only sort fields leaked");
    process.stdout.write(JSON.stringify({ status: "passed", cards: result.report.cards.length, engine: result.report.engine }) + "\n");
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
    await rm(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || error}\n`);
  process.exitCode = 1;
});
