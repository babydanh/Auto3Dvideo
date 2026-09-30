import type { ProcessRunSummary } from "../../processTypes";

export type SubtitleEntry = {
  entryId: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  confidence?: number;
  sourceSegmentId?: string;
};

export type SubtitleDocument = {
  schemaVersion: string;
  documentId: string;
  sourceVideoPath: string;
  sourceSubtitlePath?: string;
  sourceLanguage: string;
  targetLanguage: string;
  durationSeconds: number;
  format: "srt" | "vtt";
  entries: SubtitleEntry[];
  rightsStatus: "pending" | "user_owned" | "licensed" | "public_domain" | "blocked";
  reviewState: "draft" | "validated" | "needs_review" | "approved" | "blocked";
  networkCallsMade: boolean;
  costStatus?: string;
  notes?: string;
  validation?: { valid: boolean; warnings: string[]; maxCps: number };
};

export type SubtitleDocumentReport = {
  status: string;
  document: SubtitleDocument | null;
  outputPath: string | null;
  outputSizeBytes: number | null;
  outputSha256: string | null;
  format: "srt" | "vtt" | null;
  networkCallsMade: boolean;
  costStatus: string;
  humanReviewRequired: boolean;
  message: string;
  process: ProcessRunSummary | null;
};

export type SubtitleVideoProbeReport = {
  status: string;
  videoPath: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioPresent: boolean;
  networkCallsMade: boolean;
  costStatus: string;
  message: string;
  process: ProcessRunSummary;
};

export type SubtitleBurnInReport = {
  status: string;
  videoPath: string;
  subtitlePath: string;
  outputPath: string;
  outputSizeBytes: number;
  outputSha256: string;
  durationSeconds: number | null;
  networkCallsMade: boolean;
  costStatus: string;
  humanReviewRequired: boolean;
  message: string;
  ffmpeg: ProcessRunSummary;
  ffprobe: ProcessRunSummary;
};
