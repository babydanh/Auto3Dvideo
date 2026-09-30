import { invoke } from "@tauri-apps/api/core";
import { VOICE_EMOTION_OPTIONS } from "./voiceTypes";
import type { OmniVoiceReadinessReport, OmniVoiceTtsReport, VoiceEmotion, VoiceProfile, VoiceSample, VoiceSettings } from "./voiceTypes";
import { mediaBlobToWavBytes } from "./wavCapture";
import { useEffect, useRef, useState } from "react";

type OmniVoiceStudioPanelProps = {
  projectId: string;
  profiles: VoiceProfile[];
  samples: VoiceSample[];
  readiness: OmniVoiceReadinessReport;
  report: OmniVoiceTtsReport | null;
  error: string | null;
  loading: boolean;
  settings: VoiceSettings;
  onSettingsChange: (settings: VoiceSettings) => void;
  onCheck: (projectId: string) => void;
  onPrepareModel: (projectId: string) => void;
  onChooseReference: () => Promise<string | null>;
  onNotice: (message: string) => void;
  onCreate: (input: { name: string; mode: "clone" | "design"; language: string; instruct: string; sourceAudioPath?: string; referenceTranscript?: string; cloneConsent: boolean }) => void;
  onUpdate: (input: { voiceProfileId: string; name: string; language: string; instruct: string; referenceTranscript?: string; cloneConsent: boolean }) => void;
  onDelete: (profile: VoiceProfile) => void;
  onSynthesize: (input: { voiceProfileId: string; text: string; language: string; speed: number; durationSeconds?: number; qualityPreset: "preview" | "balanced" | "quality"; classTemperature: number; positionTemperature: number; normalizeText: boolean; emotionCode?: VoiceEmotion }) => void;
};

export function OmniVoiceStudioPanel({ projectId, profiles, samples, readiness, report, error, loading, settings, onSettingsChange, onCheck, onPrepareModel, onChooseReference, onNotice, onCreate, onUpdate, onDelete, onSynthesize }: OmniVoiceStudioPanelProps) {
  const [mode, setMode] = useState<"clone" | "design">("design");
  const [selectedId, setSelectedId] = useState(settings.voiceProfileId ?? profiles[0]?.voiceProfileId ?? "");
  const selected = profiles.find((profile) => profile.voiceProfileId === selectedId) ?? null;
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [instruct, setInstruct] = useState("male, middle-aged, low pitch, british accent");
  const [sourceAudioPath, setSourceAudioPath] = useState("");
  const [referenceTranscript, setReferenceTranscript] = useState("");
  const [cloneConsent, setCloneConsent] = useState(false);
  const [text, setText] = useState("Welcome to Auto3Dvideo. This is a local OmniVoice preview for an international documentary narrator.");
  const [emotionCode, setEmotionCode] = useState<VoiceEmotion>(settings.emotionCodeBySegment?.["default"] ?? "neutral");
  const [speed, setSpeed] = useState(1);
  const [durationSeconds, setDurationSeconds] = useState("");
  const [qualityPreset, setQualityPreset] = useState<"preview" | "balanced" | "quality">("preview");
  const [classTemperature, setClassTemperature] = useState(0);
  const [positionTemperature, setPositionTemperature] = useState(5);
  const [normalizeText, setNormalizeText] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [referenceAudioUrl, setReferenceAudioUrl] = useState<string | null>(null);
  const [referenceAudioError, setReferenceAudioError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSavingRecording, setIsSavingRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingSecondsRef = useRef(0);
  const [recordingAudioUrl, setRecordingAudioUrl] = useState<string | null>(null);
  const [recordingMessage, setRecordingMessage] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!selectedId && profiles[0]) setSelectedId(profiles[0].voiceProfileId);
    if (selectedId && !profiles.some((profile) => profile.voiceProfileId === selectedId)) setSelectedId(profiles[0]?.voiceProfileId ?? "");
  }, [profiles, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setMode(selected.mode);
    setName(selected.name);
    setLanguage(selected.language);
    setInstruct(selected.instruct ?? "");
    setSourceAudioPath(selected.referenceAudioPath ?? "");
    setReferenceTranscript(selected.referenceTranscript ?? "");
    setCloneConsent(selected.cloneConsent);
    onSettingsChange({ ...settings, voiceProfileId: selected.voiceProfileId, presetVoice: selected.name, mode: selected.mode, language: selected.language, instruct: selected.instruct ?? "", cloneEnabled: selected.mode === "clone", cloneConsent: selected.cloneConsent, referenceAudioPath: selected.referenceAudioPath ?? undefined });
  }, [selected?.voiceProfileId]);

  useEffect(() => {
    if (!report?.outputPath) return;
    const isTauri = typeof window !== "undefined" && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
    if (!isTauri) return;
    void invoke<string>("read_project_audio_base64", { projectId, relativePath: report.outputPath })
      .then((base64) => setAudioUrl(`data:audio/wav;base64,${base64}`))
      .catch(() => setAudioUrl(null));
  }, [report?.outputPath, projectId]);

  useEffect(() => {
    setReferenceAudioUrl(null);
    setReferenceAudioError(null);
    const referencePath = selected?.referenceAudioPath;
    const isTauri = typeof window !== "undefined" && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
    if (!projectId || !referencePath || !isTauri) return;
    const extension = referencePath.split(".").pop()?.toLowerCase();
    const mime = extension === "wav" ? "audio/wav" : extension === "flac" ? "audio/flac" : extension === "ogg" ? "audio/ogg" : extension === "m4a" ? "audio/mp4" : "audio/mpeg";
    void invoke<string>("read_project_audio_base64", { projectId, relativePath: referencePath })
      .then((base64) => setReferenceAudioUrl(`data:${mime};base64,${base64}`))
      .catch((loadError) => setReferenceAudioError(typeof loadError === "string" ? loadError : "Không nạp được audio mẫu để review."));
  }, [selected?.voiceProfileId, selected?.referenceAudioPath, projectId]);

  useEffect(() => () => {
    if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current);
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const statusLabel = readiness.status === "ready" ? "SẴN SÀNG" : readiness.status === "model_missing" ? "CẦN CÀI MODEL" : readiness.status === "missing_package" ? "CẦN CÀI PACKAGE" : readiness.status.toUpperCase();
  const readinessBlocker = readiness.status === "ready"
    ? null
    : readiness.status === "not_checked"
      ? "OmniVoice chưa được kiểm tra. Bấm “Kiểm tra local” trước."
      : readiness.status === "model_missing"
        ? "Chưa có model/tokenizer local. Bấm “Cài model OmniVoice”; synthesis không tự tải model."
        : readiness.status === "missing_package"
          ? "Python chưa có package OmniVoice hoặc PyTorch. Cấu hình đúng Python/package trong Cài đặt rồi kiểm tra lại."
          : readiness.status === "device_unavailable"
            ? "Không nhận diện được device chạy PyTorch. Kiểm tra Python/PyTorch hoặc cấu hình GPU rồi thử lại."
            : `OmniVoice chưa sẵn sàng: ${readiness.message}`;
  const profileBlocker = !selected
    ? "Chưa chọn voice profile. Chọn một profile local hoặc tạo voice design trước."
    : selected.status !== "ready"
      ? selected.mode === "clone" && selected.status === "needs_consent"
        ? "Profile clone chưa ready: xác nhận quyền sử dụng audio mẫu ở PROFILE EDITOR rồi bấm “Lưu thay đổi”."
        : `Profile đang ở trạng thái ${selected.status}; chưa thể chạy synthesis.`
      : null;
  const synthesizeBlocker = !projectId
    ? "Chưa có project local. Hãy tạo hoặc chọn project trước."
    : profileBlocker
      ?? readinessBlocker
      ?? (!text.trim() ? "Chưa nhập văn bản thử." : null);
  const canSynthesize = Boolean(!synthesizeBlocker && !loading);

  function selectProfile(profile: VoiceProfile) {
    setSelectedId(profile.voiceProfileId);
    setAudioUrl(null);
  }

  function focusCloneConsent() {
    const consentInput = document.querySelector<HTMLInputElement>(".omnivoice-editor .omnivoice-consent input");
    consentInput?.scrollIntoView({ behavior: "smooth", block: "center" });
    consentInput?.focus({ preventScroll: true });
    onNotice("Đã đưa tới checkbox quyền clone. Chỉ bật nếu bạn thật sự có quyền dùng audio mẫu, sau đó bấm “Lưu thay đổi”.");
  }

  function startNewProfile(nextMode: "clone" | "design") {
    setMode(nextMode);
    setSelectedId("");
    setName(nextMode === "clone" ? "My narrator clone" : "Documentary narrator");
    setLanguage(nextMode === "clone" ? "en" : "en");
    setInstruct(nextMode === "clone" ? "" : "male, middle-aged, low pitch, british accent");
    setSourceAudioPath(nextMode === "clone" ? samples[0]?.relativePath ?? "" : "");
    setReferenceTranscript(nextMode === "clone" ? samples[0]?.transcript ?? "" : "");
    setCloneConsent(false);
    setAudioUrl(null);
    setRecordingAudioUrl(null);
    setRecordingMessage(nextMode === "clone" && samples[0] ? `Đã chọn bản ghi có sẵn: ${samples[0].fileName}. Transcript đã được nạp; hãy kiểm tra trước khi tạo.` : null);
  }

  function selectExistingVoiceSample(sample: VoiceSample) {
    setMode("clone");
    setSelectedId("");
    setName("My narrator clone");
    setLanguage("vi");
    setSourceAudioPath(sample.relativePath);
    setReferenceTranscript(sample.transcript ?? "");
    setRecordingAudioUrl(null);
    setRecordingMessage(sample.transcript ? `Đã chọn ${sample.fileName}. Transcript đã nạp tự động; hãy nghe và kiểm tra.` : `Đã chọn ${sample.fileName}. Hãy nhập transcript chính xác.`);
    onNotice(`Đã chọn file voice mẫu: ${sample.relativePath}. ${sample.transcript ? "Transcript đã nạp; " : "Cần nhập transcript; "}chưa tạo profile và vẫn cần xác nhận quyền.`);
  }

  async function startMicrophoneRecording() {
    if (isRecording || isSavingRecording || loading) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      const message = "Thiết bị này không hỗ trợ thu microphone trong WebView.";
      setRecordingMessage(message);
      onNotice(message);
      return;
    }
    onNotice("Đang xin quyền microphone… Hãy nói tự nhiên khoảng 5–10 giây rồi bấm Dừng thu.");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      const supportedMime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((mime) => MediaRecorder.isTypeSupported(mime));
      const recorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime, audioBitsPerSecond: 128000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 128000 });
      recordingStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      setRecordingAudioUrl(null);
      setRecordingMessage("Đang thu microphone…");
      recordingSecondsRef.current = 0;
      setRecordingSeconds(0);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        void (async () => {
          stream.getTracks().forEach((track) => track.stop());
          recordingStreamRef.current = null;
          const recordedBlob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
          setRecordingAudioUrl(URL.createObjectURL(recordedBlob));
          if (recordingSecondsRef.current < 3) {
            const message = "Bản ghi quá ngắn. Hãy thu ít nhất 3 giây, tốt nhất 5–10 giây để clone ổn định.";
            setRecordingMessage(message);
            onNotice(message);
            return;
          }
          setIsSavingRecording(true);
          setRecordingMessage("Đang chuyển bản ghi sang WAV 24 kHz và lưu vào workspace…");
          onNotice("[1/2] Đang chuyển bản ghi microphone sang WAV chuẩn OmniVoice…");
          try {
            const dataBytes = await mediaBlobToWavBytes(recordedBlob);
            const relativePath = `.auto3dvideo/voice-recordings/mic-${Date.now()}.wav`;
            const savedPath = await invoke<string>("save_recorded_audio_for_project", { projectId, relativePath, dataBytes });
            setSourceAudioPath(savedPath);
            setCloneConsent(false);
            setRecordingMessage("Đã lưu bản ghi. Nghe lại, nhập transcript chính xác rồi xác nhận quyền clone.");
            onNotice("[2/2] Đã lưu bản ghi WAV vào workspace. Còn 2 việc: nhập transcript và xác nhận quyền sử dụng.");
          } catch (error) {
            const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi không xác định";
            setRecordingMessage(`Không lưu được bản ghi: ${detail.slice(0, 260)}`);
            onNotice(`Thu âm thất bại: ${detail.slice(0, 320)}`);
          } finally {
            setIsSavingRecording(false);
          }
        })();
      };
      recorder.start(250);
      setIsRecording(true);
      recordingTimerRef.current = window.setInterval(() => {
        recordingSecondsRef.current += 1;
        setRecordingSeconds(recordingSecondsRef.current);
      }, 1000);
    } catch (error) {
      const detail = error instanceof DOMException && error.name === "NotAllowedError"
        ? "Windows/Chrome chưa cấp quyền microphone cho app. Hãy bật quyền Microphone rồi thử lại."
        : `Không mở được microphone: ${error instanceof Error ? error.message : "lỗi không xác định"}`;
      setRecordingMessage(detail);
      onNotice(detail);
    }
  }

  function stopMicrophoneRecording() {
    if (!mediaRecorderRef.current || !isRecording) return;
    mediaRecorderRef.current.stop();
    setIsRecording(false);
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    onNotice("Đã dừng thu; đang kiểm tra và lưu bản ghi…");
  }

  return <section className="omnivoice-studio">
    <div className="panel omnivoice-header">
      <div><p className="eyebrow accent">VOICE STUDIO / OMNIVOICE LOCAL</p><h2>Giọng đọc cho video quốc tế</h2><p className="section-subtitle">Tạo clone từ file bạn có quyền sử dụng hoặc thiết kế giọng bằng prompt. Profile, audio mẫu và preview được lưu trong data workspace; synthesis không cần API key.</p></div>
      <div className={`omnivoice-status ${readiness.status === "ready" ? "ready" : "blocked"}`}><strong>{statusLabel}</strong><span>{readiness.device} · {readiness.modelCachePresent ? "model đã có" : "model chưa có"}</span></div>
    </div>

    <div className="panel omnivoice-actions-bar"><div><strong>Trạng thái thật</strong><span>{readiness.message}</span><small>Model: {readiness.modelId} · tokenizer: {readiness.audioTokenizerId} · network: {readiness.networkCallsMade ? "đã dùng để cài model" : "không gọi"}</small></div><div className="omnivoice-action-buttons"><button className="secondary-button" onClick={() => onCheck(projectId)} disabled={!projectId || loading}>{loading ? "Đang kiểm tra…" : "Kiểm tra local"}</button><button className="primary-button" onClick={() => onPrepareModel(projectId)} disabled={!projectId || loading || readiness.status === "ready"}>{loading ? "Đang cài…" : "Cài model OmniVoice"}</button></div></div>

    <div className="omnivoice-layout">
      <aside className="panel omnivoice-library"><div className="section-heading"><div><p className="eyebrow">LOCAL VOICE LIBRARY</p><h3>Profile & preset local</h3></div><span className="count-chip">{profiles.length}</span></div><div className="omnivoice-mode-buttons"><button className={mode === "clone" && !selected ? "active" : ""} onClick={() => startNewProfile("clone")} disabled={loading}>+ Clone voice</button><button className={mode === "design" && !selected ? "active" : ""} onClick={() => startNewProfile("design")} disabled={loading}>+ Voice design</button></div>{profiles.length === 0 ? <div className="omnivoice-empty">Chưa có profile. App sẽ nạp preset local khi mở lại project.</div> : <div className="omnivoice-profile-list">{profiles.map((profile) => <button type="button" key={profile.voiceProfileId} className={`omnivoice-profile-card ${selectedId === profile.voiceProfileId ? "selected" : ""}`} onClick={() => selectProfile(profile)}><span className={`voice-profile-dot ${profile.status === "ready" ? "ready" : "blocked"}`} /><span><strong>{profile.name}</strong><small>{profile.mode === "clone" ? "Clone" : "Design"} · {profile.language} · {profile.status}{profile.voiceProfileId.startsWith("voice-en-") || profile.voiceProfileId.startsWith("voice-vi-") ? " · Preset local" : ""}</small></span></button>)}</div>}<div className="omnivoice-rights-note"><strong>Quyền model</strong><span>Preset mặc định là voice design, không phải giọng người thật. Code Apache-2.0; pretrained model OmniVoice CC-BY-NC, cần kiểm tra quyền trước khi thương mại hoá.</span></div></aside>

      <div className="omnivoice-main">
      {selected?.mode === "clone" && selected.referenceAudioPath && <div className="panel omnivoice-reference-preview"><div><strong>Nghe audio mẫu để review</strong><small>{selected.referenceAudioPath} · transcript phải khớp trước khi tạo clone</small></div>{referenceAudioUrl ? <audio controls preload="metadata" src={referenceAudioUrl} /> : <span>{referenceAudioError ?? "Đang nạp audio mẫu…"}</span>}</div>}
      <div className="panel omnivoice-editor">
        <div className="section-heading"><div><p className="eyebrow">PROFILE EDITOR</p><h3>{selected ? `Chỉnh “${selected.name}”` : mode === "clone" ? "Tạo clone voice" : "Tạo voice design"}</h3></div><span className="readiness-chip">{selected?.status ?? "DRAFT"}</span></div>
        <div className="omnivoice-editor-grid"><label>Tên profile<input value={name} onChange={(event) => setName(event.target.value)} placeholder="International documentary narrator" /></label><label>Ngôn ngữ chính<select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="en">English</option><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="vi">Vietnamese</option><option value="ja">Japanese</option><option value="ko">Korean</option><option value="zh">Chinese</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option></select></label></div>
        {mode === "design" ? <><label>Voice design tokens<textarea rows={5} value={instruct} onChange={(event) => setInstruct(event.target.value)} placeholder="English: male, middle-aged, low pitch, british accent" /><small className="field-help">Dùng token model hỗ trợ, phân tách bằng dấu phẩy. English: male, female, age, pitch, accent.</small></label><div className="omnivoice-preset-row"><span>Preset nhanh:</span>{["male, middle-aged, low pitch, british accent", "female, young adult, moderate pitch, american accent", "male, elderly, very low pitch, australian accent"].map((preset) => <button type="button" key={preset} onClick={() => setInstruct(preset)} disabled={loading}>{preset}</button>)}</div></> : <>
          <div className="omnivoice-file-row"><label>Audio mẫu đã chọn<input value={sourceAudioPath || selected?.referenceAudioPath || ""} readOnly placeholder="Chưa chọn file audio" /></label><button className="secondary-button" onClick={async () => { const chosen = await onChooseReference(); if (chosen) { setSourceAudioPath(chosen); setRecordingAudioUrl(null); setRecordingMessage("Đã chọn file audio; hãy nhập transcript chính xác."); } }} disabled={loading || isSavingRecording}>Chọn file ngoài</button></div>
          {!selected && samples.length > 0 && <div className="omnivoice-local-samples"><div className="omnivoice-local-samples-heading"><div><strong>Kho voice mẫu local</strong><small>{samples.length} WAV · mẫu có transcript sẽ tự nạp khi chọn</small></div><span>LOCAL</span></div><div className="omnivoice-local-sample-list">{samples.map((sample) => <button type="button" className={`omnivoice-local-sample ${sourceAudioPath === sample.relativePath ? "selected" : ""}`} key={sample.relativePath} onClick={() => selectExistingVoiceSample(sample)} disabled={loading || isSavingRecording}><span><strong>{sample.fileName}</strong><small>{sample.sourceKind === "recording" ? "Bản ghi microphone" : sample.sourceDataset ? `${sample.sourceDataset} · ${sample.license ?? "license chưa ghi"}` : "Audio mẫu"} · {sample.durationSeconds ? `${sample.durationSeconds.toFixed(1)}s` : "WAV"} · {Math.round(sample.sizeBytes / 1024)} KB</small></span><b>{sourceAudioPath === sample.relativePath ? "Đang chọn" : "Dùng bản này"}</b></button>)}</div></div>}
          {!selected && <div className="omnivoice-mic-panel"><div><strong>Hoặc thu trực tiếp bằng microphone</strong><small>Nói rõ 5–10 giây. App chuyển bản ghi thành WAV 24 kHz và giữ toàn bộ xử lý local.</small></div><button type="button" className="secondary-button" onClick={isRecording ? stopMicrophoneRecording : () => void startMicrophoneRecording()} disabled={!projectId || loading || isSavingRecording}>{isRecording ? `⏹ Dừng thu (${recordingSeconds}s)` : isSavingRecording ? "Đang lưu bản ghi…" : "🎙 Thu bằng mic"}</button></div>}
          {recordingAudioUrl && <div className="omnivoice-recording-preview"><span>Nghe lại bản ghi microphone</span><audio controls preload="metadata" src={recordingAudioUrl} /></div>}
          {recordingMessage && <p className="attempt-note">{recordingMessage}</p>}
          <label>Transcript chính xác của audio<textarea rows={4} value={referenceTranscript} onChange={(event) => setReferenceTranscript(event.target.value)} placeholder="Gõ đúng từng câu bạn vừa nói trong audio mẫu để clone ổn định." /></label><label className="omnivoice-consent"><input type="checkbox" checked={cloneConsent} onChange={(event) => setCloneConsent(event.target.checked)} /> Tôi có quyền sử dụng file này và đồng ý tạo clone giọng cho dự án local.</label>
        </>}
        {selected ? <div className="omnivoice-editor-actions"><button className="primary-button" onClick={() => onUpdate({ voiceProfileId: selected.voiceProfileId, name, language, instruct, referenceTranscript, cloneConsent })} disabled={loading || !projectId || !name.trim()}>{loading ? "Đang lưu…" : "Lưu thay đổi"}</button><button className="danger-button" onClick={() => onDelete(selected)} disabled={loading}>Xoá profile</button></div> : <button className="primary-button" onClick={() => onCreate({ name, mode, language, instruct, sourceAudioPath: sourceAudioPath || undefined, referenceTranscript: referenceTranscript || undefined, cloneConsent })} disabled={loading || !projectId || !name.trim() || (mode === "design" ? !instruct.trim() : !sourceAudioPath || !referenceTranscript.trim())}>{loading ? "Đang tạo…" : mode === "clone" ? "Tạo clone profile" : "Tạo voice design"}</button>} {!projectId && <p className="attempt-note">Hãy tạo hoặc chọn project trước khi lưu profile.</p>}
      </div>

        <div className="panel omnivoice-test"><div className="section-heading"><div><p className="eyebrow">TEST WORKSPACE</p><h3>Nghe thử và tinh chỉnh</h3><p className="section-subtitle">Mỗi lần thử tạo một WAV mới, không ghi đè. Kết quả chỉ là preview cần người nghe duyệt.</p></div><span className="readiness-chip">{selected ? selected.name : "Chưa chọn profile"}</span></div><label>Văn bản thử<textarea rows={5} value={text} onChange={(event) => setText(event.target.value)} placeholder="Nhập câu bằng ngôn ngữ bạn muốn test…" /></label><label>Mã cảm xúc mặc định<select value={emotionCode} onChange={(event) => { const next = event.target.value as VoiceEmotion; setEmotionCode(next); onSettingsChange({ ...settings, emotionCodeBySegment: { ...(settings.emotionCodeBySegment ?? {}), default: next } }); }}>{VOICE_EMOTION_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.code.toUpperCase()} — {option.label} ({option.hint})</option>)}</select></label><p className="attempt-note">Có thể chèn trực tiếp <code>[EXCITED]</code>, <code>[SHOUTING]</code>, <code>[SAD]</code>… trong văn bản. Worker sẽ tách từng đoạn, không đọc thành tiếng mã tag; OmniVoice hiện áp dụng cue fallback an toàn.</p><div className="omnivoice-controls"><label>Language<input value={language} onChange={(event) => setLanguage(event.target.value)} /></label><label>Tốc độ <strong>{speed.toFixed(2)}×</strong><input type="range" min="0.5" max="2" step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /></label><label>Ép thời lượng (tuỳ chọn)<input type="number" min="0.5" max="600" step="0.5" value={durationSeconds} onChange={(event) => setDurationSeconds(event.target.value)} placeholder="Tự nhiên" /></label><label>Quality<select value={qualityPreset} onChange={(event) => setQualityPreset(event.target.value as "preview" | "balanced" | "quality")}><option value="preview">Preview nhanh</option><option value="balanced">Balanced</option><option value="quality">Quality</option></select></label><label>Class temp <strong>{classTemperature.toFixed(2)}</strong><input type="range" min="0" max="2" step="0.05" value={classTemperature} onChange={(event) => setClassTemperature(Number(event.target.value))} /></label><label>Position temp <strong>{positionTemperature.toFixed(2)}</strong><input type="range" min="0" max="10" step="0.1" value={positionTemperature} onChange={(event) => setPositionTemperature(Number(event.target.value))} /></label></div><label className="omnivoice-consent"><input type="checkbox" checked={normalizeText} onChange={(event) => setNormalizeText(event.target.checked)} /> Chuẩn hoá text trước khi đọc</label><button className="primary-button omnivoice-synthesize-button" onClick={() => onSynthesize({ voiceProfileId: selectedId, text, language, speed, durationSeconds: durationSeconds ? Number(durationSeconds) : undefined, qualityPreset, classTemperature, positionTemperature, normalizeText, emotionCode })} disabled={!canSynthesize}>{loading ? "Đang chạy OmniVoice…" : "Tạo preview WAV"}</button>{readiness.status !== "ready" && <p className="attempt-note">Chưa thể test: hãy bấm “Kiểm tra local”, sau đó “Cài model OmniVoice”. Synthesis không tự tải model.</p>}{selected?.status !== "ready" && selected && <p className="attempt-note">Profile này chưa ready vì quyền clone chưa đủ; lưu checkbox quyền sử dụng trước khi chạy.</p>}{report && <div className="omnivoice-result"><strong>{report.status === "succeeded" ? "Preview đã tạo — cần review" : "Preview thất bại"}</strong><span>{report.outputPath} · {(report.sizeBytes / 1024).toFixed(0)} KB · {report.language} · {report.device}</span><small>{report.message} · process exit={String(report.process.exitCode ?? "—")} · outputValidated={String(report.outputValidated)}{report.emotionCodesUsed?.length ? ` · emotion=${report.emotionCodesUsed.join(", ")}` : ""}</small>{audioUrl && <audio controls autoPlay src={audioUrl} />}</div>}</div>
      </div>
    </div>
    {synthesizeBlocker && <div id="omnivoice-synthesize-blocker" className="omnivoice-action-blocker" role="status"><strong>Chưa thể tạo preview</strong><span>{synthesizeBlocker}</span>{selected?.mode === "clone" && selected.status === "needs_consent" && <button type="button" className="secondary-button compact-button" onClick={focusCloneConsent} disabled={loading}>Đi tới xác nhận quyền</button>}</div>}
    {error && <div className="omnivoice-result error" role="alert"><strong>Preview thất bại — không có output mới</strong><span>{error}</span><small>Synthesis không được coi là thành công; output cũ được giữ nguyên để không mất bằng chứng.</small></div>}
  </section>;
}
