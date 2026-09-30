import { invoke } from "@tauri-apps/api/core";
import type { VieneuTtsReport, VoiceCue, VoiceSettings } from "./voiceTypes";
import { useEffect, useRef, useState } from "react";

export function VoiceStudioPanel({ report, loading, settings, onSettingsChange }: { report: VieneuTtsReport | null; loading: boolean; settings: VoiceSettings; onSettingsChange: (settings: VoiceSettings) => void }) {
  const [text, setText] = useState("Xin chào! Đây là bản thử giọng nói tự động cho đồ án Auto3Dvideo.");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Microphone recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const [recordedAudioNotice, setRecordedAudioNotice] = useState<string | null>(null);

  // Tự động load audio base64 khi report xuất hiện để người dùng nghe được ngay 1-chạm
  useEffect(() => {
    if (report && report.outputPath) {
      void (async () => {
        const isTauri = typeof window !== "undefined" && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
        if (!isTauri) return;
        try {
          const b64 = await invoke<string>("read_workspace_audio_base64", { relativePath: report.outputPath });
          setAudioUrl(`data:audio/wav;base64,${b64}`);
        } catch {
          // fallback
        }
      })();
    }
  }, [report]);

  function patchSettings(patch: Partial<VoiceSettings>) {
    onSettingsChange({ ...settings, ...patch });
  }

  // Thu âm trực tiếp từ microphone
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
        },
      });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 128000 });
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(recordedChunksRef.current, { type: "audio/wav" });
        const arrayBuffer = await audioBlob.arrayBuffer();
        const uint8Array = Array.from(new Uint8Array(arrayBuffer));
        const timestamp = Date.now();
        const relPath = `.auto3dvideo/voice-samples/my-voice-${timestamp}.wav`;

        const isTauri = typeof window !== "undefined" && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
        try {
          if (isTauri) {
            await invoke<string>("save_recorded_audio", {
              relativePath: relPath,
              dataBytes: uint8Array,
            });
          } else {
            // Lưu trực tiếp qua backend middleware của Vite khi mở bằng trình duyệt
            const base64Data = btoa(
              new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
            );
            await fetch("/api/save-audio", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ relPath, data: base64Data }),
            });
          }
          patchSettings({
            referenceAudioPath: relPath,
            cloneEnabled: true,
            cloneConsent: true,
          });
          setRecordedAudioNotice(`Đã lưu mẫu giọng (${(uint8Array.length / 1024).toFixed(0)} KB) và tự động kích hoạt Voice Clone!`);
        } catch (err) {
          setRecordedAudioNotice(`Lỗi lưu âm thanh: ${String(err)}`);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      timerRef.current = window.setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      alert("Không thể truy cập Microphone. Vui lòng cấp quyền micro trong cài đặt hệ thống Windows!");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }

  return (
    <section style={{ maxWidth: "800px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div className="panel" style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "20px" }}>
        <div>
          <h2 style={{ fontSize: "22px", margin: "0 0 6px 0", color: "#fff" }}>🎙️ Cài Đặt Giọng Đọc Video</h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "14px" }}>
            Chọn giọng đọc tiếng Việt hoặc thu âm 5 giây giọng của bạn để AI tự nhân bản (clone).
          </p>
        </div>

        {/* 1. Chọn chế độ giọng */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          {/* Card giọng có sẵn */}
          <div
            onClick={() => {
              patchSettings({ referenceAudioPath: "", cloneEnabled: false, cloneConsent: false });
              setRecordedAudioNotice(null);
            }}
            style={{
              cursor: "pointer",
              padding: "16px",
              borderRadius: "10px",
              border: !settings.referenceAudioPath ? "2px solid var(--cyan)" : "1px solid var(--border)",
              background: !settings.referenceAudioPath ? "rgba(143,232,218,0.06)" : "var(--panel-soft)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <input type="radio" checked={!settings.referenceAudioPath} readOnly />
              <strong style={{ fontSize: "15px" }}>Giọng mẫu có sẵn</strong>
            </div>
            <select
              value={settings.presetVoice}
              disabled={Boolean(settings.referenceAudioPath)}
              onChange={(e) => patchSettings({ presetVoice: e.target.value })}
              style={{ width: "100%", padding: "10px", borderRadius: "6px", background: "#161b22", color: "#fff", border: "1px solid var(--border)", fontSize: "14px" }}
            >
              <optgroup label="Giọng Nam">
                <option value="Phạm Tuyên">Phạm Tuyên — Nam · Giọng Bắc · Truyền cảm, tự nhiên</option>
                <option value="Minh Đức">Minh Đức — Nam · Giọng Bắc · Tin tức, thời sự</option>
                <option value="Thanh Bình">Thanh Bình — Nam · Giọng Bắc · Kể chuyện, sâu lắng</option>
                <option value="Thái Sơn">Thái Sơn — Nam · Giọng Nam · Kể chuyện, review phim</option>
                <option value="Xuân Vĩnh">Xuân Vĩnh — Nam · Giọng Nam · Tự nhiên, đời thường</option>
                <option value="Minh Triết">Minh Triết — Nam · Giọng Nam · Tin tức, thuyết trình</option>
                <option value="Adam">Adam — Nam · Giọng Nam · Trầm ấm</option>
                <option value="Quang Sơn">Quang Sơn — Nam · Giọng Trung · Chân thực, mộc mạc</option>
                <option value="Đức Trí">Đức Trí — Nam · Giọng Nam · Đọc truyện đêm khuya</option>
              </optgroup>
              <optgroup label="Giọng Nữ">
                <option value="Trúc Ly">Trúc Ly — Nữ · Giọng Bắc · Tự nhiên, nhẹ nhàng</option>
                <option value="Ngọc Linh">Ngọc Linh — Nữ · Giọng Bắc · Kể chuyện, truyền cảm</option>
                <option value="Đoan Trang">Đoan Trang — Nữ · Giọng Bắc · Trong trẻo</option>
                <option value="Mai Anh">Mai Anh — Nữ · Giọng Bắc · Thời sự, phát thanh</option>
                <option value="Thục Đoan">Thục Đoan — Nữ · Giọng Nam · Kể chuyện nhẹ nhàng</option>
                <option value="Thùy Dung">Thùy Dung — Nữ · Giọng Nam · Tin tức năng động</option>
                <option value="Ngọc Trân">Ngọc Trân — Nữ · Giọng Trung · Dịu dàng</option>
                <option value="Mỹ Duyên">Mỹ Duyên — Nữ · Giọng Nam · Đọc truyện tình cảm</option>
                <option value="Quỳnh Anh">Quỳnh Anh — Nữ · Giọng Bắc · Đọc truyện</option>
                <option value="Kim Thanh">Kim Thanh — Nữ · Giọng Nam · Đọc truyện, radio</option>
              </optgroup>
            </select>
          </div>

          {/* Card thu âm Clone giọng */}
          <div
            style={{
              padding: "16px",
              borderRadius: "10px",
              border: settings.referenceAudioPath ? "2px solid var(--cyan)" : "1px solid var(--border)",
              background: settings.referenceAudioPath ? "rgba(143,232,218,0.06)" : "var(--panel-soft)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <input type="radio" checked={Boolean(settings.referenceAudioPath)} readOnly />
                <strong style={{ fontSize: "15px" }}>Thu âm giọng bạn (Clone)</strong>
              </div>
              <p style={{ margin: "0 0 10px 0", fontSize: "12px", color: "var(--muted)" }}>
                Nói vào mic 5-10s, AI sẽ đọc theo đúng chất giọng của bạn.
              </p>
            </div>

            {!settings.referenceAudioPath ? (
              !isRecording ? (
                <button
                  type="button"
                  className="primary-button"
                  style={{ background: "#e11d48", borderColor: "#e11d48", padding: "10px", width: "100%" }}
                  onClick={() => void startRecording()}
                >
                  🔴 Bấm để Thu âm (5s-10s)
                </button>
              ) : (
                <button
                  type="button"
                  className="primary-button"
                  style={{ background: "#f59e0b", borderColor: "#f59e0b", padding: "10px", width: "100%", animation: "pulse 1.5s infinite" }}
                  onClick={stopRecording}
                >
                  ⏹️ Dừng thu ({recordingDuration}s)
                </button>
              )
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(239,68,68,0.1)", padding: "8px 12px", borderRadius: "6px", border: "1px solid rgba(239,68,68,0.3)" }}>
                <span style={{ fontSize: "13px", color: "var(--cyan)", fontWeight: 500 }}>✓ Đã có giọng thu</span>
                <button
                  type="button"
                  onClick={() => {
                    patchSettings({ referenceAudioPath: "", cloneEnabled: false, cloneConsent: false });
                    setRecordedAudioNotice(null);
                    setAudioUrl(null);
                  }}
                  style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: "4px", padding: "4px 10px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
                >
                  🗑️ Xóa thu lại
                </button>
              </div>
            )}
          </div>
        </div>

        {recordedAudioNotice && (
          <div style={{ padding: "10px 14px", background: "rgba(143,232,218,0.1)", borderRadius: "6px", color: "var(--cyan)", fontSize: "13px" }}>
            ✓ {recordedAudioNotice}
          </div>
        )}

        {/* 2. Tinh chỉnh Cảm xúc & Biểu cảm */}
        <div style={{ background: "var(--panel-soft)", padding: "16px 20px", borderRadius: "10px", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600, fontSize: "14px" }}>🎭 Cảm xúc & Mức độ diễn cảm (Temperature):</span>
            <span style={{ color: "var(--cyan)", fontWeight: 700, fontSize: "14px" }}>{settings.temperature.toFixed(2)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "12px", color: "var(--muted)" }}>Nghiêm túc, chuẩn chỉ (0.6)</span>
            <input
              type="range"
              min="0.6"
              max="1.2"
              step="0.05"
              value={settings.temperature}
              onChange={(e) => patchSettings({ temperature: parseFloat(e.target.value) })}
              style={{ flex: 1, cursor: "pointer", accentColor: "var(--cyan)" }}
            />
            <span style={{ fontSize: "12px", color: "var(--muted)" }}>Tự nhiên, giàu cảm xúc (1.2)</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginTop: "4px" }}>
            {[
              { id: "none", label: "Tiêu chuẩn", icon: "🎙️", desc: "Đọc tự nhiên" },
              { id: "laugh", label: "Hào hứng / Cười", icon: "😄", desc: "Vui vẻ, năng động" },
              { id: "sigh", label: "Trầm lắng / Thở dài", icon: "😌", desc: "Sâu lắng, cảm xúc" },
              { id: "clear_throat", label: "Trịnh trọng", icon: "🧐", desc: "Hắng giọng mở đầu" },
            ].map((cue) => {
              const active = (settings.voiceCueBySegment?.["default"] || "none") === cue.id;
              return (
                <button
                  key={cue.id}
                  type="button"
                  onClick={() =>
                    patchSettings({
                      voiceCueBySegment: { ...(settings.voiceCueBySegment || {}), default: cue.id as VoiceCue },
                    })
                  }
                  style={{
                    padding: "10px 8px",
                    borderRadius: "8px",
                    border: active ? "2px solid var(--cyan)" : "1px solid var(--border)",
                    background: active ? "rgba(143,232,218,0.12)" : "rgba(0,0,0,0.2)",
                    color: active ? "#fff" : "var(--muted)",
                    cursor: "pointer",
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <span style={{ fontSize: "18px" }}>{cue.icon}</span>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: active ? "var(--cyan)" : "#fff" }}>{cue.label}</span>
                  <span style={{ fontSize: "11px", opacity: 0.8 }}>{cue.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Nghe thử ngay */}
        <div style={{ background: "rgba(0,0,0,0.25)", padding: "18px", borderRadius: "10px", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "12px" }}>
          <label style={{ fontWeight: 600, fontSize: "14px" }}>Câu văn nghe thử:</label>
          <div style={{ display: "flex", gap: "10px" }}>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Nhập câu bạn muốn nghe thử..."
              style={{ flex: 1, padding: "10px 14px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--panel-soft)", color: "var(--text)", fontSize: "14px" }}
            />
            <button
              className="primary-button"
              style={{ minWidth: "150px", fontSize: "14px" }}
              disabled={loading || isGenerating || !text.trim()}
              onClick={async () => {
                setIsGenerating(true);
                setAudioUrl(null);
                try {
                  const res = await fetch("/api/tts", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      text,
                      voice: settings.presetVoice,
                      referenceAudioPath: settings.referenceAudioPath,
                      temperature: settings.temperature,
                      voiceCue: settings.voiceCueBySegment?.["default"] || "none",
                    }),
                  });
                  const data = await res.json();
                  if (data.success && data.audioUrl) {
                    setAudioUrl(data.audioUrl);
                  } else {
                    alert("Lỗi tạo giọng: " + (data.error || "Không xác định"));
                  }
                } catch (err) {
                  alert("Không thể kết nối API TTS: " + String(err));
                } finally {
                  setIsGenerating(false);
                }
              }}
            >
              {isGenerating ? "Đang xử lý…" : "🔊 Nghe thử"}
            </button>
          </div>

          {audioUrl && (
            <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "12px" }}>
              <span style={{ fontSize: "13px", color: "var(--cyan)", fontWeight: 600 }}>Audio:</span>
              <audio controls autoPlay src={audioUrl} style={{ flex: 1, height: "36px" }} />
            </div>
          )}
        </div>

        {/* Thông báo trạng thái áp dụng */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "var(--muted)", fontSize: "13px", borderTop: "1px solid var(--border)", paddingTop: "14px" }}>
          <span>
            Đang áp dụng: <strong style={{ color: "#fff" }}>{settings.referenceAudioPath ? "Giọng bạn (Clone)" : settings.presetVoice}</strong>
          </span>
          <span style={{ color: "var(--cyan)" }}>✓ Tự động lưu cho toàn bộ video</span>
        </div>
      </div>
    </section>
  );
}
