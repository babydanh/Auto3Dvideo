import { invoke } from "@tauri-apps/api/core";
import { inferPromptTimingRequirements, promptSourceFingerprintInput, scriptMatchesPrompt, sha256Text } from "../browserflow/browserFlowHelpers";
import type { BrowserHandoffReport } from "../browserflow/browserFlowTypes";
import type { BlenderShotPreviewReport } from "../oneprompt/onePromptTypes";
import type { AppActivityRecorder, AppActivityUpdater, AppNotice, AppRefresh, AppStateSetter } from "../shared/appTypes";
import type { LocalScriptDocument, LocalScriptReviewReport } from "../shared/scriptTypes";
import { fallbackPromptTemplates, fallbackTopicProfiles } from "./topicTypes";
import type { LocalVideoPipelineReport, PromptTemplate, TopicProfile, TopicPromptPreview } from "./topicTypes";
import type { VoiceSettings } from "../voice/voiceTypes";
import { describeFlowDirectives, flowDirectivesForShot, formatFlowDirectives } from "../../flowCinematicDirectives";
import { useMemo, useState } from "react";

export function useTopicWorkflowState({ recordWorkspaceActivity, refresh, selectedProjectId, setLoading, setNotice, setSelectedRecipe, updateWorkspaceActivity, voiceSettings }: {
  recordWorkspaceActivity: AppActivityRecorder;
  refresh: AppRefresh;
  selectedProjectId: string;
  setLoading: AppStateSetter<boolean>;
  setNotice: AppNotice;
  setSelectedRecipe: AppStateSetter<string>;
  updateWorkspaceActivity: AppActivityUpdater;
  voiceSettings: VoiceSettings;
}) {
  const [topicProfiles, setTopicProfiles] = useState<TopicProfile[]>(fallbackTopicProfiles);

  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>(fallbackPromptTemplates);

  const [, setTopicPromptPreview] = useState<TopicPromptPreview | null>(null);

  const [, setTopicWorkflowMessage] = useState("Chưa chạy preview brief.");

  const [localVideoReport, setLocalVideoReport] = useState<LocalVideoPipelineReport | null>(null);

  const [localScriptReview, setLocalScriptReview] = useState<LocalScriptReviewReport | null>(null);

  const [selectedTopicProfileId, setSelectedTopicProfileId] = useState("science-explainer");

  const [selectedPromptTemplateId, setSelectedPromptTemplateId] = useState("content-brief-v1");

  const [topic, setTopic] = useState("");

  const [contentGoal, setContentGoal] = useState("Giải thích rõ, có nguồn và dễ xem trên video dọc");

  const [additionalPrompt, setAdditionalPrompt] = useState("");

  const selectedTopicProfile = useMemo(
    () => topicProfiles.find((profile) => profile.profileId === selectedTopicProfileId) ?? topicProfiles[0],
    [topicProfiles, selectedTopicProfileId],
  );

  const availablePromptTemplates = useMemo(
    () => promptTemplates.filter((template) => selectedTopicProfile?.promptTemplateIds.includes(template.templateId)),
    [promptTemplates, selectedTopicProfile],
  );

  function selectTopicProfile(profileId: string) {
    const profile = topicProfiles.find((item) => item.profileId === profileId);
    setSelectedTopicProfileId(profileId);
    if (profile) {
      setSelectedRecipe(profile.defaultRecipeKind);
      const firstTemplate = promptTemplates.find((template) => profile.promptTemplateIds.includes(template.templateId));
      if (firstTemplate) setSelectedPromptTemplateId(firstTemplate.templateId);
      if (!contentGoal.trim()) setContentGoal(profile.defaultAudience);
    }
  }

  async function previewTopicWorkflow() {
    if (!selectedTopicProfile || topic.trim().length < 3) {
      const message = "Hãy chọn profile và nhập chủ đề ít nhất 3 ký tự trước khi xem prompt.";
      setTopicWorkflowMessage(message);
      setNotice(message);
      recordWorkspaceActivity({ stage: "brief.validate", tool: "Prompt Studio", state: "blocked", message, nextAction: "Nhập chủ đề rồi thử lại." });
      return;
    }
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "prompt.compile", tool: "Prompt Studio", state: "running", message: "Đang biên soạn prompt từ brief; chưa gọi provider.", progress: 0 });
    setLoading(true);
    try {
      const preview = await invoke<TopicPromptPreview>("preview_topic_prompt", {
        request: {
          profileId: selectedTopicProfile.profileId,
          templateId: selectedPromptTemplateId,
          topic: topic.trim(),
          audience: selectedTopicProfile.defaultAudience,
          contentGoal: contentGoal.trim(),
          additionalPrompt: additionalPrompt.trim(),
        },
      });
      setTopicPromptPreview(preview);
      setSelectedRecipe(preview.selectedRecipeKind);
      const message = "Đã tạo bản xem trước prompt; chưa gọi model, chưa tạo media và chưa ghi project.";
      setTopicWorkflowMessage(message);
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra prompt rồi tạo storyboard." });
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      const message = `Không tạo được bản xem trước prompt: ${detail.slice(0, 360)}`;
      setTopicWorkflowMessage(message);
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra profile/template rồi thử lại." });
    } finally {
      setLoading(false);
    }
  }

  async function generateLocalScript(briefApproved: boolean, referenceContext = ""): Promise<LocalScriptDocument | null> {
    if (!selectedProjectId) {
      const message = "Hãy tạo hoặc chọn dự án trước khi sinh script.";
      setTopicWorkflowMessage(message);
      setNotice(message);
      recordWorkspaceActivity({ stage: "storyboard.validate", tool: "Workspace", state: "blocked", message, nextAction: "Tạo hoặc chọn project local." });
      return null;
    }
    if (!topic.trim()) {
      const message = "Hãy nhập prompt chính trước khi xây dựng workflow.";
      setTopicWorkflowMessage(message);
      setNotice(message);
      recordWorkspaceActivity({ stage: "storyboard.validate", tool: "Workspace", state: "blocked", message, nextAction: "Nhập một prompt mô tả video muốn tạo." });
      return null;
    }
    if (!briefApproved) {
      const message = "Hãy xem và duyệt brief trước khi sinh script.";
      setTopicWorkflowMessage(message);
      setNotice(message);
      recordWorkspaceActivity({ stage: "storyboard.validate", tool: "Workspace", state: "blocked", message, nextAction: "Xem brief rồi duyệt trước khi sinh script." });
      return null;
    }
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "storyboard.expand", tool: "Local worker", state: "running", message: "Đang tạo storyboard và shot list từ brief đã duyệt.", progress: 0 });
    setLoading(true);
    try {
      const referenceText = referenceContext.trim();
      const timingRequirements = inferPromptTimingRequirements(topic);
      const sourcePromptHash = await sha256Text(promptSourceFingerprintInput(topic, contentGoal, additionalPrompt, referenceText));
      const report = await invoke<LocalScriptReviewReport>("generate_local_video_script", {
        projectId: selectedProjectId,
        topic: topic.trim(),
        objective: contentGoal.trim() || "Tự phân tích prompt, chia shot và chọn cấu trúc hình ảnh phù hợp.",
        additionalPrompt: additionalPrompt.trim(),
        referenceContext: referenceText || null,
        sourcePromptHash,
        requestedShotCount: timingRequirements.shotCount,
        requestedDurationSeconds: timingRequirements.durationSeconds,
        approved: briefApproved,
      });
      const enrichedScript: LocalScriptDocument = {
        ...report.script,
        sourcePromptHash,
        requestedShotCount: timingRequirements.shotCount ?? report.script.segments.length,
        requestedDurationSeconds: timingRequirements.durationSeconds ?? report.script.totalDurationSeconds,
      };
      if (!scriptMatchesPrompt(enrichedScript, sourcePromptHash, timingRequirements)) {
        throw new Error(`Planner trả script không khớp prompt: cần ${timingRequirements.shotCount ?? "đủ theo brief"} shot và ${timingRequirements.durationSeconds ?? "thời lượng đã suy ra"} giây, nhận ${enrichedScript.segments.length} shot/${enrichedScript.totalDurationSeconds}s. Script bị loại, chưa dựng Blender/Flow.`);
      }
      const enrichedReport: LocalScriptReviewReport = { ...report, script: enrichedScript };
      setLocalScriptReview(enrichedReport);
      setLocalVideoReport(null);
      const message = "Đã phân tích prompt và dựng workflow nháp. Kiểm tra các shot rồi bấm Preview hoặc Xuất video.";
      setTopicWorkflowMessage(message);
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Sửa prompt/shot nếu cần rồi bấm Preview." });
      return enrichedScript;
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      const message = `Không sinh được script: ${detail.slice(0, 360)}`;
      setTopicWorkflowMessage(message);
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra project local và xem chi tiết lỗi." });
      return null;
    } finally {
      setLoading(false);
    }
  }

  function handleTopicInputChange(value: string) {
    setTopic(value);
    setLocalScriptReview(null);
    setLocalVideoReport(null);
    setTopicPromptPreview(null);
  }

  async function renderApprovedLocalVideo(script: LocalScriptDocument, scriptPath: string) {
    if (!selectedProjectId || !localScriptReview) {
      const message = "Chưa có project hoặc script để duyệt và kết xuất.";
      setTopicWorkflowMessage(message);
      setNotice(message);
      recordWorkspaceActivity({ stage: "render.validate", tool: "Workspace", state: "blocked", message, nextAction: "Tạo storyboard và chọn project trước." });
      return;
    }
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "render.local_video", tool: "Blender/FFmpeg", state: "running", message: "Đang tạo voice, subtitle và MP4 cục bộ.", progress: 0 });
    setTopicWorkflowMessage("Đã nhận lệnh duyệt. Đang tạo voice, subtitle và MP4 cục bộ; vui lòng chờ đến khi có kết quả.");
    setNotice("Đã nhận lệnh duyệt script; đang bắt đầu local render…");
    setLoading(true);
    try {
      const normalizedVoiceSettings: VoiceSettings = {
        ...voiceSettings,
        ...(script.voiceSettings ?? {}),
        voiceCueBySegment: { ...voiceSettings.voiceCueBySegment, ...(script.voiceSettings?.voiceCueBySegment ?? {}) },
      };
      const report = await invoke<LocalVideoPipelineReport>("render_approved_local_video", {
        projectId: selectedProjectId,
        scriptPath,
        script: { ...script, approvalStatus: "approved", voiceSettings: normalizedVoiceSettings },
        voice: normalizedVoiceSettings.presetVoice,
        approved: true,
      });
      setLocalVideoReport(report);
      setLocalScriptReview((current) => current ? { ...current, script: { ...script, approvalStatus: "approved" } } : current);
      const successMessage = `Đã kết xuất MP4 ${report.videoPath}; hãy mở file để xem/nghe rồi duyệt bàn giao.`;
      setTopicWorkflowMessage(successMessage);
      setNotice(successMessage);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message: successMessage, output: report.videoPath, nextAction: "Mở preview và kiểm tra chất lượng trước khi bàn giao." });
      await refresh();
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      const errorMessage = `Không kết xuất được video: ${detail.slice(0, 360)}`;
      setTopicWorkflowMessage(errorMessage);
      setNotice(errorMessage);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message: errorMessage, nextAction: "Xem log tool và thử lại khi đã sửa blocker." });
    } finally {
      setLoading(false);
    }
  }

  async function buildBlenderShotPreview(script: LocalScriptDocument, renderVideo = false): Promise<BlenderShotPreviewReport | null> {
    if (!selectedProjectId) {
      const message = "Hãy tạo hoặc chọn project trước khi dựng Blender preview.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "blender.validate", tool: "Blender", state: "blocked", message, nextAction: "Tạo hoặc chọn project local." });
      return null;
    }
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: renderVideo ? "blender.render.final" : "blender.render.preview", tool: "Blender", state: "running", message: renderVideo ? "Đang dựng scene và render Blender output." : "Đang dựng scene 3D preview local.", progress: 0 });
    setLoading(true);
    setNotice("Đang chuyển shot plan sang Blender preview local…");
    try {
      const report = await invoke<BlenderShotPreviewReport>("build_blender_shot_preview", { request: { projectId: selectedProjectId, script, renderVideo } });
      const boardCount = report.shotPreviewPaths?.length ?? report.shotCount;
      setNotice(`Đã dựng storyboard Blender: ${boardCount} shot board + edit plan.`);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message: `Blender đã tạo scene, ${boardCount} shot board và edit plan; output đã trả về để review.`, output: report.editPlanPath ?? report.videoPath ?? report.previewPath, nextAction: "Review storyboard rồi chuẩn bị prompt + ảnh cho Omni." });
      return report;
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "Blender chưa sẵn sàng";
      const message = `Không tạo được Blender preview: ${detail.slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra Blender output và cấu hình tool." });
      return null;
    } finally { setLoading(false); }
  }

  async function prepareBrowserHandoffFromBlender(script: LocalScriptDocument, report: BlenderShotPreviewReport) {
    if (!selectedProjectId) {
      recordWorkspaceActivity({ stage: "browser.handoff.validate", tool: "BrowserMCP", state: "blocked", message: "Chưa có project để tạo handoff pack.", nextAction: "Tạo hoặc chọn project local." });
      return;
    }
    const storyboardPaths = report.shotPreviewPaths?.length ? report.shotPreviewPaths : [report.previewPath];
    const referencePaths = (script.referenceAssetPaths ?? []).filter(Boolean);
    const comfyuiPaths = (script.comfyuiAssetPaths ?? []).filter(Boolean);
    const geminiPaths = (script.geminiAssetPaths ?? []).filter(Boolean);
    // BrowserMCP handoff contract allows at most 8 input assets. Prefer one
    // Gemini still per shot when available; otherwise use the corresponding
    // semantic Blender board. Keep the user's reference in the remaining slot.
    const perShotPaths = storyboardPaths.map((boardPath, index) => comfyuiPaths[index] ?? geminiPaths[index] ?? boardPath).slice(0, 8);
    const assetPaths = [...new Set([...referencePaths, ...perShotPaths])].slice(0, 8);
    const handoffId = `handoff-${Date.now()}`;
    const outputDirectory = `outputs/browser-handoff/${handoffId}`;
    const compact = (value: string, limit: number) => {
      const normalized = value.replace(/\s+/g, " ").trim();
      return normalized.length > limit ? `${normalized.slice(0, Math.max(1, limit - 1)).trimEnd()}…` : normalized;
    };
    const sceneMode = script.segments.find((segment) => segment.sceneMode)?.sceneMode ?? "generic_cinematic";
    const globalPrompt = [
      "GOOGLE FLOW / OMNI FINAL VIDEO REQUEST",
      "Create one coherent, polished final video from the attached Blender storyboard images and shot references.",
      `Project concept: ${compact(script.title, 220)}. Scene mode: ${sceneMode}.`,
      "The attached Blender images are SEMANTIC STORYBOARD BOARDS, not final renders. Their primitive grammar is authoritative: cyan circle/ellipse = main subject, orange capsule = person or scale marker, blue blocks = environment, violet blocks/cylinders = props or clues, yellow block = camera/framing, orange arrow = action direction. Replace every primitive with the subject and world described by the shot prompt; never output the proxy geometry, contact-sheet layout, UI, labels or debug geometry.",
      "Use every beat anchor as a real visual change inside the shot: establish composition, action movement, reveal/new clue or subject, then resolve/transition. Use attached user reference images as identity/style/composition guidance when present.",
      "If ComfyUI or Gemini sketch images are attached, treat them as additional shot design references only; preserve the semantic beat plan and replace any rough shapes with final 3D visuals.",
      "GLOBAL VISUAL BIBLE: keep one hero subject with identical silhouette, proportions, materials, palette and screen direction across every shot. Use physically plausible materials, readable contact shadows, atmospheric depth, clean cinematic motion and a consistent 16:9 composition.",
      "QUALITY AND SAFETY: no random characters or props, no text artifacts, no logos, no watermark, no morphing, no flicker, no broken geometry, no camera jumps. Preserve the intended narration meaning but do not burn subtitles or UI into the generated picture.",
      "SHOT PLAN:",
    ].join("\n");
    const shotBudget = Math.max(220, Math.floor((3900 - globalPrompt.length) / Math.max(1, script.segments.length)));
    const purposeLimit = Math.min(110, Math.max(60, Math.floor(shotBudget * 0.18)));
    const continuityLimit = Math.min(120, Math.max(70, Math.floor(shotBudget * 0.18)));
    const beatLimit = Math.min(260, Math.max(120, Math.floor(shotBudget * 0.3)));
    const visualLimit = Math.max(140, shotBudget - purposeLimit - continuityLimit - beatLimit - 92);
    const shotLines = script.segments.map((segment, index) => {
      const beatText = (segment.beats ?? []).map((beat) => `${beat.imageRole}@${Math.round(beat.timeFraction * 100)}%: ${beat.action}; camera=${beat.cameraPrompt}`).join(" || ");
      const shot = [
        `SHOT ${String(index + 1).padStart(2, "0")} · ${segment.durationSeconds.toFixed(1)}s`,
        `Purpose: ${compact(segment.narration, purposeLimit)}`,
        `Visual direction: ${compact(segment.visualPrompt ?? segment.narration, visualLimit)}`,
        `Beat anchors (semantic storyboard): ${compact(beatText || "establish → action → reveal → resolve", beatLimit)}`,
        `Flow cinematic commands: ${formatFlowDirectives(flowDirectivesForShot(segment.flowDirectives, index))}; ${compact(describeFlowDirectives(flowDirectivesForShot(segment.flowDirectives, index)), 260)}`,
        `Continuity: ${compact(segment.continuityNotes ?? "Preserve hero identity and screen direction.", continuityLimit)}`,
      ].join(" | ");
      return shot;
    });
    const prompt = `${globalPrompt}\n${shotLines.join("\n")}`;
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "browser.handoff.prepare", tool: "BrowserMCP", state: "running", message: "Đang chuẩn bị handoff pack từ shot revision hiện tại; chưa upload và chưa Generate.", progress: 0 });
    setLoading(true);
    try {
      const handoff = await invoke<BrowserHandoffReport>("prepare_browser_handoff", { request: { projectId: selectedProjectId, handoffId, targetUrl: "https://labs.google/fx/tools/flow", prompt, inputAssets: assetPaths.map((relativePath) => ({ relativePath, mediaKind: "image" })), outputDirectory, paidGeneration: false, rightsStatus: "generated_local", termsReviewed: false } });
      setNotice(`Đã chuẩn bị gói làm việc từ Blender: ${handoff.handoffPath}. BrowserOS neo sẽ được dùng cho bước Omni khi quy trình chạy.`);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message: "Đã tạo handoff pack local; Browser Handoff chỉ giữ kết nối BrowserOS neo.", output: handoff.handoffPath, nextAction: "Kiểm tra kết nối BrowserOS neo ở Connection Center." });
    } catch (error) {
      const message = `Không tạo được BrowserMCP handoff từ Blender: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra output Blender và quyền workspace." });
    } finally { setLoading(false); }
  }

  async function prepareGeminiStoryboardFromBlender(script: LocalScriptDocument, report: BlenderShotPreviewReport) {
    if (!selectedProjectId) {
      const message = "Chưa có project để tạo pack phác Gemini.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "gemini.storyboard.validate", tool: "Gemini / BrowserMCP", state: "blocked", message, nextAction: "Tạo hoặc chọn project local." });
      return;
    }
    const storyboardPaths = report.shotPreviewPaths?.length ? report.shotPreviewPaths : [report.previewPath];
    const inputPaths = [...new Set([...(script.referenceAssetPaths ?? []), ...(script.comfyuiAssetPaths ?? []), ...storyboardPaths])].slice(0, 8);
    const geminiHeader = [
      "GEMINI STORYBOARD IMAGE PASS — create reference stills, not final video.",
      "Generate one clean 16:9 concept image for each numbered SHOT below, one at a time if the interface only returns one image per request.",
      "Use the attached semantic Blender board as layout guidance: cyan circle/ellipse is the main subject, orange capsule is a person/scale marker, blue blocks are environment, violet markers are props/clues, yellow block is camera framing, orange arrow is action direction.",
      "Replace primitives with a readable cinematic 3D sketch matching the user's prompt. Keep the same subject identity, palette and screen direction across shots. Do not draw contact-sheet UI, debug primitives, labels, watermark or text inside the generated image.",
      "Save/label each downloaded image as GEMINI-SHOT-01.png, GEMINI-SHOT-02.png, etc. These stills will be imported locally and attached to the later Google Flow/Omni handoff; they are references, not the final video.",
    ].join("\n");
    const compactGemini = (value: string, limit: number) => {
      const normalized = value.replace(/\s+/g, " ").trim();
      return normalized.length > limit ? `${normalized.slice(0, Math.max(1, limit - 1)).trimEnd()}…` : normalized;
    };
    const perShotLimit = Math.max(180, Math.floor((3900 - geminiHeader.length - 20) / Math.max(1, script.segments.length)));
    const shotLines = script.segments.map((segment, index) => {
      const beatText = (segment.beats ?? []).map((beat) => `${beat.imageRole}: ${beat.action}; camera=${beat.cameraPrompt}`).join(" | ");
      const flowCommands = flowDirectivesForShot(segment.flowDirectives, index);
      return `SHOT ${String(index + 1).padStart(2, "0")} · ${segment.durationSeconds.toFixed(1)}s · FLOW: ${formatFlowDirectives(flowCommands)} (${compactGemini(describeFlowDirectives(flowCommands), 220)}) · ${compactGemini(`${segment.visualPrompt ?? segment.narration} · BEATS: ${beatText || "establish → action → reveal → resolve"}`, perShotLimit)}`;
    });
    const prompt = `${geminiHeader}\n${shotLines.join("\n")}`;
    const handoffId = `gemini-storyboard-${Date.now()}`;
    const outputDirectory = `outputs/browser-handoff/${handoffId}`;
    const startedAt = performance.now();
    const activityId = recordWorkspaceActivity({ stage: "gemini.storyboard.prepare", tool: "Gemini / BrowserMCP", state: "running", message: "Đang chuẩn bị pack prompt + semantic storyboard cho Gemini; chưa upload hay Generate tự động.", progress: 0 });
    setLoading(true);
    try {
      const handoff = await invoke<BrowserHandoffReport>("prepare_browser_handoff", { request: { projectId: selectedProjectId, handoffId, targetUrl: "https://gemini.google.com/app", prompt, inputAssets: inputPaths.map((relativePath) => ({ relativePath, mediaKind: "image" })), outputDirectory, paidGeneration: false, rightsStatus: "generated_local", termsReviewed: false } });
      const message = `Đã tạo pack Gemini: ${handoff.handoffPath}. Mở Gemini, tạo ảnh từng SHOT, tải PNG về rồi bấm “Nhập ảnh Gemini” ở Quy trình video.`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "success", progress: 1, durationMs: Math.round(performance.now() - startedAt), message, output: handoff.handoffPath, nextAction: "Mở pack prompt, tạo ảnh từng shot, tải về local và nhập lại workspace." });
    } catch (error) {
      const message = `Không tạo được pack Gemini: ${String(error).slice(0, 360)}`;
      setNotice(message);
      updateWorkspaceActivity(activityId, { state: "error", durationMs: Math.round(performance.now() - startedAt), message, nextAction: "Kiểm tra project, output Blender và BrowserMCP allowlist." });
    } finally { setLoading(false); }
  }

  void buildBlenderShotPreview;

  void prepareBrowserHandoffFromBlender;

  void prepareGeminiStoryboardFromBlender;

  async function loadTopicProfiles() {
    return invoke<TopicProfile[]>("list_topic_profiles");
  }

  async function loadPromptTemplates() {
    return invoke<PromptTemplate[]>("list_prompt_templates");
  }
  return {
    loadPromptTemplates,
    loadTopicProfiles,
    additionalPrompt,
    availablePromptTemplates,
    buildBlenderShotPreview,
    contentGoal,
    generateLocalScript,
    handleTopicInputChange,
    localScriptReview,
    localVideoReport,
    prepareBrowserHandoffFromBlender,
    prepareGeminiStoryboardFromBlender,
    previewTopicWorkflow,
    promptTemplates,
    renderApprovedLocalVideo,
    selectTopicProfile,
    selectedPromptTemplateId,
    selectedTopicProfile,
    selectedTopicProfileId,
    setAdditionalPrompt,
    setContentGoal,
    setLocalScriptReview,
    setLocalVideoReport,
    setPromptTemplates,
    setSelectedPromptTemplateId,
    setSelectedTopicProfileId,
    setTopic,
    setTopicProfiles,
    setTopicPromptPreview,
    setTopicWorkflowMessage,
    topic,
    topicProfiles,
  };
}
