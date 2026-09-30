import type { Dispatch, SetStateAction } from "react";
import type { WorkspaceActivityEvent } from "./workspaceActivityTypes";

export type AppSnapshot = {
  appVersion: string;
  locale: string;
  projectCount: number;
  jobCount: number;
  publishEnabled: boolean;
  paidGenerationEnabled: boolean;
};

export type AppStateSetter<T> = Dispatch<SetStateAction<T>>;

export type AppNotice = (message: string) => void;

export type AppActivityInput = Omit<WorkspaceActivityEvent, "eventId" | "timestamp">;

export type AppActivityRecorder = (input: AppActivityInput) => string;

export type AppActivityUpdater = (eventId: string, patch: Partial<AppActivityInput>) => void;

export type AppRefresh = () => Promise<void>;
