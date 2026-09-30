type NarrativeEntityPreview = {
  entityId: string;
  name: string;
  continuityMode: string;
  identityAnchors: string[];
};

type NarrativeVisualBeatPreview = {
  beatId: string;
  sequence: number;
  narrationText: string;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  narrativeClaim: string;
  visualIntent: string;
  setting: string;
  entities: NarrativeEntityPreview[];
  requiredVisualElements: string[];
  positivePrompt: string;
  negativePrompt: string;
  expectedAssetPath: string;
  candidateState: string;
  reviewDecision: string;
  semanticState: string;
  continuityState: string;
  rightsState: string;
};

export type NarrativeVisualPlanPreview = {
  planId: string;
  projectId: string;
  episodeId: string;
  language: string;
  aspectRatio: string;
  frameRate: number;
  totalDurationFrames: number;
  beats: NarrativeVisualBeatPreview[];
  generationStarted: boolean;
  networkCallsMade: boolean;
  externalPublish: boolean;
  paidGeneration: boolean;
  humanReviewRequired: boolean;
  message: string;
};
