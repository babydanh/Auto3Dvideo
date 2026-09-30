import { invoke } from "@tauri-apps/api/core";
import type { AssetPreviewView } from "../assets/assetTypes";
import { useEffect, useState } from "react";

export function WorkspaceMediaImage({ projectId, relativePath, src, alt, className }: { projectId: string; relativePath: string; src: string; alt: string; className?: string }) {
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [fallbackAttempted, setFallbackAttempted] = useState(false);

  useEffect(() => {
    setFallbackUrl(null);
    setFallbackAttempted(false);
  }, [projectId, relativePath, src]);

  async function loadNativeFallback() {
    if (fallbackAttempted || !projectId.trim()) return;
    setFallbackAttempted(true);
    try {
      const preview = await invoke<AssetPreviewView>("read_project_asset_preview", { projectId, relativePath });
      setFallbackUrl(`data:${preview.mimeType};base64,${preview.base64Data}`);
    } catch {
      // Keep the original source visible as the last diagnostic signal.
    }
  }

  return <img className={className} src={fallbackUrl ?? src} alt={alt} onError={() => void loadNativeFallback()} />;
}
