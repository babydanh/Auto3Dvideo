export type Recipe = {
  recipeKind: string;
  name: string;
  worker: string;
  localFirst: boolean;
  requiresApproval: boolean;
};

export type MockRecipePreview = {
  recipeKind: string;
  stages: string[];
  paidGenerationBlocked: boolean;
  externalPublishBlocked: boolean;
  externalProcessesNotStarted: boolean;
  message: string;
};

export type RecipeValidationResult = {
  valid: boolean;
  recipeId: string;
  recipeKind: string;
  errors: string[];
  warnings: string[];
  externalSideEffectsBlocked: boolean;
};

export const fallbackRecipes: Recipe[] = [
  { recipeKind: "image_slideshow", name: "2D slideshow hình ảnh", worker: "FFmpeg / Remotion", localFirst: true, requiresApproval: true },
  { recipeKind: "html_to_video", name: "HTML / React thành video", worker: "Remotion", localFirst: true, requiresApproval: true },
  { recipeKind: "voiceover_package", name: "Lồng tiếng và phụ đề", worker: "Piper / TTS / Whisper", localFirst: true, requiresApproval: true },
  { recipeKind: "screen_demo", name: "Quay màn hình / demo", worker: "OBS / FFmpeg", localFirst: true, requiresApproval: true },
  { recipeKind: "hybrid_2d_3d", name: "Hybrid 2D–3D", worker: "Blender + Remotion", localFirst: true, requiresApproval: true },
  { recipeKind: "true_3d", name: "True 3D Blender", worker: "Blender CLI/Python", localFirst: true, requiresApproval: true },
];
