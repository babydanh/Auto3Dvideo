#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const MAX_LINE_BYTES = 256 * 1024;
const TIMEOUT_MS = 15000;

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredArg(name) {
  const value = readArg(name);
  if (!value) throw new Error(`Thiếu ${name}`);
  return value;
}

function sendLine(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

async function main() {
  const serverEntry = resolve(requiredArg("--server-entry"));
  const outputPath = resolve(requiredArg("--output"));
  const child = spawn(process.execPath, [serverEntry], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const responses = new Map();
  let stdout = "";
  let stderr = "";
  let settled = false;
  let resolveWait;
  let rejectWait;
  const waitForResponse = (id) => new Promise((resolvePromise, rejectPromise) => {
    responses.set(id, { resolve: resolvePromise, reject: rejectPromise });
    resolveWait = resolvePromise;
    rejectWait = rejectPromise;
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
    if (Buffer.byteLength(stdout, "utf8") > MAX_LINE_BYTES * 4) {
      stdout = stdout.slice(-MAX_LINE_BYTES * 4);
    }
    const lines = stdout.split("\n");
    stdout = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if (message.id !== undefined && responses.has(message.id)) {
          responses.get(message.id).resolve(message);
          responses.delete(message.id);
        }
      } catch {
        // Ignore non-JSON stdout; the final report records bounded stderr only.
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
    if (Buffer.byteLength(stderr, "utf8") > MAX_LINE_BYTES) {
      stderr = stderr.slice(-MAX_LINE_BYTES);
    }
  });

  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectWait?.(new Error("BrowserMCP probe timeout"));
      child.kill();
    }
  }, TIMEOUT_MS);

  try {
    sendLine(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "auto3dvideo-browsermcp-probe", version: "0.1.0" },
      },
    });
    const initialize = await waitForResponse(1);
    sendLine(child, { jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    sendLine(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const toolsList = await waitForResponse(2);
    const tools = Array.isArray(toolsList.result?.tools)
      ? toolsList.result.tools.map((tool) => ({
          name: typeof tool.name === "string" ? tool.name : "unknown",
          description: typeof tool.description === "string" ? tool.description.slice(0, 500) : "",
          inputSchema: tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : {},
        }))
      : [];
    const report = {
      schemaVersion: "1.0.0",
      status: initialize.error || toolsList.error ? "blocked" : "ready",
      serverEntry,
      protocolVersion: initialize.result?.protocolVersion ?? null,
      serverInfo: initialize.result?.serverInfo ?? null,
      toolCount: tools.length,
      tools,
      browserSessionAttached: false,
      browserActionsPerformed: false,
      networkCallsMade: false,
      message: initialize.error || toolsList.error
        ? "BrowserMCP server trả lỗi khi initialize/tools.list; chưa thao tác browser."
        : "BrowserMCP stdio server phản hồi; probe chỉ đọc tool list, chưa kết nối tab hoặc thao tác browser.",
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    process.stdout.write(`${JSON.stringify({ status: report.status, toolCount: report.toolCount, outputPath })}\n`);
    settled = true;
    clearTimeout(timer);
    child.stdin.end();
    child.kill();
  } catch (error) {
    settled = true;
    clearTimeout(timer);
    child.kill();
    const report = {
      schemaVersion: "1.0.0",
      status: "blocked",
      serverEntry,
      protocolVersion: null,
      serverInfo: null,
      toolCount: 0,
      tools: [],
      browserSessionAttached: false,
      browserActionsPerformed: false,
      networkCallsMade: false,
      stderr: stderr.slice(-MAX_LINE_BYTES),
      message: error instanceof Error ? error.message : "BrowserMCP probe failed",
    };
    try {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    } catch {
      // Preserve the primary probe error on stderr.
    }
    process.stderr.write(`${JSON.stringify(report)}\n`);
    process.exitCode = 2;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
