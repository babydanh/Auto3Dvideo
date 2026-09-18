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

function sendJsonRpc(response, payload, sessionId = "browseros-test-session") {
  const body = `data: ${JSON.stringify(payload)}\n\n`;
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Mcp-Session-Id": sessionId,
  });
  response.end(body);
}

async function startMockBrowserOs() {
  const actions = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk.toString("utf8");
    const message = JSON.parse(body);
    const method = message.method;
    if (method === "initialize") {
      sendJsonRpc(response, {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-03-26",
          serverInfo: { name: "browseros-neo-test", version: "1.0.0" },
        },
      });
      return;
    }
    if (method === "tools/list") {
      sendJsonRpc(response, {
        jsonrpc: "2.0",
        id: message.id,
        result: { tools: [{ name: "tabs" }, { name: "snapshot" }, { name: "act" }] },
      });
      return;
    }
    if (method !== "tools/call") {
      sendJsonRpc(response, { jsonrpc: "2.0", id: message.id, result: {} });
      return;
    }

    const name = message.params?.name;
    const args = message.params?.arguments || {};
    if (name === "tabs") {
      const content = args.action === "new"
        ? "opened page 12"
        : "[12] https://flow.google.com/about (Google Flow)";
      sendJsonRpc(response, {
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: content }] },
      });
      return;
    }
    if (name === "snapshot") {
      sendJsonRpc(response, {
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: "button \\\"Open project\\\" [ref=e22]" }] },
      });
      return;
    }
    if (name === "act") {
      actions.push({ kind: args.kind, ref: args.ref, key: args.key || null });
      if (args.kind === "click" && args.ref === "e22") {
        sendJsonRpc(response, {
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32000,
            message: "act failed: Element e22 (link \\\"Open project\\\") is covered by <span.mat-focus-indicator> at its click point; the click would hit that element instead.",
          },
        });
        return;
      }
      if (args.kind === "click" && args.ref === "e99") {
        sendJsonRpc(response, {
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32000,
            message: "act failed: Element e99 is covered by <div.modal-backdrop> at its click point.",
          },
        });
        return;
      }
      sendJsonRpc(response, {
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: "activated semantic control" }] },
      });
      return;
    }
    sendJsonRpc(response, {
      jsonrpc: "2.0",
      id: message.id,
      result: { content: [{ type: "text", text: "unsupported mock tool" }], isError: true },
    });
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("listening", resolvePromise);
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1");
  });
  const address = server.address();
  return { server, actions, endpoint: `http://127.0.0.1:${address.port}/mcp` };
}

function runWorker(worker, workspace, endpoint, output, ref) {
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
      "--operation", "click_project",
      "--approved", "true",
      "--element-ref", ref,
      "--output", output,
    ], { cwd: workspace, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk.toString("utf8")).slice(-4096); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-4096); });
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error("BrowserOS worker test timeout"));
    }, 15_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once("exit", async (code, signal) => {
      clearTimeout(timer);
      try {
        const report = JSON.parse(await readFile(resolve(workspace, output), "utf8"));
        resolvePromise({ code, signal, report, stdout, stderr });
      } catch (error) {
        rejectPromise(new Error(`Không đọc được worker report: ${error.message}; stderr=${stderr}`));
      }
    });
  });
}

async function main() {
  const workspace = await mkdtemp(resolve(tmpdir(), "auto3dvideo-browseros-test-"));
  const worker = resolve(dirname(fileURLToPath(import.meta.url)), "browseros_mcp_runtime_worker.mjs");
  const mock = await startMockBrowserOs();
  try {
    const recovered = await runWorker(worker, workspace, mock.endpoint, "recovered.json", "e22");
    assert(recovered.code === 0, `recovery exit ${recovered.code}: ${recovered.stderr}`);
    assert(recovered.report.status === "ready", `recovery status ${recovered.report.status}`);
    assert(recovered.report.operationResult.interactionRecovery === "enter_after_benign_material_overlay", "missing Material overlay recovery evidence");
    assert(mock.actions.map((action) => action.kind).join(",") === "click,press", `unexpected recovery actions: ${JSON.stringify(mock.actions)}`);
    assert(mock.actions[1].key === "Enter", "recovery did not use Enter on the same ref");

    const actionCountAfterRecovery = mock.actions.length;
    const blocked = await runWorker(worker, workspace, mock.endpoint, "blocked.json", "e99");
    assert(blocked.code === 2, `unrelated cover exit ${blocked.code}`);
    assert(blocked.report.status === "blocked", `unrelated cover status ${blocked.report.status}`);
    assert(blocked.report.message.includes("modal-backdrop"), "unrelated overlay reason was not preserved");
    assert(mock.actions.length === actionCountAfterRecovery + 1, "unrelated overlay incorrectly triggered a fallback action");
    process.stdout.write(JSON.stringify({ status: "passed", recovered: "enter-fallback", unrelatedOverlay: "blocked" }) + "\n");
  } finally {
    await new Promise((resolvePromise) => mock.server.close(resolvePromise));
    await rm(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
