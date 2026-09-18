#!/usr/bin/env node
import { readFile, rm, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

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
function runWorker(worker, serverEntry, operation, outputPath, wsUrl) {
  return new Promise((resolvePromise, rejectPromise) => {
    const args = [worker, "--server-entry", serverEntry, "--operation", operation, "--approved", operation === "probe" ? "false" : "true", "--output", outputPath];
    if (wsUrl) args.push("--ws-url", wsUrl);
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8").slice(-4096); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8").slice(-4096); });
    const timer = setTimeout(() => { child.kill(); rejectPromise(new Error(`${operation} timeout`)); }, 45000);
    child.on("error", (error) => { clearTimeout(timer); rejectPromise(error); });
    child.on("exit", (code) => { clearTimeout(timer); resolvePromise({ code, stdout, stderr }); });
  });
}
function assert(condition, message) { if (!condition) throw new Error(message); }

async function startMockBrowserMcp(serverEntry, port) {
  const wsPath = require.resolve("ws", { paths: [dirname(serverEntry)] });
  const { WebSocketServer } = require(wsPath);
  const server = new WebSocketServer({ port });
  server.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString("utf8"));
      socket.send(JSON.stringify({
        type: "messageResponse",
        payload: {
          requestId: message.id,
          result: { content: [{ type: "text", text: "Mock tab đã kết nối BrowserMCP." }] },
        },
      }));
    });
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("listening", resolvePromise);
    server.once("error", rejectPromise);
  });
  return server;
}

async function main() {
  const worker = resolve(required("--worker"));
  const serverEntry = resolve(required("--server-entry"));
  const outputDirectory = resolve(arg("--output-dir") ?? "outputs/browsermcp-smoke");
  await mkdir(outputDirectory, { recursive: true });
  const stamp = Date.now().toString();
  const probePath = resolve(outputDirectory, `runtime-worker-test-${stamp}-probe.json`);
  const snapshotPath = resolve(outputDirectory, `runtime-worker-test-${stamp}-snapshot.json`);
  const connectedPath = resolve(outputDirectory, "runtime-worker-test-" + stamp + "-connected.json");
  const probeRun = await runWorker(worker, serverEntry, "probe", probePath);
  const probe = JSON.parse(await readFile(probePath, "utf8"));
  assert(probeRun.code === 0, `probe exit ${probeRun.code}`);
  assert(probe.status === "ready", `probe status ${probe.status}`);
  assert(probe.toolCount >= 12, `unexpected tool count ${probe.toolCount}`);
  assert(!probe.tools.includes("upload_file") && !probe.tools.includes("download_file"), "unexpected upload/download tool exposed");
  assert(probe.browserActionsPerformed === false && probe.networkCallsMade === false, "probe must have no side effects");

  const snapshotRun = await runWorker(worker, serverEntry, "snapshot", snapshotPath, "ws://127.0.0.1:9011");
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assert(snapshotRun.code === 2, `snapshot exit ${snapshotRun.code}`);
  assert(snapshot.status === "blocked", `snapshot status ${snapshot.status}`);
  assert(snapshot.browserSessionAttached === false, "detached snapshot reported attached");
  assert(snapshot.browserActionsPerformed === false && snapshot.networkCallsMade === false, "blocked snapshot reported side effect");
  assert(typeof snapshot.message === "string" && snapshot.message.length > 0, "blocked snapshot did not report a reason");
  await rm(snapshotPath, { force: true });
  const mockPort = 19009 + Math.floor(Math.random() * 200);
  const mockServer = await startMockBrowserMcp(serverEntry, mockPort);
  try {
    const connectedRun = await runWorker(worker, serverEntry, "snapshot", connectedPath, "ws://127.0.0.1:" + mockPort);
    const connected = JSON.parse(await readFile(connectedPath, "utf8"));
    assert(connectedRun.code === 0, "connected snapshot exit " + connectedRun.code);
    assert(connected.status === "ready" && connected.browserSessionAttached === true, "connected snapshot was not ready");
    assert(connected.operationResult.detail.includes("Mock tab"), "connected snapshot detail missing");
  } finally {
    await new Promise((resolvePromise) => mockServer.close(resolvePromise));
    await rm(connectedPath, { force: true });
  }
  process.stdout.write(JSON.stringify({ status: "passed", probeToolCount: probe.toolCount, snapshotStatus: snapshot.status, connectedStatus: "ready", probePath }) + "\n");
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
