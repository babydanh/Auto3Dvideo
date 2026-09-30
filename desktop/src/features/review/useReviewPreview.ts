import { invoke } from "@tauri-apps/api/core";
import type { NarrativeVisualPlanPreview } from "./reviewTypes";
import type { AppNotice, AppStateSetter } from "../shared/appTypes";
import { useState } from "react";

export function useReviewPreview({ setActiveNav, setLoading, setNotice }: {
  setActiveNav: AppStateSetter<string>;
  setLoading: AppStateSetter<boolean>;
  setNotice: AppNotice;
}) {
  const [visualPlanPreview, setVisualPlanPreview] = useState<NarrativeVisualPlanPreview | null>(null);

  async function previewNarrativeVisualPlan() {
    setLoading(true);
    try {
      const preview = await invoke<NarrativeVisualPlanPreview>("preview_narrative_visual_plan_fixture");
      setVisualPlanPreview(preview);
      setActiveNav("review");
      setNotice(`Đã compile ${preview.beats.length} beat visual; chưa gọi provider và chưa tạo media.`);
    } catch {
      setNotice("Không compile được NarrativeVisualPlan fixture; kiểm tra native backend và contract.");
    } finally {
      setLoading(false);
    }
  }

  return {
    previewNarrativeVisualPlan,
    setVisualPlanPreview,
    visualPlanPreview,
  };
}
