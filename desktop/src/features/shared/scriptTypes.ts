import type { VoiceCue, VoiceEmotion, VoiceSettings } from "../voice/voiceTypes";

type LocalScriptBeat = {
  beatId: string;
  timeFraction: number;
  purpose: string;
  action: string;
  cameraPrompt: string;
  imageRole: "establish" | "action" | "reveal" | "resolve";
  prompt: string;
};

export type LocalScriptSegment = {
  segmentId: string;
  narration: string;
  onScreenText: string;
  durationSeconds: number;
  claimStatus: "needs_review" | "verified" | "user_provided" | "not_applicable";
  sourceNote?: string | null;
  voiceCue?: VoiceCue;
  emotionCode?: VoiceEmotion;
  visualPrompt?: string;
  subject?: string;
  action?: string;
  cameraIntent?: string;
  lightingIntent?: string;
  continuityNotes?: string;
  negativePrompt?: string;
  sceneMode?: string;
  flowDirectives?: string[];
  beats?: LocalScriptBeat[];
  teachingScene?: CodingTeachingScene;
  revisionId?: string;
  revisionPrompt?: string;
  revisionImagePath?: string | null;
  dirty?: boolean;
};

export type LocalVisualMode = "space-25d" | "licensed-footage-space" | "cinematic-3d" | "coding-25d";

export type CodingAudioMode = "narrated" | "caption-only";

export type CodingTrack = "algorithm" | "system-design";

export type CodingPlanner = "local-catalog" | "configured-gateway";

export type CodingLesson = {
  schemaVersion: string;
  track: CodingTrack;
  topicKey: string;
  learningObjectives: string[];
  assumptions: string[];
  complexity: string;
  checks: string[];
  sources: string[];
  planner: CodingPlanner;
  promptVersion: string;
};

export type CodingSceneKind = "array" | "architecture" | "code" | "summary";

export type CodingSceneNode = {
  id: string;
  label: string;
  column: number;
  row: number;
};

export type CodingSceneEdge = {
  from: string;
  to: string;
  label: string;
};

/** A snapshot value is a bounded integer or one printable character. */
export type CodingSceneValue = number | string;

export type CodingSceneVariable = {
  name: string;
  value: string;
};

export type CodingSceneState = {
  label: string;
  values: CodingSceneValue[];
  activeIndices: number[];
  variables: CodingSceneVariable[];
  activeLine: number | null;
  activeNodes: string[];
  activeEdges: number[];
};

export type CodingTeachingScene = {
  kind: CodingSceneKind;
  code: string[];
  nodes: CodingSceneNode[];
  edges: CodingSceneEdge[];
  states: CodingSceneState[];
  note?: string;
};

export type LocalScriptDocument = {
  schemaVersion: string;
  scriptId: string;
  briefId: string;
  language: string;
  title: string;
  hook: string;
  segments: LocalScriptSegment[];
  totalDurationSeconds: number;
  promptVersion?: string;
  sceneMode?: string;
  referenceAssetPaths?: string[];
  geminiAssetPaths?: string[];
  comfyuiAssetPaths?: string[];
  approvalStatus: "pending" | "approved" | "rejected";
  visualMode?: LocalVisualMode;
  audioMode?: CodingAudioMode;
  codingLesson?: CodingLesson;
  footageManifestPath?: string;
  voiceSettings?: VoiceSettings;
  generatedAt?: string;
  requestedShotCount?: number;
  requestedDurationSeconds?: number;
  sourcePromptHash?: string;
  flowProjectId?: string;
};

export type SavedGoogleFlowProject = {
  projectId: string;
  name: string;
};

export type GoogleFlowProjectSettings = {
  selectedProjectId: string;
  projects: SavedGoogleFlowProject[];
};

function isSavedGoogleFlowProject(value: unknown): value is SavedGoogleFlowProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const project = value as Partial<SavedGoogleFlowProject>;
  return typeof project.projectId === "string" && project.projectId.length >= 8 && project.projectId.length <= 128
    && typeof project.name === "string" && project.name.trim().length > 0 && project.name.length <= 120;
}

export function parseGoogleFlowProjectSettings(raw: string | null): GoogleFlowProjectSettings {
  if (!raw) return { selectedProjectId: "", projects: [] };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { selectedProjectId: "", projects: [] };
    const settings = value as Partial<GoogleFlowProjectSettings>;
    const projects = Array.isArray(settings.projects) ? settings.projects.filter(isSavedGoogleFlowProject) : [];
    const selectedProjectId = typeof settings.selectedProjectId === "string"
      && projects.some((project) => project.projectId === settings.selectedProjectId)
      ? settings.selectedProjectId
      : "";
    return { selectedProjectId, projects };
  } catch {
    return { selectedProjectId: "", projects: [] };
  }
}

export type LocalScriptReviewReport = {
  status: string;
  runId: string;
  scriptPath: string;
  script: LocalScriptDocument;
  networkCallsMade: boolean;
  costStatus: string;
  humanReviewRequired: boolean;
  message: string;
};
