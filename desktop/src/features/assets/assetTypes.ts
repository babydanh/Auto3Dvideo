export type AssetView = {
  schemaVersion: string;
  assetId: string;
  projectId: string;
  title: string;
  relativePath: string;
  sha256: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  status: "ready" | "quarantined" | "missing" | "archived";
  rightsStatus: "unknown" | "pending" | "personal" | "owned" | "licensed" | "public_domain" | "restricted" | "rejected";
  sourceUri: string | null;
  tags: string[];
  note: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type AssetMetadataDraft = {
  title: string;
  sourceUri: string;
  tags: string;
  note: string;
  rightsStatus: AssetView["rightsStatus"];
};

export type ReferenceAssignment = {
  assignmentId: string;
  projectId: string;
  referenceSetId: string;
  assetId: string;
  role: "identity" | "composition" | "pose" | "camera" | "style" | "start_frame" | "end_frame" | "negative";
  strength: number;
  priority: number;
  shotId: string | null;
  shotRangeStart: number | null;
  shotRangeEnd: number | null;
  crop: string | null;
  notes: string;
  approved: boolean;
  assetSha256: string;
  createdAt: string;
  updatedAt: string;
};

export type ReferenceSet = {
  schemaVersion: string;
  referenceSetId: string;
  projectId: string;
  name: string;
  scope: "sequence" | "character" | "object" | "world" | "shot";
  status: "active" | "archived";
  continuityNote: string;
  assignments: ReferenceAssignment[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};
export type AssetPackAcceptanceCheck = {
  checkId: string;
  description?: string;
  required?: boolean;
  status: "pending" | "pass" | "fail" | "not_applicable";
  evidence?: string | null;
};

export type AssetPackReviewItem = {
  assetItemId: string;
  title: string;
  identityAnchorId: string | null;
  role: string;
  status: string;
  reviewState: "not_started" | "in_review" | "approved" | "rejected" | "needs_revision";
  rightsStatus: AssetView["rightsStatus"];
  prompt: string;
  negativePrompt: string;
  shotIds: string[];
  requiredViews: string[];
  scaleMeters: number | null;
  outputAssetIds: string[];
  outputPaths: string[];
  outputAssets: AssetView[];
  acceptanceChecks: AssetPackAcceptanceCheck[];
  generationAttempts: Array<Record<string, unknown>>;
  note: string;
};

export type AssetPackReview = {
  schemaVersion: string;
  projectId: string;
  packId: string;
  title: string;
  status: string;
  source: { packRelativePath: string; itemsRelativePath: string; reportRelativePath: string | null };
  acceptancePolicy: Record<string, unknown>;
  items: AssetPackReviewItem[];
  report: { relativePath: string; status: string; runId: string; itemCounts: Record<string, number>; errors: Array<Record<string, unknown>> } | null;
  createdAt: string;
  updatedAt: string;
};

export type AssetPackBlenderBindingReport = {
  schemaVersion: string;
  bindingId: string;
  projectId: string;
  packId: string;
  status: "ready_for_blender_review" | "blocked" | "needs_review";
  bindingPath: string | null;
  jobPath: string | null;
  assetCount: number;
  shotIds: string[];
  worldScaleMeters: number | null;
  approvedReferenceHashes: string[];
  blockers: string[];
  blenderExecutionStarted: boolean;
  humanReviewRequired: boolean;
  message: string;
};

export type AssetPackBlenderBindingRunReport = {
  bindingId: string;
  status: string;
  scenePath: string;
  previewOutputs: string[];
  reportPath: string;
  process: { exitCode: number | null; succeeded: boolean; timedOut: boolean; stderr: string; stdout: string };
  message: string;
};

export type AssetPreviewView = {
  relativePath: string;
  mimeType: string;
  base64Data: string;
};
