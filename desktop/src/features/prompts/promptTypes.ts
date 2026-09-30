export type PromptPreset = {
  schemaVersion: string;
  presetId: string;
  projectId: string;
  name: string;
  description: string;
  scope: "project" | "user";
  status: "draft" | "active" | "archived";
  version: string;
  template: string;
  variableKeys: string[];
  negativeTemplate: string;
  providerTargets: string[];
  styleBibleId: string | null;
  rightsLicenseNote: string;
  parentPresetId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type PromptPresetDraft = {
  name: string;
  description: string;
  scope: "project" | "user";
  status: "draft" | "active";
  version: string;
  template: string;
  variableKeys: string[];
  negativeTemplate: string;
  providerTargets: string[];
  styleBibleId: string | null;
  rightsLicenseNote: string;
  parentPresetId: string | null;
};

export type PromptStudioActivity = {
  stage: string;
  tool: string;
  state: "running" | "success" | "info" | "waiting_user" | "error" | "blocked" | "cancelled";
  message: string;
  progress?: number;
  durationMs?: number;
  output?: string;
  nextAction?: string;
};
