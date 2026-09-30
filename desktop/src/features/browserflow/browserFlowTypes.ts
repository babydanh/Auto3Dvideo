import type { AssetView } from "../assets/assetTypes";
import type { ProcessRunSummary } from "../../processTypes";

export type BrowserFlowVisualEvaluationReport = {
  status: string;
  shotId: string;
  revisionId: string;
  model: string;
  decision: "pass" | "revise" | "needs_review";
  overallScore: number | null;
  confidence: number | null;
  criteria: Record<string, number>;
  flags: string[];
  revisionInstruction: string;
  summary: string;
  imagePath: string;
  imageSha256: string;
  reportPath: string;
  networkCallsMade: boolean;
  costStatus: string;
  humanReviewRequired: boolean;
  message: string;
};

export type GoogleFlowDomOutputReport = {
  status: string;
  projectUrl: string;
  targetUrl: string | null;
  reportPath: string;
  mediaCount: number;
  mediaIds: string[];
  historicalShotMediaIds: string[];
  historicalShotMediaCount: number;
  matchingBatchCount: number;
  matchingBatchMediaCount: number;
  matchingBatchMediaIds: string[];
  matchingPromptMediaCount?: number;
  matchingPromptMediaIds?: string[];
  matchingBatchVideoMediaCount?: number;
  matchingBatchVideoMediaIds?: string[];
  matchingPromptVideoMediaCount?: number;
  matchingPromptVideoMediaIds?: string[];
  shotRevisionBatchCount: number;
  shotRevisionBatchMediaCount: number;
  shotRevisionBatchMediaIds: string[];
  assistantClaimsGenerated: boolean;
  generatedMessageCount: number;
  generationActive: boolean;
  downloadControlFound: boolean;
  downloadClicked: boolean;
  selectedModel: string;
  modelSelected: boolean;
  saved: boolean;
  outputCount: string;
  projectKey: string;
  composerFingerprint: string;
  composerFound: boolean;
  promptEditorFound: boolean;
  generateButtonFound?: boolean;
  generateButtonEnabled?: boolean;
  imageModeFound: boolean;
  videoModeFound?: boolean;
  videoComposerReady?: boolean;
  visibleCreditTexts: string[];
  selectedSettingsEvidence: string[];
  message: string;
  process: ProcessRunSummary;
};

export type BrowserMcpRuntimeReport = {
  status: string;
  operation: string;
  reportPath: string;
  serverInfo: { name?: string; version?: string } | null;
  protocolVersion: string | null;
  toolCount: number;
  tools: string[];
  toolName: string | null;
  approved: boolean;
  browserSessionAttached: boolean;
  browserActionsPerformed: boolean;
  networkCallsMade: boolean;
  operationResult: { isError?: boolean; contentItemCount?: number; contentTypes?: string[]; textBytes?: number; hasImage?: boolean; uiRefCount?: number; uiRefs?: BrowserFlowUiRef[]; screenshotPath?: string; screenshotMimeType?: string; screenshotBytes?: number; screenshotSource?: string };
  message: string;
  process: ProcessRunSummary | null;
};

export type BrowserMcpFreshState = {
  status: "unknown" | "attached" | "session-found" | "not-connected";
  uiRefCount: number;
  checkedAt: number;
};

type BrowserFlowAsset = {
  assetId: string;
  name: string;
  relativePath: string;
  mediaKind: string;
  role: string;
  processId: string;
};

type BrowserFlowFileBinding = {
  fileId: string;
  name: string;
  relativePath: string;
  kind: string;
  processId: string;
};

export type BrowserFlowDownloadedFile = {
  downloadId: string;
  name: string;
  sourceRelativePath: string;
  relativePath: string;
  mediaKind: string;
  sha256: string;
  sizeBytes: number;
  importedAt: string;
  processId: string;
  runId?: string | null;
  shotId?: string | null;
  revisionId?: string | null;
  inputHash?: string | null;
};

export type BrowserFlowDownloadImportReport = {
  status: string;
  workflow: BrowserFlowWorkflow;
  importedPath: string;
  sourceRelativePath: string;
  sha256: string;
  sizeBytes: number;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
  asset?: AssetView | null;
  message: string;
};

export type BrowserFlowDownloadEntry = {
  name: string;
  relativePath: string;
  mediaKind: string;
  sizeBytes: number;
  modifiedAt: string;
};

type BrowserFlowRouteStep = {
  stepId: string;
  name: string;
  operation: string;
  capability: string;
  state: string;
  requiresUser: boolean;
  toolName: string | null;
  note: string;
};

type BrowserFlowProcess = {
  processId: string;
  name: string;
  operation: string;
  state: string;
  stepIndex: number;
  startedAt: string;
  updatedAt: string;
  output: string | null;
  message: string;
  nextAction: string | null;
};

type BrowserFlowRoadmapItem = {
  milestoneId: string;
  name: string;
  status: string;
  dependsOn: string[];
  processId: string | null;
  evidence: string | null;
  nextAction: string;
};

export type BrowserFlowUiRef = {
  role: string;
  label: string;
  reference: string;
};

export type BrowserFlowProviderIdentity = {
  providerProjectKey: string;
  providerProjectLabel: string;
  currentUrl: string;
  evidenceHash: string;
  observedAt: string;
};

type BrowserFlowTargetBinding = {
  providerProjectKey: string;
  providerProjectLabel: string;
  pinnedUrl: string;
  evidenceHash: string;
  pinnedAt: string;
};

export type BrowserFlowWorkflow = {
  schemaVersion: string;
  workflowId: string;
  projectId: string;
  name: string;
  provider: string;
  targetUrl: string;
  phase: string;
  discoveryStatus: string;
  discoveryPath: string | null;
  handoffId: string | null;
  sessionId: string | null;
  providerProjectIdentity?: BrowserFlowProviderIdentity | null;
  currentUrl?: string | null;
  projectEntryConfirmed?: boolean;
  pinnedBrowserTarget?: BrowserFlowTargetBinding | null;
  currentStep: number;
  route: BrowserFlowRouteStep[];
  roadmap: BrowserFlowRoadmapItem[];
  availableTools?: string[];
  uiRefs: BrowserFlowUiRef[];
  visualStatePath?: string | null;
  assets: BrowserFlowAsset[];
  files?: BrowserFlowFileBinding[];
  downloadedFiles?: BrowserFlowDownloadedFile[];
  processes: BrowserFlowProcess[];
  uiRefCount: number;
  browserSessionAttached: boolean;
  networkCallsMade: boolean;
  humanReviewRequired: boolean;
  lastMessage: string;
  updatedAt: string;
};

export type BrowserFlowWorkflowReport = {
  status: string;
  workflow: BrowserFlowWorkflow;
  message: string;
};

export type BrowserFlowAgentStepReport = {
  status: string;
  workflow: BrowserFlowWorkflow;
  model: string;
  action: { action?: string; ref?: string | null; textSource?: string; reason?: string; submit?: boolean; seconds?: number | null } | null;
  plannerReportPath: string | null;
  message: string;
};

export type BrowserHandoffReport = {
  status: string;
  handoffId: string;
  projectId: string;
  handoffPath: string;
  promptPath: string;
  inputAssets: { relativePath: string; mediaKind: string; sha256?: string; sizeBytes?: number }[];
  state: string;
  networkCallsMade: boolean;
  browserSessionAttached: boolean;
  uploadPerformed: boolean;
  generatePerformed: boolean;
  importPerformed: boolean;
  costStatus: string;
  humanReviewRequired: boolean;
  message: string;
  process: ProcessRunSummary;
};

export type GoogleFlowVideoActionExecution = {
  status: string;
  message: string;
  promptAccepted: boolean;
  generateClicked: boolean;
  // The worker's fresh chip read, taken immediately before this action. It is
  // true for a bound shot whose confirmed chip was still there, false when it
  // drifted, and null for a legacy shot with no binding and nothing to re-check.
  referenceVerified: boolean | null;
  reportPath: string;
};

export type BrowserFlowCapabilityCacheEntry = {
  mode: "video";
  providerProjectKey: string;
  currentUrl: string;
  observedAt: string;
  message: string;
};
