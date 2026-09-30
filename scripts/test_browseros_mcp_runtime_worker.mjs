#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data);
    const checksum = crc32(data);
    const local = Buffer.alloc(30 + name.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    data.copy(local, 30 + name.length);
    localParts.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    localOffset += local.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
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
  const events = [];
  let snapshotRef = "e22";
  let snapshotText = null;
  let tabsUrl = "https://flow.google.com/about";
  let videoNavResult = { status: "clicked", label: "Video", projectId: "test-project" };
  let videoNavCalls = 0;
  let videoDownloadZipPath = null;
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
        result: { tools: [{ name: "tabs" }, { name: "snapshot" }, { name: "act" }, { name: "evaluate" }, { name: "download" }] },
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
      if (args.action === "new") tabsUrl = args.url;
      const content = args.action === "new"
        ? "opened page 12"
        : `[12] ${tabsUrl} (Google Flow)`;
      sendJsonRpc(response, {
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: content }] },
      });
      return;
    }
    if (name === "evaluate") {
      const videoNavigation = args.code?.includes("AUTO3DVIDEO_FLOW_VIDEO_NAV") === true;
      const videoDownloadPreparation = args.code?.includes("Auto3DVideo exact Flow video download") === true;
      events.push(videoNavigation
        ? "evaluate:video-nav"
        : videoDownloadPreparation ? "evaluate:video-download-preparation" : "evaluate:viewport");
      let value = { width: 1200, height: 800 };
      if (videoNavigation) {
        videoNavCalls += 1;
        value = videoNavResult;
        if (value.status === "clicked") tabsUrl = `https://flow.google.com/project/${value.projectId}/video`;
      } else if (videoDownloadPreparation) {
        value = {
          status: "ready",
          downloadClicked: false,
          downloadControlFound: true,
          marker: "Auto3DVideo exact Flow video download",
          mediaId: "poster-test",
        };
      }
      sendJsonRpc(response, {
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: JSON.stringify(value) }] },
      });
      return;
    }
    if (name === "snapshot") {
      events.push("snapshot");
      sendJsonRpc(response, {
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: snapshotText ?? `button "Open project" [ref=${snapshotRef}]` }] },
      });
      return;
    }
    if (name === "download") {
      events.push(`download:${args.ref}`);
      if (args.ref !== "video-download") throw new Error("video download must target the exact Flow output ref");
      if (!videoDownloadZipPath) throw new Error("video download ZIP fixture path was not configured");
      sendJsonRpc(response, {
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: `Downloaded "tải xuống.zip" to: ${videoDownloadZipPath}` }] },
      });
      return;
    }
    if (name === "act") {
      events.push(`act:${args.kind}:${args.ref}`);
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
      if (args.kind === "click" && args.ref === "video-download") {
        throw new Error("video download must use the BrowserOS download tool");
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
  return {
    server,
    actions,
    events,
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    setSnapshotRef(value) { snapshotRef = value; },
    setTabsUrl(value) { tabsUrl = value; },
    setVideoNavResult(value) { videoNavResult = value; },
    get videoNavCalls() { return videoNavCalls; },
    setVideoDownloadZipPath(value) { videoDownloadZipPath = value; },
    setSnapshotText(value) { snapshotText = value; },
  };
}

function runWorker(worker, workspace, endpoint, output, ref, label, { operation = "click_project", url = null } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const environment = {
      PATH: process.env.PATH || "",
      SystemRoot: process.env.SystemRoot || "",
      TEMP: process.env.TEMP || "",
      TMP: process.env.TMP || "",
      AUTO3DVIDEO_BROWSEROS_MCP_ENDPOINT: endpoint,
    };
    const args = [
      worker,
      "--operation", operation,
      "--approved", "true",
      "--element-ref", ref,
      "--element", label,
      "--output", output,
    ];
    if (url) args.push("--url", url);
    const child = spawn(process.execPath, args, { cwd: workspace, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
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

function runFlowWorker(worker, workspace, endpoint, output, { projectUrl, shotId, revisionId, runId }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const environment = {
      PATH: process.env.PATH || "",
      SystemRoot: process.env.SystemRoot || "",
      TEMP: process.env.TEMP || "",
      TMP: process.env.TMP || "",
      USERPROFILE: workspace,
      AUTO3DVIDEO_BROWSEROS_MCP_ENDPOINT: endpoint,
    };
    const args = [
      worker,
      "--operation", "flow_download_video_output",
      "--approved", "true",
      "--project-url", projectUrl,
      "--shot-id", shotId,
      "--revision-id", revisionId,
      "--run-id", runId,
      "--output", output,
    ];
    const child = spawn(process.execPath, args, { cwd: workspace, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk.toString("utf8")).slice(-4096); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-4096); });
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error("Flow download worker test timeout"));
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
        rejectPromise(new Error(`Flow worker report could not be read: ${error.message}; stderr=${stderr}`));
      }
    });
  });
}

async function testFlowVideoOutputMatcher() {
  const workerPath = resolve(dirname(fileURLToPath(import.meta.url)), "browseros_flow_worker.mjs");
  const source = await readFile(workerPath, "utf8");
  const template = source.match(/const inspectOutputCode = \(shotId, revisionId, runId\) => String\.raw`([\s\S]*?)`;/)?.[1];
  assert(template, "Flow output inspector template was not found");
  const downloadTemplate = source.match(/const downloadVideoOutputCode = \(expectedProjectId, shotId, revisionId, runId\) => String\.raw`([\s\S]*?)`;/)?.[1];
  const restoreTemplate = source.match(/const restoreVideoOutputMarkerCode = String\.raw`([\s\S]*?)`;/)?.[1];
  assert(downloadTemplate, "Flow video download template was not found");
  assert(restoreTemplate, "Flow video marker restore template was not found");
  class FixtureNode {
    constructor(tag, text = "", attrs = {}) {
      this.tagName = tag;
      this._text = text;
      this.attrs = attrs;
      this.children = [];
      this.parentElement = null;
      this.disabled = false;
      this.shadowRoot = null;
    }
    click() { this.clicked = true; }
    append(child) { child.parentElement = this; this.children.push(child); return child; }
    get textContent() { return [this._text, ...this.children.map((child) => child.textContent)].filter(Boolean).join(" "); }
    get innerText() { return this.textContent; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    setAttribute(name, value) { this.attrs[name] = value; }
    removeAttribute(name) { delete this.attrs[name]; }
    getBoundingClientRect() { return { width: 200, height: 120 }; }
    matches() { return false; }
    getRootNode() { return null; }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) {
        if (selector === ".batch-container" && node.attrs.class === "batch-container") return node;
      }
      return null;
    }
    contains(target) {
      for (let node = target; node; node = node.parentElement) if (node === this) return true;
      return false;
    }
    querySelectorAll(selector) {
      const result = [];
      const visit = (node) => {
        for (const child of node.children) {
          if (selector === "*" || (selector === "video" && child.tagName === "VIDEO") || (selector === "img" && child.tagName === "IMG")
            || (selector.includes("button") && (child.tagName === "BUTTON" || child.attrs.role === "button"))) result.push(child);
          visit(child);
        }
      };
      visit(this);
      return result;
    }
  }
  const inspect = (videoCount) => {
    const body = new FixtureNode("BODY");
    for (let index = 0; index < videoCount; index += 1) {
      const card = body.append(new FixtureNode("DIV", "", { class: "batch-container" }));
      card.append(new FixtureNode("FLOW-BATCH-INFO", `SHOT-001 REVISION_ID rev-001 RUN_ID auto-test-flow Omni 1.1 Flash 720p 8 giây 16:9`));
      card.append(new FixtureNode("IMG", "", { "data-media-id": `poster-${index + 1}` }));
    }
    const unrelatedCard = body.append(new FixtureNode("DIV", "Nano Banana image", { class: "batch-container" }));
    unrelatedCard.append(new FixtureNode("IMG", "", { "data-media-id": "image-1" }));
    const document = { body, querySelectorAll: (selector) => body.querySelectorAll(selector) };
    const code = template
      .replace('${JSON.stringify(shotId || "")}', JSON.stringify("SHOT-001"))
      .replace('${JSON.stringify(revisionId || "")}', JSON.stringify("rev-001"))
      .replace('${JSON.stringify(runId || "")}', JSON.stringify("auto-test-flow"));
    return new Function("document", "getComputedStyle", code)(document, () => ({ display: "block", visibility: "visible" }));
  };
  const uniqueVideo = inspect(1);
  assert(uniqueVideo.matchingPromptMediaCount === 2, "fixture did not include both image and video media");
  assert(uniqueVideo.matchingPromptVideoMediaCount === 1, "one video was confused with its matching image");
  assert(uniqueVideo.matchingBatchVideoMediaCount === 1, "batch video count included its matching image");
  const ambiguousVideos = inspect(2);
  assert(ambiguousVideos.matchingPromptMediaCount === 3, "fixture did not include two video posters and one unrelated image");
  assert(ambiguousVideos.matchingPromptVideoMediaCount === 2 && ambiguousVideos.matchingBatchVideoMediaCount === 2, "multiple matching videos were not preserved as ambiguous");
  const downloadFromFlow = (videoCount, projectId = "2d478b58-f5fa-4606-baef-71425ab7476c", controlLabel = "Tải xuống", withExtraImage = false, controlInShadowRoot = false, posterHasMediaId = true, posterInShadowRoot = false, unrelatedVideoCount = 0, withStaleMarker = false) => {
    const body = new FixtureNode("BODY");
    const buttons = [];
    let staleButton = null;
    let legacyStaleButton = null;
    if (withStaleMarker) {
      staleButton = body.append(new FixtureNode("BUTTON", "", {
        title: "Tải xuống",
        "aria-label": "Auto3DVideo exact Flow video download",
        "data-auto3dvideo-had-original-aria-label": "1",
        "data-auto3dvideo-original-aria-label": "Tải xuống",
      }));
      legacyStaleButton = body.append(new FixtureNode("BUTTON", "", {
        title: "Download",
        "aria-label": "Auto3DVideo exact Flow video download",
      }));
    }
    for (let index = 0; index < videoCount; index += 1) {
      const card = body.append(new FixtureNode("DIV", "", { class: "batch-container" }));
      card.append(new FixtureNode("FLOW-BATCH-INFO", `SHOT-001 REVISION_ID rev-001 RUN_ID auto-test-flow Omni 1.1 Flash 720p 8 giây 16:9`));
      const poster = new FixtureNode("IMG", "", posterHasMediaId ? { "data-media-id": `poster-${index + 1}` } : {});
      if (withExtraImage && index === 0) card.append(new FixtureNode("IMG", "", { "data-media-id": "unrelated-image" }));
      const button = new FixtureNode("BUTTON", "", { title: controlLabel });
      if (posterInShadowRoot) {
        const shadowRoot = { host: card, querySelectorAll: (selector) => selector === "*" ? [poster, button] : selector.includes("button") ? [button] : selector.includes("img") ? [poster] : [] };
        poster.getRootNode = () => shadowRoot;
        button.getRootNode = () => shadowRoot;
        card.shadowRoot = shadowRoot;
      } else {
        card.append(poster);
        if (controlInShadowRoot) {
          const shadowRoot = { host: card, querySelectorAll: (selector) => selector === "*" || selector.includes("button") ? [button] : [] };
          button.getRootNode = () => shadowRoot;
          card.shadowRoot = shadowRoot;
        } else {
          card.append(button);
        }
      }
      buttons.push(button);
    }
    for (let index = 0; index < unrelatedVideoCount; index += 1) {
      body.append(new FixtureNode("VIDEO", "", { "data-media-id": `unrelated-video-${index + 1}` }));
    }
    const document = { body, querySelectorAll: (selector) => body.querySelectorAll(selector) };
    const restoredBeforeAction = new Function("document", restoreTemplate)(document);
    const code = downloadTemplate
      .replace('${JSON.stringify(shotId)}', JSON.stringify("SHOT-001"))
      .replace('${JSON.stringify(revisionId)}', JSON.stringify("rev-001"))
      .replace('${JSON.stringify(runId)}', JSON.stringify("auto-test-flow"))
      .replace('${JSON.stringify(expectedProjectId)}', JSON.stringify("2d478b58-f5fa-4606-baef-71425ab7476c"));
    const result = new Function("document", "getComputedStyle", "location", code)(document, () => ({ display: "block", visibility: "visible" }), { href: `https://flow.google.com/project/${projectId}` });
    return { result, buttons, staleButton, legacyStaleButton, document, restoredBeforeAction };
  };
  const shadowPosterDownload = downloadFromFlow(1, undefined, "Tải xuống", false, false, true, true);
  assert(shadowPosterDownload.result.status === "ready" && !shadowPosterDownload.result.downloadClicked && shadowPosterDownload.result.downloadControlFound && shadowPosterDownload.buttons[0].attrs["aria-label"] === "Auto3DVideo exact Flow video download" && !shadowPosterDownload.buttons[0].clicked, "video poster classification did not cross its output shadow host safely");
  const scopedDownload = downloadFromFlow(1, undefined, "Tải xuống", false, false, true, false, 7);
  assert(scopedDownload.result.status === "ready" && !scopedDownload.result.downloadClicked && scopedDownload.buttons[0].attrs["aria-label"] === "Auto3DVideo exact Flow video download" && !scopedDownload.buttons[0].clicked, "unrelated page videos made a unique batch output ambiguous");

  const repeatedDownload = downloadFromFlow(1, undefined, "Tải xuống", false, false, true, false, 0, true);
  const markedButtons = [repeatedDownload.staleButton, ...repeatedDownload.buttons]
    .filter((button) => button?.attrs["aria-label"] === "Auto3DVideo exact Flow video download");
  assert(repeatedDownload.result.status === "ready" && repeatedDownload.restoredBeforeAction.restored === 2 && repeatedDownload.staleButton.attrs["aria-label"] === "Tải xuống" && repeatedDownload.legacyStaleButton.attrs["aria-label"] === "Download" && markedButtons.length === 1, "stale video Download markers were not restored before preparing the next shot");
  const uniqueDownload = downloadFromFlow(1);
  assert(uniqueDownload.result.status === "ready" && !uniqueDownload.result.downloadClicked && uniqueDownload.result.downloadControlFound, "unique video poster did not prepare its own download control");
  assert(uniqueDownload.buttons[0].attrs["aria-label"] === "Auto3DVideo exact Flow video download" && !uniqueDownload.buttons[0].clicked, "video download template dispatched a DOM click instead of exposing a fresh BrowserOS ref");

  const restoredAfterAction = new Function("document", restoreTemplate)(uniqueDownload.document);
  assert(restoredAfterAction.restored === 1 && uniqueDownload.buttons[0].attrs["aria-label"] === undefined, "video Download marker was not restored after BrowserOS action");
  const shadowDownload = downloadFromFlow(1, undefined, "Tải xuống", false, true);
  assert(shadowDownload.result.status === "ready" && !shadowDownload.result.downloadClicked && shadowDownload.buttons[0].attrs["aria-label"] === "Auto3DVideo exact Flow video download", "shadow-root output download control was not prepared for BrowserOS");
  const uniqueBatchDownload = downloadFromFlow(1, undefined, "Tải xuống hàng loạt");
  assert(uniqueBatchDownload.result.status === "ready" && !uniqueBatchDownload.result.downloadClicked && uniqueBatchDownload.buttons[0].attrs["aria-label"] === "Auto3DVideo exact Flow video download", "single-media Flow batch download was not safely prepared");
  const posterOnlyBatchDownload = downloadFromFlow(1, undefined, "Tải xuống hàng loạt", false, false, false);
  assert(posterOnlyBatchDownload.result.status === "ready" && !posterOnlyBatchDownload.result.downloadClicked && posterOnlyBatchDownload.buttons[0].attrs["aria-label"] === "Auto3DVideo exact Flow video download", "single image-backed video poster without a media id was not prepared");
  const mixedBatchDownload = downloadFromFlow(1, undefined, "Tải xuống hàng loạt", true);
  assert(mixedBatchDownload.result.status === "blocked" && !mixedBatchDownload.buttons[0].clicked, "batch download was allowed when the card contained another media item");
  const ambiguousVideoDownload = downloadFromFlow(2);
  assert(ambiguousVideoDownload.result.status === "blocked" && ambiguousVideoDownload.buttons.every((button) => !button.clicked), "ambiguous posters were downloaded");
  const wrongProjectDownload = downloadFromFlow(1, "another-project");
  assert(wrongProjectDownload.result.status === "blocked" && !wrongProjectDownload.buttons[0].clicked, "download was allowed from the wrong Flow project");
}

async function main() {
  const workspace = await mkdtemp(resolve(tmpdir(), "auto3dvideo-browseros-test-"));
  await testFlowVideoOutputMatcher();
  const worker = resolve(dirname(fileURLToPath(import.meta.url)), "browseros_mcp_runtime_worker.mjs");
  const mock = await startMockBrowserOs();
    const setFlowPage = async (url) => {
      mock.setTabsUrl(url);
      const statePath = resolve(workspace, ".auto3dvideo", "browseros", "mcp-session.json");
      await mkdir(dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify({
        schemaVersion: "1.0.0",
        endpoint: mock.endpoint,
        sessionId: "browseros-test-session",
        pageId: 12,
        automationPageId: 12,
        pageUrl: url,
        flowComposerFingerprint: null,
        serverInfo: null,
        protocolVersion: null,
        tools: [],
      }));
    };
  try {
    const recovered = await runWorker(worker, workspace, mock.endpoint, "recovered.json", "e99", "Open project");
    assert(recovered.code === 0, `recovery exit ${recovered.code}: ${recovered.stderr}`);
    assert(recovered.report.status === "ready", `recovery status ${recovered.report.status}`);
    assert(recovered.report.operationResult.interactionRecovery === "enter_after_benign_material_overlay", "missing Material overlay recovery evidence");
    assert(recovered.report.operationResult.resolvedTarget?.reference === "e22", "click did not resolve the fresh reference from its same-session snapshot");
    assert(mock.actions.map((action) => `${action.kind}:${action.ref}`).join(",") === "click:e22,press:e22", `stale ref was used or the fresh ref changed during recovery: ${JSON.stringify(mock.actions)}`);
    const firstClickEvent = mock.events.findIndex((event) => event === "act:click:e22");
    assert(firstClickEvent > mock.events.lastIndexOf("snapshot"), "the click did not use the latest BrowserOS snapshot");
    assert(mock.actions[1].key === "Enter", "recovery did not use Enter on the same ref");
    assert(recovered.report.browserSessionAttached === true, "verified Flow page was not reported as attached");
    assert(recovered.report.operationResult.currentUrl === "https://flow.google.com/about", "verified Flow URL was not reported");

    const actionCountAfterRecovery = mock.actions.length;
    mock.setSnapshotRef("e99");
    const blocked = await runWorker(worker, workspace, mock.endpoint, "blocked.json", "e22", "Open project");
    assert(blocked.code === 2, `unrelated cover exit ${blocked.code}`);
    assert(blocked.report.status === "blocked", `unrelated cover status ${blocked.report.status}`);
    assert(blocked.report.message.includes("modal-backdrop"), "unrelated overlay reason was not preserved");
    assert(mock.actions.length === actionCountAfterRecovery + 1, "unrelated overlay incorrectly triggered a fallback action");
    assert(mock.actions.at(-1).ref === "e99", "the worker used the caller's obsolete BrowserOS reference");
    const actionCountAfterBlockedClick = mock.actions.length;
    mock.setTabsUrl("https://gemini.google.com/app");
    const wrongPage = await runWorker(worker, workspace, mock.endpoint, "wrong-page.json", "e22", "Open project");
    assert(wrongPage.code === 2, `non-Flow page exit ${wrongPage.code}`);
    assert(wrongPage.report.message.includes("BLOCKED_NON_FLOW_BROWSEROS_TAB"), "stale non-Flow tab was not classified");
    assert(mock.actions.length === actionCountAfterBlockedClick, "worker acted on a page that was no longer Google Flow");
    const beforeNonFlowUrl = mock.events.length;
    const nonFlowUrl = await runWorker(worker, workspace, mock.endpoint, "non-flow-url.json", "e22", "Open project", {
      operation: "snapshot",
      url: "https://gemini.google.com/app",
    });
    assert(nonFlowUrl.code === 2, `non-Flow URL exit ${nonFlowUrl.code}`);
    assert(nonFlowUrl.report.status === "blocked", "non-Flow URL was reported ready");
    assert(nonFlowUrl.report.browserSessionAttached === false, "non-Flow URL was reported attached");
    assert(nonFlowUrl.report.message.includes("BLOCKED_NON_FLOW_BROWSEROS_URL"), "non-Flow URL block reason is missing");
    assert(mock.events.length === beforeNonFlowUrl, "worker contacted or acted on the requested non-Flow page");

    await setFlowPage("https://flow.google.com/project/test-project");
    const unrelatedProjectRefs = Array.from(
      { length: 90 },
      (_, index) => `button "Project card action ${index + 1}" [ref=project-${index + 1}]`,
    );
    mock.setSnapshotText([
      ...unrelatedProjectRefs,
      'textbox "Văn bản có thể chỉnh sửa" [ref=prompt-editor]',
      'button "Thêm thành phần vào ô nhập câu lệnh" [ref=ingredients]',
      'radio "Video" [ref=video-mode]',
      'generic "Omni 1.1 Flash" [ref=video-model]',
      'generic "Quá trình tạo sẽ tốn 12 tín dụng" [ref=video-price]',
      'button "Bắt đầu tạo" [ref=generate-video]',
      'button "Download" [ref=download-video]',
    ].join("\n"));
    const saturatedSnapshot = await runWorker(worker, workspace, mock.endpoint, "saturated-snapshot.json", "", "", {
      operation: "snapshot",
    });
    assert(saturatedSnapshot.code === 0, `saturated snapshot exit ${saturatedSnapshot.code}: ${saturatedSnapshot.stderr}`);
    const liveRefs = saturatedSnapshot.report.operationResult.uiRefs;
    const retainedReferences = new Set(liveRefs.map((item) => item.reference));
    for (const reference of ["prompt-editor", "ingredients", "video-mode", "video-model", "video-price", "generate-video", "download-video"]) {
      assert(retainedReferences.has(reference), `composer reference ${reference} was dropped from a saturated snapshot`);
    }
    assert(liveRefs.length === 80, `snapshot limit changed unexpectedly: ${liveRefs.length}`);
    mock.setSnapshotText(null);

    const actionsBeforeVideoNav = mock.actions.length;
    await setFlowPage("https://flow.google.com/project/test-project");
    const videoNav = await runWorker(worker, workspace, mock.endpoint, "video-nav.json", "", "Video", { operation: "click" });
    assert(videoNav.code === 0, `Video sidebar exit ${videoNav.code}: ${videoNav.stderr}`);
    assert(videoNav.report.status === "ready", `Video sidebar status ${videoNav.report.status}`);
    assert(videoNav.report.operationResult.resolvedTarget?.reference === "dom:verified-flow-video-navigation", "exact DOM target was not recorded");
    assert(videoNav.report.operationResult.currentUrl === "https://flow.google.com/project/test-project/video", "Video navigation left the selected project");
    assert(mock.videoNavCalls === 1, "Video fallback did not use the fixed DOM resolver exactly once");
    assert(mock.actions.length === actionsBeforeVideoNav, "Video fallback used a stale or unrelated accessibility ref");

    const callsBeforeAmbiguousVideo = mock.videoNavCalls;
    mock.setVideoNavResult({ status: "blocked", reason: "video-target-not-unique", matches: 2 });
    await setFlowPage("https://flow.google.com/project/test-project");
    const ambiguousVideo = await runWorker(worker, workspace, mock.endpoint, "ambiguous-video.json", "", "Video", { operation: "click" });
    assert(ambiguousVideo.code === 2 && ambiguousVideo.report.status === "blocked", "ambiguous Video target was not blocked");
    assert(ambiguousVideo.report.message.includes("BLOCKED_VIDEO_NAV_TARGET"), "ambiguous target reason was lost");
    assert(mock.videoNavCalls === callsBeforeAmbiguousVideo + 1, "ambiguous target did not use the scoped DOM resolver");

    const callsBeforeToolsPage = mock.videoNavCalls;
    await setFlowPage("https://flow.google.com/project/test-project/tools");
    const toolsVideo = await runWorker(worker, workspace, mock.endpoint, "tools-video.json", "", "Video", { operation: "click" });
    assert(toolsVideo.code === 2 && toolsVideo.report.status === "blocked", "Video click from Tools route was not blocked");
    assert(toolsVideo.report.message.includes("BLOCKED_VIDEO_NAV_CONTEXT"), "Tools route context block reason was lost");
    assert(mock.videoNavCalls === callsBeforeToolsPage, "DOM Video click ran from the separate Tools page");
    const flowWorker = resolve(dirname(fileURLToPath(import.meta.url)), "browseros_flow_worker.mjs");
    const videoDownloadsDirectory = resolve(workspace, "Downloads");
    const browserOsDownloadDirectory = resolve(workspace, ".browseros", "tool-output", "download-video-fixture");
    await mkdir(videoDownloadsDirectory, { recursive: true });
    await mkdir(browserOsDownloadDirectory, { recursive: true });
    const videoDownloadZipPath = resolve(browserOsDownloadDirectory, "tải xuống.zip");
    const videoFixture = Buffer.from("verified-flow-video");
    await writeFile(videoDownloadZipPath, storedZip([{ name: "flow-output.mp4", data: videoFixture }]));
    mock.setVideoDownloadZipPath(videoDownloadZipPath);
    mock.setSnapshotText('button "Auto3DVideo exact Flow video download" [ref=video-download]');
    await setFlowPage("https://flow.google.com/project/test-project");
    const videoDownload = await runFlowWorker(flowWorker, workspace, mock.endpoint, "video-download.json", {
      projectUrl: "https://flow.google.com/project/test-project",
      shotId: "SHOT-001",
      revisionId: "rev-001",
      runId: "auto-test-flow",
    });
    assert(videoDownload.code === 0, `video download worker exit ${videoDownload.code}: ${videoDownload.stderr}`);
    assert(videoDownload.report.status === "ready" && videoDownload.report.downloadClicked === true, "video download was reported ready without an exact BrowserOS ZIP result");
    assert(videoDownload.report.downloadPath.startsWith(`${videoDownloadsDirectory}${sep}`) && videoDownload.report.downloadSizeBytes === videoFixture.length, "video output was not extracted into Downloads with verified size");
    assert(videoDownload.report.downloadSourceName === "flow-output.mp4", "video import metadata did not preserve the archive's media name");
    assert((await readFile(videoDownload.report.downloadPath)).equals(videoFixture), "BrowserOS video ZIP did not extract the exact video bytes");

    const ambiguousDownloadDirectory = resolve(workspace, ".browseros", "tool-output", "download-ambiguous-fixture");
    await mkdir(ambiguousDownloadDirectory, { recursive: true });
    const ambiguousZipPath = resolve(ambiguousDownloadDirectory, "two-videos.zip");
    await writeFile(ambiguousZipPath, storedZip([
      { name: "flow-output-a.mp4", data: videoFixture },
      { name: "flow-output-b.mp4", data: videoFixture },
    ]));
    mock.setVideoDownloadZipPath(ambiguousZipPath);
    const ambiguousDownload = await runFlowWorker(flowWorker, workspace, mock.endpoint, "ambiguous-video-download.json", {
      projectUrl: "https://flow.google.com/project/test-project",
      shotId: "SHOT-002",
      revisionId: "rev-001",
      runId: "auto-test-flow",
    });
    assert(ambiguousDownload.code === 2 && ambiguousDownload.report.status === "blocked", "ZIP containing multiple videos was not blocked");
    assert(!ambiguousDownload.report.downloadPath, "ambiguous ZIP leaked an imported video path");
    process.stdout.write(JSON.stringify({ status: "passed", freshTarget: "same-session-snapshot", recovered: "enter-fallback", unrelatedOverlay: "blocked", staleNonFlowPage: "blocked", attachmentRequiresFlowOrigin: "blocked", exactProjectVideoNav: "verified", ambiguousVideoNav: "blocked", toolsPageVideoNav: "blocked" }) + "\n");
  } finally {
    await new Promise((resolvePromise) => mock.server.close(resolvePromise));
    await rm(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
