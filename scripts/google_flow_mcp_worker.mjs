#!/usr/bin/env node

import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const MAX_TASKS = 32;
const MAX_ERRORS = 32;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function fail(message) {
  throw new Error(String(message).slice(0, 900));
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith("--")) fail(`Tham số worker không hợp lệ: ${key ?? "trống"}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`Thiếu giá trị cho ${key}`);
    values.set(key.slice(2), value);
    index += 1;
  }
  for (const required of ["workspace", "spec", "output-dir", "node", "server-entry"]) {
    if (!values.has(required)) fail(`Thiếu --${required}`);
  }
  return values;
}

function safeText(value, field, limit = 1000) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) fail(`${field} không hợp lệ`);
  const lowered = value.toLowerCase();
  if (["api_key=", "apikey=", "access_token=", "authorization:", "bearer ", "password=", "secret=", "token="].some((marker) => lowered.includes(marker))) {
    fail(`${field} có dấu hiệu credential`);
  }
  return value.trim();
}

function safeRelative(value, field) {
  const text = safeText(value, field, 1024).replaceAll("\\", "/");
  const parsed = path.posix.normalize(text);
  if (path.posix.isAbsolute(parsed) || parsed === ".." || parsed.startsWith("../")) fail(`${field} phải là đường dẫn tương đối trong workspace`);
  return parsed;
}

function normalizeWindowsExtendedPath(value) {
  const text = String(value ?? "");
  if (process.platform !== "win32") return text;
  if (text.startsWith("\\\\?\\UNC\\")) return `\\\\${text.slice("\\\\?\\UNC\\".length)}`;
  if (text.startsWith("\\\\?\\")) return text.slice("\\\\?\\".length);
  return text;
}

function within(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function parseSpec(raw) {
  if (raw?.schemaVersion !== "1.0.0" || raw?.jobType !== "image.generate" || raw?.provider !== "google_flow_mcp") fail("Google Flow MCP job không đúng schema/provider");
  if (!Array.isArray(raw.tasks) || raw.tasks.length < 1 || raw.tasks.length > MAX_TASKS) fail(`Google Flow MCP image job cần từ 1 đến ${MAX_TASKS} task`);
  return raw;
}

function redact(value) {
  const text = value instanceof Error
    ? `${value.name}: ${value.message}${value.cause ? `; cause: ${redact(value.cause)}` : ""}`
    : typeof value === "string"
      ? value
      : JSON.stringify(value) ?? String(value);
  return text.replace(/(api[_-]?key|access[_-]?token|authorization|password|secret|token)\s*[:=]\s*[^,\s}]+/gi, "$1=[REDACTED]").slice(0, 900);
}

function textFromTool(result) {
  if (!result || result.isError === true) fail(redact(result));
  const text = Array.isArray(result.content)
    ? result.content.find((item) => item?.type === "text")?.text
    : undefined;
  if (typeof text !== "string") fail("Google Flow MCP không trả text JSON");
  return text;
}

function jsonFromTool(result, method) {
  const text = textFromTool(result);
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`Google Flow MCP ${method} trả JSON không hợp lệ: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function closeCdpNoiseTabs(cdpUrl) {
  if (!cdpUrl) return 0;
  try {
    const endpoint = new URL(cdpUrl);
    const response = await fetch(new URL("/json/list", endpoint), {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return 0;
    const targets = await response.json();
    const noisyTargets = Array.isArray(targets)
      ? targets.filter((target) => target?.type === "page" && (
        target.url === "https://flow.google.com/"
        || target.url === "https://flow.google.com/?pli=1"
        || target.url.startsWith("chrome://extensions/")
      ))
      : [];
    for (const target of noisyTargets) {
      await fetch(new URL(`/json/close/${encodeURIComponent(target.id)}`, endpoint), {
        signal: AbortSignal.timeout(3_000),
      }).catch(() => undefined);
    }
    return noisyTargets.length;
  } catch {
    // Cleanup is best-effort; the MCP must still report the real attach error
    // if the CDP endpoint itself is unavailable.
    return 0;
  }
}

function sha256File(file) {
  return readFile(file).then((content) => createHash("sha256").update(content).digest("hex"));
}

function emit(progressPath, runId, stage, state, message, progress, extra = {}) {
  const event = {
    schemaVersion: "1.0.0",
    runId,
    createdAt: new Date().toISOString(),
    stage,
    state,
    message: String(message).slice(0, 900),
    progress: Math.max(0, Math.min(1, progress)),
    ...extra,
  };
  return readFile(progressPath, "utf8").catch(() => "").then((current) => writeFile(progressPath, `${current}${JSON.stringify(event)}\n`, "utf8")).catch(() => undefined);
}

async function importSdk(serverRoot) {
  const sdkRoot = path.join(serverRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm");
  const clientModule = await import(pathToFileURL(path.join(sdkRoot, "client", "index.js")).href);
  const transportModule = await import(pathToFileURL(path.join(sdkRoot, "client", "stdio.js")).href);
  return { Client: clientModule.Client, StdioClientTransport: transportModule.StdioClientTransport };
}

async function callTool(client, name, args = {}) {
  return client.callTool({ name, arguments: args });
}

function chooseModel(capabilities, requested) {
  const options = Array.isArray(capabilities?.models?.image) ? capabilities.models.image : [];
  const wanted = requested?.trim() || "ui-default";
  if (wanted === "ui-default") return "ui-default";
  const match = options.find((option) => option?.id === wanted || option?.label?.toLowerCase() === wanted.toLowerCase());
  if (!match) fail(`Flow không expose model ảnh '${wanted}'; model hiện có: ${options.map((option) => option?.id ?? option?.label).filter(Boolean).join(", ") || "trống"}`);
  return match.id;
}

function chooseAspectRatio(capabilities, requested) {
  const options = capabilities?.aspectRatiosByMedia?.image;
  if (!requested || !Array.isArray(options) || options.length === 0) return "ui-default";
  if (options.includes(requested)) return requested;
  return "ui-default";
}

async function resolveJob(client, job, timeoutSeconds, runId, progressPath, taskIndex, taskCount, shotId) {
  let current = job;
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (current?.status === "processing" || current?.status === "submitted" || current?.status === "configuring" || current?.status === "created") {
    if (Date.now() >= deadline) fail(`Job ${current.id ?? "unknown"} của ${shotId} vẫn chưa xong sau ${timeoutSeconds}s; giữ nguyên job ID để không Generate trùng`);
    await emit(progressPath, runId, "mcp.job_wait", "running", `${shotId}: đang chờ job ${current.id} của Flow; không gửi lại prompt.`, 0.2 + (taskIndex / Math.max(taskCount, 1)) * 0.72, { taskIndex, taskCount, shotId, providerJobId: current.id });
    const waitSeconds = Math.min(60, Math.max(1, Math.ceil((deadline - Date.now()) / 1000)));
    current = jsonFromTool(await callTool(client, "flow_job_status", { jobId: current.id, waitSeconds }), "flow_job_status");
  }
  if (current?.status === "ready" && (!Array.isArray(current.downloadedFiles) || current.downloadedFiles.length === 0)) {
    current = jsonFromTool(await callTool(client, "flow_download_job", { jobId: current.id }), "flow_download_job");
  }
  if (current?.status !== "completed" && current?.status !== "ready") fail(`Flow job ${current?.id ?? "unknown"} của ${shotId} kết thúc ở trạng thái ${current?.status ?? "unknown"}`);
  return current;
}

async function main() {
  const args = parseArgs(process.argv);
  const workspace = path.resolve(args.get("workspace"));
  const specPath = path.resolve(args.get("spec"));
  const outputDir = path.resolve(workspace, safeRelative(args.get("output-dir"), "output-dir"));
  const nodePath = path.resolve(normalizeWindowsExtendedPath(args.get("node")));
  const serverEntry = path.resolve(normalizeWindowsExtendedPath(args.get("server-entry")));
  const serverRoot = path.basename(path.dirname(serverEntry)).toLowerCase() === "dist" ? path.dirname(path.dirname(serverEntry)) : path.dirname(serverEntry);
  const spec = parseSpec(JSON.parse(await readFile(specPath, "utf8")));
  const runId = safeText(spec.runId, "runId", 100);
  const progressPath = path.join(outputDir, "google-flow-mcp-progress.jsonl");
  const taskCount = spec.tasks.length;
  await mkdir(outputDir, { recursive: true });
  await emit(progressPath, runId, "job.validate", "success", `Đã đọc job Google Flow MCP với ${taskCount} task; prompt không ghi vào log.`, 0.02, { taskCount });
  if (path.basename(nodePath).toLowerCase() !== "node.exe" && path.basename(nodePath).toLowerCase() !== "node") fail("Google Flow MCP chỉ được chạy bằng Node.js đã allowlist");
  if (!within(workspace, outputDir) || !within(serverRoot, serverEntry) || !serverEntry.endsWith(`${path.sep}dist${path.sep}index.js`)) fail("Đường dẫn Google Flow MCP không nằm trong clone dist/index.js hợp lệ");
  const { Client, StdioClientTransport } = await importSdk(serverRoot);
  await emit(progressPath, runId, "mcp.spawn", "running", "Đang mở Google Flow MCP bằng stdio; chưa Generate trước khi inspect account.", 0.06, { taskCount });
  const closedNoiseTabs = await closeCdpNoiseTabs(process.env.FLOW_MCP_CDP_URL?.trim());
  if (closedNoiseTabs > 0) {
    await emit(progressPath, runId, "mcp.cdp_cleanup", "success", `Đã đóng ${closedNoiseTabs} tab phụ của CDP; giữ nguyên tab Flow project trước khi attach.`, 0.08, { closedNoiseTabs });
  }
  const environment = { ...process.env, FLOW_MCP_HEADLESS: "0" };
  const transport = new StdioClientTransport({ command: nodePath, args: [serverEntry], cwd: serverRoot, env: environment, stderr: "pipe" });
  const serverStderr = [];
  transport.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    if (text) serverStderr.push(text);
    while (serverStderr.join("").length > 6000) serverStderr.shift();
  });
  const client = new Client({ name: "Auto3Dvideo", version: "0.1.0" });
  const outputs = [];
  const errors = [];
  let serverInfo = null;
  try {
    await client.connect(transport);
    serverInfo = client.getServerVersion?.() ?? null;
    await emit(progressPath, runId, "mcp.initialize", "success", "Google Flow MCP initialize thành công; đang kiểm tra account và capability thật.", 0.1, { taskCount });
    const accounts = jsonFromTool(await callTool(client, "flow_list_accounts"), "flow_list_accounts");
    if (accounts.autoAttachError || !accounts.readyForGeneration || !accounts.defaultAccountId) {
      fail(accounts.autoAttachError
        ? `CDP account attach thất bại: ${accounts.autoAttachError}`
        : "Chưa có Google Flow account connected trong MCP; hãy Connect Flow Login Bridge rồi thử lại");
    }
    const accountId = accounts.defaultAccountId;
    const capabilities = jsonFromTool(await callTool(client, "flow_inspect_account", { accountId }), "flow_inspect_account");
    if (!capabilities.workspaceAvailable) fail("Google Flow account đã có nhưng chưa xác nhận workspace thật");
    const model = chooseModel(capabilities, spec.model);
    const aspectRatio = chooseAspectRatio(capabilities, spec.aspectRatio || "16:9");
    await emit(progressPath, runId, "mcp.capability", "success", `Đã xác nhận workspace, model ${model} và aspect ratio ${aspectRatio}; bắt đầu từng shot.`, 0.16, { taskCount, model, aspectRatio, accountId });
    const timeoutSeconds = Math.max(15, Math.min(900, Number(spec.timeoutSeconds ?? 600)));
    for (let index = 0; index < spec.tasks.length; index += 1) {
      const task = spec.tasks[index];
      const assetId = safeText(task.assetId, "assetId", 100);
      const shotId = safeText(task.shotId, "shotId", 100);
      const title = safeText(task.title, "title", 180);
      const role = safeText(task.role, "role", 80);
      const rightsStatus = safeText(task.rightsStatus, "rightsStatus", 80);
      const prompt = safeText(task.prompt, "prompt", 20_000);
      const referenceFiles = (Array.isArray(task.referenceImages) ? task.referenceImages : []).slice(0, 4).map((relative) => {
        const absolute = path.resolve(workspace, safeRelative(relative, "referenceImages"));
        if (!within(workspace, absolute)) fail(`${shotId}: reference image vượt workspace`);
        return absolute;
      });
      await emit(progressPath, runId, "mcp.task", "running", `Shot ${index + 1}/${taskCount} (${shotId}): gửi đúng một flow_generate_image; không dùng gallery.`, 0.18 + (index / Math.max(taskCount, 1)) * 0.76, { taskIndex: index + 1, taskCount, shotId });
      try {
        const result = jsonFromTool(await callTool(client, "flow_generate_image", {
          accountId,
          prompt,
          ...(spec.flowProject ? { flowProject: safeText(spec.flowProject, "flowProject", 200) } : {}),
          model,
          aspectRatio,
          outputs: 1,
          referenceFiles,
          outputDirectory: outputDir,
          fileName: assetId,
          download: true,
          timeoutSeconds,
          confirmCreditSpend: true,
        }), "flow_generate_image");
        const job = await resolveJob(client, result, timeoutSeconds, runId, progressPath, index + 1, taskCount, shotId);
        const downloaded = Array.isArray(job.downloadedFiles) ? job.downloadedFiles : [];
        if (downloaded.length !== 1) fail(`${shotId}: job ${job.id} không trả đúng một downloadedFiles`);
        const source = path.resolve(downloaded[0]);
        const extension = path.extname(source).toLowerCase();
        if (!within(workspace, source) || !within(outputDir, source) || !IMAGE_EXTENSIONS.has(extension)) fail(`${shotId}: downloaded asset không nằm trong output của job`);
        const sourceStat = await stat(source);
        if (sourceStat.size <= 0) fail(`${shotId}: downloaded asset rỗng`);
        const assetDir = path.join(outputDir, "assets");
        await mkdir(assetDir, { recursive: true });
        const destination = path.join(assetDir, `${assetId}${extension}`);
        if (path.resolve(source) !== path.resolve(destination)) await copyFile(source, destination);
        outputs.push({ assetId, shotId, title, relativePath: path.relative(workspace, destination).replaceAll("\\", "/"), role, rightsStatus, status: "ready", providerJobId: job.id, sha256: await sha256File(destination), error: null });
        await emit(progressPath, runId, "mcp.task", "success", `Shot ${index + 1}/${taskCount} hoàn tất bằng job ${job.id}; file được xác nhận theo downloadedFiles.`, 0.18 + ((index + 1) / Math.max(taskCount, 1)) * 0.76, { taskIndex: index + 1, taskCount, shotId, providerJobId: job.id });
      } catch (error) {
        const message = redact(error);
        errors.push(`${shotId}: ${message}`);
        outputs.push({ assetId, shotId, title, relativePath: null, role, rightsStatus, status: "failed", providerJobId: null, sha256: null, error: message });
        await emit(progressPath, runId, "mcp.task", "blocked", `Shot ${index + 1}/${taskCount} bị chặn: ${message}`, 0.18 + (index / Math.max(taskCount, 1)) * 0.76, { taskIndex: index + 1, taskCount, shotId });
      }
    }
  } catch (error) {
    const detail = serverStderr.join("").trim();
    if (detail) fail(`${redact(error)}; MCP stderr: ${redact(detail)}`);
    throw error;
  } finally {
    await client.close().catch(() => undefined);
  }
  const ready = outputs.filter((output) => output.status === "ready").length;
  const status = ready === taskCount ? "succeeded_needs_review" : ready > 0 ? "blocked" : "failed";
  return { schemaVersion: "1.0.0", jobType: "image.generate", provider: "google_flow_mcp", projectId: spec.projectId, runId, status, toolName: "flow_generate_image", serverInfo, outputs, errors: errors.slice(0, MAX_ERRORS), createdAt: new Date().toISOString() };
}

async function entrypoint() {
  let outputDir;
  let report;
  try {
    const args = parseArgs(process.argv);
    const workspace = path.resolve(args.get("workspace"));
    outputDir = path.resolve(workspace, safeRelative(args.get("output-dir"), "output-dir"));
    await mkdir(outputDir, { recursive: true });
    report = await main();
  } catch (error) {
    report = { schemaVersion: "1.0.0", jobType: "image.generate", provider: "google_flow_mcp", status: "failed", outputs: [], errors: [redact(error)], createdAt: new Date().toISOString() };
  }
  if (outputDir) await writeFile(path.join(outputDir, "google-flow-mcp-image-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await emit(outputDir ? path.join(outputDir, "google-flow-mcp-progress.jsonl") : path.join(process.cwd(), "google-flow-mcp-progress.jsonl"), report.runId ?? "unknown", "job.complete", report.status === "succeeded_needs_review" ? "success" : "blocked", `Job kết thúc: ${report.outputs?.filter((output) => output.status === "ready").length ?? 0}/${report.outputs?.length ?? 0} ảnh sẵn sàng; report đã ghi local.`, 1, { taskCount: report.outputs?.length ?? 0 });
}

await entrypoint();
