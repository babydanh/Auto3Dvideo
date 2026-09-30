export type WorkspaceActivityState = "running" | "success" | "info" | "waiting_user" | "error" | "blocked" | "cancelled";

export type WorkspaceActivityEvent = {
  eventId: string;
  timestamp: string;
  stage: string;
  tool: string;
  state: WorkspaceActivityState;
  message: string;
  progress?: number;
  durationMs?: number;
  output?: string;
  nextAction?: string;
};

export function displayWorkspaceActivityState(value: WorkspaceActivityState) {
  const labels: Record<WorkspaceActivityState, string> = { running: "Đang chạy", success: "Đã xong", info: "Thông tin", waiting_user: "Chờ bạn", error: "Lỗi", blocked: "Bị chặn", cancelled: "Đã hủy" };
  return labels[value];
}
