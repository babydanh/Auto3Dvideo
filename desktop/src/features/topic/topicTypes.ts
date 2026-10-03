type TopicAssetPolicy = {
  requiresProvenance: boolean;
  rejectIrrelevantCandidates: boolean;
  requiresHumanReview: boolean;
  allowedSources: string[];
};

export type TopicProfile = {
  profileId: string;
  name: string;
  description: string;
  defaultRecipeKind: string;
  visualMode: string;
  defaultAudience: string;
  shotStrategy: string;
  assetPolicy: TopicAssetPolicy;
  qaChecklist: string[];
  promptTemplateIds: string[];
};

export type PromptTemplate = {
  templateId: string;
  version: string;
  name: string;
  purpose: string;
  locale: string;
  body: string;
  inputKeys: string[];
  outputContract: string[];
  guardrails: string[];
};

export type LocalVideoPipelineReport = {
  status: string;
  runId: string;
  jobId: string;
  attemptId: string;
  visualMode: string;
  audioMode: string;
  scriptPath: string;
  sceneManifestPath: string;
  audioPath: string;
  captionsPath: string;
  videoPath: string;
  durationSeconds: number | null;
  networkCallsMade: boolean;
  costStatus: string;
  humanReviewRequired: boolean;
  message: string;
};

export type TopicPromptPreview = {
  profileId: string;
  profileName: string;
  templateId: string;
  templateVersion: string;
  renderedPrompt: string;
  selectedRecipeKind: string;
  visualMode: string;
  requiredHumanReview: boolean;
  networkCallsMade: boolean;
  paidGeneration: boolean;
  externalPublish: boolean;
  message: string;
};

export const fallbackTopicProfiles: TopicProfile[] = [
  { profileId: "science-explainer", name: "Khoa học / giải thích", description: "Claim, nguồn, biểu đồ và minh họa có căn cứ.", defaultRecipeKind: "html_to_video", visualMode: "editorial-data", defaultAudience: "Người xem phổ thông", shotStrategy: "Mỗi claim cần visual proof.", assetPolicy: { requiresProvenance: true, rejectIrrelevantCandidates: true, requiresHumanReview: true, allowedSources: ["user-owned", "generated-local", "public-domain"] }, qaChecklist: ["Kiểm tra nguồn", "Kiểm tra số liệu", "Kiểm tra subtitle"], promptTemplateIds: ["content-brief-v1", "research-claims-v1", "storyboard-shots-v1", "asset-candidates-v1", "narration-v1"] },
  { profileId: "history-documentary", name: "Lịch sử / tài liệu", description: "Timeline, bản đồ và tư liệu có provenance.", defaultRecipeKind: "image_slideshow", visualMode: "documentary", defaultAudience: "Người xem cần ngữ cảnh", shotStrategy: "Mỗi mốc có nguồn và chú thích.", assetPolicy: { requiresProvenance: true, rejectIrrelevantCandidates: true, requiresHumanReview: true, allowedSources: ["wikimedia-reviewed", "public-domain"] }, qaChecklist: ["Đối chiếu ngày tháng", "Kiểm tra license", "Kiểm tra tái hiện AI"], promptTemplateIds: ["content-brief-v1", "research-claims-v1", "storyboard-shots-v1", "asset-candidates-v1", "narration-v1"] },
  { profileId: "story-narrative", name: "Truyện / kể chuyện", description: "Nhân vật, bối cảnh và continuity xuyên suốt.", defaultRecipeKind: "hybrid_2d_3d", visualMode: "narrative", defaultAudience: "Người xem thích chuyện ngắn", shotStrategy: "Khóa identity anchor trước từng beat.", assetPolicy: { requiresProvenance: true, rejectIrrelevantCandidates: true, requiresHumanReview: true, allowedSources: ["generated-local", "user-owned"] }, qaChecklist: ["Kiểm tra nhân vật", "Kiểm tra đạo cụ", "Kiểm tra IP"], promptTemplateIds: ["content-brief-v1", "character-bible-v1", "storyboard-shots-v1", "asset-candidates-v1", "narration-v1"] },
  { profileId: "product-demo", name: "Sản phẩm / demo", description: "Demo tính năng bằng claim và màn hình có bằng chứng.", defaultRecipeKind: "screen_demo", visualMode: "product-demo", defaultAudience: "Khách hàng hoặc người dùng", shotStrategy: "Mỗi claim gắn với màn hình hoặc tài liệu.", assetPolicy: { requiresProvenance: true, rejectIrrelevantCandidates: true, requiresHumanReview: true, allowedSources: ["user-owned", "generated-local"] }, qaChecklist: ["Duyệt claim", "Che dữ liệu riêng", "Kiểm tra CTA"], promptTemplateIds: ["content-brief-v1", "product-claims-v1", "storyboard-shots-v1", "asset-candidates-v1", "narration-v1"] },
  { profileId: "gameplay-demo", name: "Gameplay / hướng dẫn", description: "Thao tác thật, callout đúng frame và media có quyền.", defaultRecipeKind: "screen_demo", visualMode: "gameplay", defaultAudience: "Người xem cần thấy thao tác", shotStrategy: "Capture theo bước và che dữ liệu riêng.", assetPolicy: { requiresProvenance: true, rejectIrrelevantCandidates: true, requiresHumanReview: true, allowedSources: ["user-owned", "licensed-game-capture"] }, qaChecklist: ["Kiểm tra quyền capture", "Che tài khoản", "Kiểm tra callout"], promptTemplateIds: ["content-brief-v1", "tutorial-steps-v1", "storyboard-shots-v1", "asset-candidates-v1", "narration-v1"] },
  { profileId: "cinematic-3d", name: "Cinematic 3D", description: "Asset, camera, ánh sáng và chuyển động tái sử dụng được.", defaultRecipeKind: "true_3d", visualMode: "cinematic-3d", defaultAudience: "Người xem cần hình ảnh điện ảnh", shotStrategy: "Visual bible trước, Blender giữ geometry/camera.", assetPolicy: { requiresProvenance: true, rejectIrrelevantCandidates: true, requiresHumanReview: true, allowedSources: ["generated-local", "user-owned", "licensed-3d"] }, qaChecklist: ["Kiểm tra asset", "Kiểm tra camera", "Kiểm tra output"], promptTemplateIds: ["content-brief-v1", "world-bible-v1", "storyboard-shots-v1", "asset-candidates-v1", "narration-v1"] },
];

export const fallbackPromptTemplates: PromptTemplate[] = [
  { templateId: "content-brief-v1", version: "v1.0.0", name: "Brief nội dung theo chủ đề", purpose: "Biến ý tưởng thành brief có claim và phạm vi.", locale: "vi-VN", body: "Chủ đề: {{topic}}. Profile: {{topic_profile}}. Đối tượng: {{audience}}. Mục tiêu: {{content_goal}}. Tạo brief, claim cần kiểm chứng, entity và điều không được suy diễn.", inputKeys: ["topic", "topic_profile", "audience", "content_goal"], outputContract: ["promise", "scope", "claims_to_verify"], guardrails: ["Không bịa nguồn.", "Không đưa bí mật.", "Bắt buộc review."] },
];
