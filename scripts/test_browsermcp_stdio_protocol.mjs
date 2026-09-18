#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const serverEntry = resolve(process.argv[process.argv.indexOf("--server-entry") + 1] ?? "");
const nodeExecutable = process.argv[process.argv.indexOf("--node") + 1] ?? "node";
if (!serverEntry || serverEntry === resolve("")) throw new Error("Thiếu --server-entry");

const child = spawn(nodeExecutable, [serverEntry], {
  cwd: resolve(serverEntry, "..", ".."),
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
const lines = createInterface({ input: child.stdout });
const responses = [];
lines.on("line", (line) => {
  try { responses.push(JSON.parse(line)); } catch { /* MCP stdout must stay JSONL. */ }
});

function request(id, method, params = {}) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolvePromise, rejectPromise) => {
    const deadline = setTimeout(() => rejectPromise(new Error(`timeout: ${method}`)), 5000);
    const poll = () => {
      const responseIndex = responses.findIndex((response) => response.id === id);
      if (responseIndex >= 0) {
        clearTimeout(deadline);
        const response = responses.splice(responseIndex, 1)[0];
        if (response.error) rejectPromise(new Error(JSON.stringify(response.error)));
        else resolvePromise(response.result ?? {});
      } else setTimeout(poll, 10);
    };
    poll();
  });
}

try {
  const initialized = await request(1, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "Auto3Dvideo protocol test", version: "0.1.0" },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
  const listed = await request(2, "tools/list");
  const tools = Array.isArray(listed.tools) ? listed.tools.map((tool) => tool.name) : [];
  if (tools.length !== 12) throw new Error(`expected 12 tools, received ${tools.length}`);
  process.stdout.write(JSON.stringify({
    status: "passed",
    protocolVersion: initialized.protocolVersion,
    serverInfo: initialized.serverInfo,
    toolCount: tools.length,
    tools,
  }) + "\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${stderr}`);
  process.exitCode = 1;
} finally {
  child.stdin.end();
  await Promise.race([once(child, "exit"), new Promise((resolvePromise) => setTimeout(resolvePromise, 1500))]);
  if (!child.killed) child.kill();
}
