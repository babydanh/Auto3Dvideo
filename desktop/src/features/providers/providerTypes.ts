export type CommandCodeProbeReport = {
  status: string;
  httpStatus: number | null;
  model: string;
  responseText: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  networkCallsMade: boolean;
  costStatus: string;
  processStarted: boolean;
  externalSideEffectUnknown: boolean;
  message: string;
};

export type ProviderProfile = {
  profileId: string;
  capability: string;
  provider: string;
  model: string;
  endpointRef: string;
  enabled: boolean;
  configured: boolean;
  credentialRef: string;
};

type ProviderEnvProfile = {
  profileId: string;
  capability: string;
  provider: string;
  adapter: string;
  model: string;
  endpointRef: string;
  endpointConfigured: boolean;
  enabled: boolean;
  configured: boolean;
  credentialRef: string;
  credentialState: string;
  pricingMode: string;
  timeoutSeconds: number;
  maxAttempts: number;
  fallbackProfiles: string[];
  envPrefix: string;
  source: string;
  warnings: string[];
};

export type ProviderRoutingProfile = {
  roleId: string;
  label: string;
  model: string;
  modelEnv: string;
  responsibility: string;
  trigger: string;
  inputArtifact: string;
  outputArtifact: string;
  configured: boolean;
  source: string;
};

export type ProviderEnvSnapshot = {
  executionProfile: string;
  secretBackend: string;
  dotenvLoaded: boolean;
  dotenvSource: string;
  cloudRequestsBlocked: boolean;
  externalPublishBlocked: boolean;
  paidApprovalRequired: boolean;
  unknownCostPolicy: string;
  profiles: ProviderEnvProfile[];
  routing: ProviderRoutingProfile[];
  warnings: string[];
};

export function displayCommandCodeStatus(value: string) {
  const labels: Record<string, string> = {
    succeeded: "Thành công",
    worker_failed: "Bộ xử lý không chạy được",
    missing_credential: "Thiếu thông tin xác thực",
    invalid_configuration: "Cấu hình không hợp lệ",
    network_error: "Lỗi kết nối mạng",
    http_error: "Nhà cung cấp trả về lỗi HTTP",
    invalid_response: "Phản hồi không đúng định dạng",
    invalid_request: "Yêu cầu không hợp lệ",
  };
  return labels[value] ?? value;
}

export function displayCommandCodeCost(value: string) {
  const labels: Record<string, string> = {
    local_gateway_unreported: "Gateway cục bộ chưa báo chi phí",
    not_called: "Chưa gọi",
    provider_deal_unverified: "Chưa xác minh ưu đãi nhà cung cấp",
    provider_declared_free_while_capacity_last: "Nhà cung cấp công bố miễn phí khi còn dung lượng",
  };
  return labels[value] ?? value;
}

export function displayCredentialState(value: string) {
  const labels: Record<string, string> = { configured: "Đã cấu hình", missing: "Đang thiếu", unresolved: "Chưa phân giải", rejected: "Bị từ chối" };
  return labels[value] ?? value;
}

export function displayPricingMode(value: string) {
  const labels: Record<string, string> = { free: "Miễn phí", paid: "Có phí", unknown: "Chưa rõ chi phí", local: "Cục bộ" };
  return labels[value] ?? value;
}

export function displayCapability(value: string) {
  const labels: Record<string, string> = { llm: "Mô hình ngôn ngữ", image: "Hình ảnh", video: "Video", tts: "Giọng nói", stt: "Chuyển giọng thành chữ", audio: "Âm thanh", media: "Phương tiện" };
  return labels[value] ?? value;
}

export const fallbackProviders: ProviderProfile[] = [
  { profileId: "llm_local", capability: "llm", provider: "local", model: "configured-local-llm", endpointRef: "local://llm", enabled: true, configured: true, credentialRef: "none" },
  { profileId: "media_local", capability: "media", provider: "ffmpeg", model: "installed-binary", endpointRef: "binary://ffmpeg", enabled: true, configured: true, credentialRef: "none" },
  { profileId: "stt_local", capability: "stt", provider: "whisper", model: "configured-whisper", endpointRef: "local://whisper", enabled: false, configured: true, credentialRef: "none" },
  { profileId: "voice_primary", capability: "tts", provider: "omnivoice", model: "OmniVoice", endpointRef: "local://python", enabled: true, configured: false, credentialRef: "none" },
  { profileId: "video_primary", capability: "video", provider: "configured-by-user", model: "configured-video-model", endpointRef: "env:AUTO3DVIDEO_VIDEO_BASE_URL", enabled: false, configured: false, credentialRef: "env:AUTO3DVIDEO_VIDEO_API_KEY" },
];

export const fallbackProviderEnvSnapshot: ProviderEnvSnapshot = {
  executionProfile: "mock",
  secretBackend: "env",
  dotenvLoaded: false,
  dotenvSource: "none",
  cloudRequestsBlocked: true,
  externalPublishBlocked: true,
  paidApprovalRequired: true,
  unknownCostPolicy: "block",
  profiles: [],
  routing: [],
  warnings: [],
};
