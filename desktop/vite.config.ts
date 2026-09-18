import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    {
      name: "vieneu-real-tts-api",
      configureServer(server) {
        server.middlewares.use("/api/save-audio", async (req, res) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
          }
          const chunks: Buffer[] = [];
          req.on("data", (c) => chunks.push(c));
          req.on("end", async () => {
            try {
              const buffer = Buffer.concat(chunks);
              const { data, relPath } = JSON.parse(buffer.toString("utf-8"));
              const fs = await import("fs");
              const path = await import("path");
              const { spawnSync } = await import("child_process");

              const targetPath = path.resolve(__dirname, "..", relPath);
              fs.mkdirSync(path.dirname(targetPath), { recursive: true });

              const tempRaw = targetPath + ".raw";
              fs.writeFileSync(tempRaw, Buffer.from(data, "base64"));

              // Chuyển đổi định dạng thu âm từ WebM sang PCM WAV 24000Hz mono chuẩn bằng ffmpeg,
              // kết hợp lọc tạp âm tần số thấp (<80Hz), tần số chói (>10kHz), và chuẩn hóa âm lượng (loudnorm)
              const conv = spawnSync("ffmpeg", [
                "-y",
                "-i", tempRaw,
                "-af", "highpass=f=80,lowpass=f=10000,loudnorm=I=-16:TP=-1.5:LRA=11",
                "-ar", "24000",
                "-ac", "1",
                targetPath,
              ]);
              try { fs.unlinkSync(tempRaw); } catch {}

              if (conv.status !== 0 && !fs.existsSync(targetPath)) {
                // Fallback nếu ffmpeg gặp trục trặc thì giữ nguyên file
                fs.writeFileSync(targetPath, Buffer.from(data, "base64"));
              }

              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: true, path: relPath }));
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(e) }));
            }
          });
        });

        server.middlewares.use("/api/stream-file", async (req, res) => {
          try {
            const urlObj = new URL(req.url || "", "http://localhost");
            const relPath = urlObj.searchParams.get("path");
            if (!relPath) {
              res.statusCode = 400;
              res.end("Missing path");
              return;
            }
            const fs = await import("fs");
            const path = await import("path");
            const requestedRoot = urlObj.searchParams.get("workspaceRoot")?.trim() || "";
            const workspaceRoot = requestedRoot && path.isAbsolute(requestedRoot)
              ? path.resolve(requestedRoot)
              : path.resolve(__dirname, "..");
            const filePath = path.resolve(workspaceRoot, relPath.replaceAll("\\", "/"));
            const relativeToRoot = path.relative(workspaceRoot, filePath);
            if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
              res.statusCode = 403;
              res.end("Path outside workspace");
              return;
            }
            if (!fs.existsSync(filePath)) {
              res.statusCode = 404;
              res.end("File Not Found");
              return;
            }
            const ext = path.extname(filePath).toLowerCase();
            const contentType = ext === ".mp4" ? "video/mp4" : ext === ".wav" ? "audio/wav" : ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "application/octet-stream";
            res.setHeader("Content-Type", contentType);
            fs.createReadStream(filePath).pipe(res);
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });

        server.middlewares.use("/api/tts", async (req, res) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
          }

          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
          });

          req.on("end", async () => {
            try {
              const { text, voice, referenceAudioPath, temperature, voiceCue } = JSON.parse(body || "{}");
              const { spawn } = await import("child_process");
              const fs = await import("fs");
              const path = await import("path");

              const timestamp = Date.now();
              const outWav = path.resolve(__dirname, `public/audio-${timestamp}.wav`);
              const pythonExe = `D:\\Auto3DvideoTools\\vieneu\\.venv\\Scripts\\python.exe`;

              // Thêm tiền tố biểu cảm nếu có
              let speechText = text || "Xin chào";
              if (voiceCue === "laugh") speechText = "[cười] " + speechText;
              else if (voiceCue === "sigh") speechText = "[thở dài] " + speechText;
              else if (voiceCue === "clear_throat") speechText = "[hắng giọng] " + speechText;

              const pyScript = `
import os
import sys
os.environ['AUTO3DVIDEO_VIENEUTTS_CACHE'] = r'D:\\Auto3DvideoTools\\vieneu\\cache'
from vieneu import Vieneu
tts = Vieneu()
ref = sys.argv[3].strip() if len(sys.argv) > 3 else ""
kwargs = {
    'temperature': min(float(sys.argv[5]) if len(sys.argv) > 5 else 0.8, 0.85),
    'top_k': 30,
    'top_p': 0.9,
    'repetition_penalty': 1.25,
}
if ref and os.path.exists(ref):
    kwargs['ref_audio'] = ref
    kwargs['denoise'] = True
    kwargs['use_ref_codes'] = True
else:
    kwargs['voice'] = sys.argv[2]
audio = tts.infer(sys.argv[1], **kwargs)
tts.save(audio, sys.argv[4])
`;

              let refArg = "";
              if (referenceAudioPath) {
                const candidate = path.resolve(__dirname, "..", referenceAudioPath);
                if (fs.existsSync(candidate)) {
                  refArg = candidate;
                }
              }

              const tempVal = String(temperature || 0.8);
              const child = spawn(pythonExe, ["-c", pyScript, speechText, voice || "Phạm Tuyên", refArg, outWav, tempVal]);

              let stderr = "";
              child.stderr.on("data", (d) => { stderr += d.toString(); });

              child.on("close", (code) => {
                if (code === 0 && fs.existsSync(outWav)) {
                  res.setHeader("Content-Type", "application/json");
                  res.end(JSON.stringify({ success: true, audioUrl: `/audio-${timestamp}.wav` }));
                } else {
                  // Bỏ qua cảnh báo warning HF Token nếu có
                  const cleanErr = stderr.split("\\n").filter(l => !l.includes("Warning: You are sending unauthenticated")).join("\\n").trim();
                  res.statusCode = 500;
                  res.end(JSON.stringify({ success: false, error: cleanErr || "Python TTS generation failed" }));
                }
              });
            } catch (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ success: false, error: String(err) }));
            }
          });
        });
      },
    },
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
