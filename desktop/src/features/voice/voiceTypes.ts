import type { ProcessRunSummary } from "../../processTypes";

export type VoiceCue = "none" | "laugh" | "sigh" | "clear_throat";

export type VoiceEmotion =
  | "neutral" | "calm" | "warm" | "friendly" | "happy" | "excited" | "joyful" | "triumphant"
  | "sad" | "melancholic" | "tender" | "concerned" | "fearful" | "angry" | "shouting"
  | "urgent" | "serious" | "surprised" | "mysterious" | "curious" | "sarcastic" | "whisper";

export const VOICE_EMOTION_OPTIONS: Array<{ code: VoiceEmotion; label: string; hint: string }> = [
  { code: "neutral", label: "Bình thường", hint: "đều, rõ" },
  { code: "calm", label: "Điềm tĩnh", hint: "chậm, ổn định" },
  { code: "warm", label: "Ấm áp", hint: "gần gũi" },
  { code: "friendly", label: "Thân thiện", hint: "tự nhiên" },
  { code: "happy", label: "Vui vẻ", hint: "sáng, vui" },
  { code: "excited", label: "Hào hứng", hint: "năng lượng cao" },
  { code: "joyful", label: "Phấn khởi", hint: "rộn ràng" },
  { code: "triumphant", label: "Chiến thắng", hint: "đầy khí thế" },
  { code: "sad", label: "Buồn", hint: "hạ giọng" },
  { code: "melancholic", label: "U sầu", hint: "trầm, kéo dài" },
  { code: "tender", label: "Dịu dàng", hint: "mềm, nhẹ" },
  { code: "concerned", label: "Lo lắng", hint: "căng nhẹ" },
  { code: "fearful", label: "Sợ hãi", hint: "run, dè chừng" },
  { code: "angry", label: "Giận dữ", hint: "mạnh, gắt" },
  { code: "shouting", label: "La lớn", hint: "nhấn mạnh" },
  { code: "urgent", label: "Khẩn cấp", hint: "dồn dập" },
  { code: "serious", label: "Nghiêm trọng", hint: "trang trọng" },
  { code: "surprised", label: "Bất ngờ", hint: "bật lên" },
  { code: "mysterious", label: "Bí ẩn", hint: "gợi tò mò" },
  { code: "curious", label: "Tò mò", hint: "hỏi, khám phá" },
  { code: "sarcastic", label: "Mỉa nhẹ", hint: "có sắc thái" },
  { code: "whisper", label: "Thì thầm", hint: "rất nhỏ" },
];

export type VoiceSettings = {
  presetVoice: string;
  temperature: number;
  voiceCueBySegment: Record<string, VoiceCue>;
  emotionCodeBySegment?: Record<string, VoiceEmotion>;
  cloneEnabled: boolean;
  cloneConsent: boolean;
  referenceAudioPath?: string;
  voiceProfileId?: string;
  mode?: "clone" | "design";
  language?: string;
  instruct?: string;
  speed?: number;
  qualityPreset?: "preview" | "balanced" | "quality";
};

export type VieneuReadinessReport = {
  status: string;
  packageInstalled: boolean;
  packageVersion: string | null;
  modelId: string;
  backend: string;
  modelCachePath: string;
  modelCachePresent: boolean;
  modelDownloadRequested: boolean;
  networkCallsMade: boolean;
  processStarted: boolean;
  message: string;
};

export type VieneuTtsReport = {
  outputPath: string;
  sizeBytes: number;
  modelId: string;
  voice: string;
  backend: string;
  precision: string;
  temperature: number;
  referenceAudioUsed: boolean;
  cloneConsent: boolean;
  modelDownloadRequested: boolean;
  networkCallsMade: boolean;
  humanReviewRequired: boolean;
  outputValidated: boolean;
  message: string;
  process: ProcessRunSummary;
};

export type OmniVoiceReadinessReport = {
  status: string;
  packageInstalled: boolean;
  torchInstalled: boolean;
  modelId: string;
  audioTokenizerId: string;
  modelCachePath: string;
  modelCachePresent: boolean;
  device: string;
  modelDownloadRequested: boolean;
  networkCallsMade: boolean;
  processStarted: boolean;
  message: string;
  process: ProcessRunSummary;
};

export type VoiceProfile = {
  voiceProfileId: string;
  projectId: string;
  name: string;
  mode: "clone" | "design";
  modelId: string;
  language: string;
  instruct: string | null;
  referenceAudioPath: string | null;
  referenceAudioSha256: string | null;
  referenceAudioDurationSeconds: number | null;
  referenceAudioSampleRate: number | null;
  referenceTranscript: string | null;
  rightsStatus: string;
  commercialUse: string;
  cloneConsent: boolean;
  status: string;
  lastPreviewPath: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VoiceSample = {
  relativePath: string;
  fileName: string;
  sourceKind: "sample" | "recording";
  sizeBytes: number;
  durationSeconds: number | null;
  sampleRate: number | null;
  modifiedUnixSeconds: number;
  transcript: string | null;
  license: string | null;
  sourceDataset: string | null;
};

export type OmniVoiceTtsReport = {
  status: string;
  outputPath: string;
  sizeBytes: number;
  modelId: string;
  voiceProfileId: string;
  mode: "clone" | "design";
  language: string;
  durationSeconds: number | null;
  sampleRate: number | null;
  device: string;
  modelDownloadRequested: boolean;
  networkCallsMade: boolean;
  humanReviewRequired: boolean;
  outputValidated: boolean;
  emotionCodesUsed?: string[];
  emotionSegments?: number;
  emotionFallback?: string;
  message: string;
  process: ProcessRunSummary;
};

export const fallbackVieneuReadiness: VieneuReadinessReport = {
  status: "not_checked",
  packageInstalled: false,
  packageVersion: null,
  modelId: "pnnbao-ump/VieNeu-TTS-v3-Turbo",
  backend: "onnx",
  modelCachePath: ".auto3dvideo/cache/huggingface",
  modelCachePresent: false,
  modelDownloadRequested: false,
  networkCallsMade: false,
  processStarted: false,
  message: "Chưa kiểm tra package VieNeu.",
};

export const fallbackOmniVoiceReadiness: OmniVoiceReadinessReport = {
  status: "not_checked",
  packageInstalled: false,
  torchInstalled: false,
  modelId: "k2-fsa/OmniVoice",
  audioTokenizerId: "eustlb/higgs-audio-v2-tokenizer",
  modelCachePath: "D:/Auto3DvideoTools/omnivoice/cache",
  modelCachePresent: false,
  device: "unknown",
  modelDownloadRequested: false,
  networkCallsMade: false,
  processStarted: false,
  message: "Chưa kiểm tra OmniVoice local.",
  process: {
    executableId: "python",
    exitCode: null,
    succeeded: false,
    timedOut: false,
    cancelled: false,
    terminationMode: "not_started",
    stdoutBytes: 0,
    stderrBytes: 0,
    externalSideEffectUnknown: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    outputEvidence: [],
  },
};
