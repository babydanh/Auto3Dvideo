import { invoke } from "@tauri-apps/api/core";
import type { Job } from "../jobs/jobsTypes";
import { fallbackRecipes } from "./recipeTypes";
import type { MockRecipePreview, Recipe, RecipeValidationResult } from "./recipeTypes";
import type { AppNotice, AppSnapshot, AppStateSetter } from "../shared/appTypes";
import { useState } from "react";

export function useRecipeCatalog({ selectedProjectId, setActiveNav, setJobs, setLoading, setNotice, setSnapshot }: {
  selectedProjectId: string;
  setActiveNav: AppStateSetter<string>;
  setJobs: AppStateSetter<Job[]>;
  setLoading: AppStateSetter<boolean>;
  setNotice: AppNotice;
  setSnapshot: AppStateSetter<AppSnapshot>;
}) {
  const [recipes, setRecipes] = useState<Recipe[]>(fallbackRecipes);

  const [selectedRecipe, setSelectedRecipe] = useState("image_slideshow");

  async function queuePendingJob(recipe: Recipe) {
    if (!selectedProjectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi tạo queued job.");
      setActiveNav("overview");
      return;
    }
    setLoading(true);
    try {
      const job = await invoke<Job>("enqueue_pending_job", {
        projectId: selectedProjectId,
        recipeKind: recipe.recipeKind,
      });
      setJobs((current) => [job, ...current]);
      setSnapshot((current) => ({ ...current, jobCount: current.jobCount + 1 }));
      setNotice(`Đã tạo queued job ${job.jobId}; chưa chạy worker hoặc process ngoài.`);
      setActiveNav("jobs");
    } catch {
      setNotice("Không tạo được queued job. Project hoặc recipe chưa hợp lệ.");
    } finally {
      setLoading(false);
    }
  }

  async function runRecipe(recipe: Recipe) {
    if (!selectedProjectId) {
      setNotice("Hãy tạo hoặc chọn project trước khi chạy recipe.");
      setActiveNav("overview");
      return;
    }
    setLoading(true);
    try {
      const validation = await invoke<RecipeValidationResult>("validate_recipe_json", {
        recipeJson: JSON.stringify({
          schemaVersion: "1.0.0",
          recipeId: `ui-${recipe.recipeKind}`,
          kind: recipe.recipeKind,
          fps: 30,
          width: 1080,
          height: 1920,
          durationSeconds: 30,
          policy: { rightsRequired: true, humanReviewRequired: true, externalPublish: false, paidGeneration: false },
        }),
      });
      if (!validation.valid) {
        setNotice(`Recipe bị chặn: ${validation.errors.join("; ")}`);
        return;
      }
      const preview = await invoke<MockRecipePreview>("preview_recipe", { recipeKind: recipe.recipeKind });
      const job = await invoke<Job>("enqueue_mock_job", {
        projectId: selectedProjectId,
        recipeKind: recipe.recipeKind,
      });
      setJobs((current) => [job, ...current]);
      setSnapshot((current) => ({ ...current, jobCount: current.jobCount + 1 }));
      const warningText = validation.warnings.length ? ` Cảnh báo: ${validation.warnings.join("; ")}.` : "";
      setNotice(`${preview.message} ${preview.stages.length} stage; mock job ${job.jobId} đã ghi vào SQLite.${warningText}`);
      setActiveNav("jobs");
    } catch {
      setNotice("Không enqueue được job. Project phải tồn tại trong database local.");
    } finally {
      setLoading(false);
    }
  }

  async function loadRecipes() {
    return invoke<Recipe[]>("list_recipe_catalog");
  }
  return {
    queuePendingJob,
    loadRecipes,
    recipes,
    runRecipe,
    selectedRecipe,
    setRecipes,
    setSelectedRecipe,
  };
}
