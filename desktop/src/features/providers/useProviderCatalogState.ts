import { invoke } from "@tauri-apps/api/core";
import { displayCommandCodeStatus, fallbackProviderEnvSnapshot, fallbackProviders } from "./providerTypes";
import type { CommandCodeProbeReport, ProviderEnvSnapshot, ProviderProfile } from "./providerTypes";
import type { AppActivityRecorder, AppNotice, AppSnapshot, AppStateSetter } from "../shared/appTypes";
import { useState } from "react";

export function useProviderCatalogState({ recordWorkspaceActivity, setNotice, setSnapshot, snapshot }: {
  recordWorkspaceActivity: AppActivityRecorder;
  setNotice: AppNotice;
  setSnapshot: AppStateSetter<AppSnapshot>;
  snapshot: AppSnapshot;
}) {
  const [commandCodeReport, setCommandCodeReport] = useState<CommandCodeProbeReport | null>(null);

  const [commandCodeTesting, setCommandCodeTesting] = useState(false);

  const [providers, setProviders] = useState<ProviderProfile[]>(fallbackProviders);

  const [providerEnvSnapshot, setProviderEnvSnapshot] = useState<ProviderEnvSnapshot>(fallbackProviderEnvSnapshot);

  async function testCommandCode() {
    setCommandCodeTesting(true);
    try {
      const report = await invoke<CommandCodeProbeReport>("test_commandcode_chat");
      setCommandCodeReport(report);
      setNotice(report.status === "succeeded" ? "Command Code đã trả lời thành công." : `Kiểm tra Command Code: ${displayCommandCodeStatus(report.status)}. ${report.message}`);
    } catch (error) {
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "lỗi native không xác định";
      setNotice(`Không chạy được bước kiểm tra Command Code: ${detail.slice(0, 240)}`);
    } finally {
      setCommandCodeTesting(false);
    }
  }

  async function toggleCloudGeneration() {
    const enabled = !snapshot.paidGenerationEnabled;
    try {
      const nextEnabled = await invoke<boolean>("set_cloud_generation_enabled", { enabled });
      setSnapshot((current) => ({ ...current, paidGenerationEnabled: nextEnabled }));
      const nextProviderEnvSnapshot = await invoke<ProviderEnvSnapshot>("get_provider_env_snapshot");
      setProviderEnvSnapshot(nextProviderEnvSnapshot);
      const message = nextEnabled
        ? "Đã bật Cloud/API và lưu trạng thái cho lần mở app sau; lần chạy video có thể dùng credit. Tắt Cloud/API nếu muốn khóa lại."
        : "Đã tắt Cloud/API: app chỉ chạy local, không gọi Nano Banana MCP hoặc Google Flow.";
      setNotice(message);
      recordWorkspaceActivity({ stage: "cloud_generation.toggle", tool: "Provider gate", state: "success", message, nextAction: nextEnabled ? "Nhập prompt rồi bấm Tự làm toàn bộ." : "Bật lại Cloud/API nếu muốn tạo asset/video bên ngoài." });
    } catch (error) {
      setNotice(`Không đổi được trạng thái Cloud/API: ${String(error).slice(0, 280)}`);
    }
  }

  async function loadProviders() {
    return invoke<ProviderProfile[]>("list_provider_catalog");
  }

  async function loadProviderEnvSnapshot() {
    return invoke<ProviderEnvSnapshot>("get_provider_env_snapshot");
  }
  return {
    loadProviderEnvSnapshot,
    loadProviders,
    commandCodeReport,
    commandCodeTesting,
    providerEnvSnapshot,
    providers,
    setCommandCodeReport,
    setCommandCodeTesting,
    setProviderEnvSnapshot,
    setProviders,
    testCommandCode,
    toggleCloudGeneration,
  };
}
