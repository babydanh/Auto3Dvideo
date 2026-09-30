// Pure decision logic for native shot-reference drops. Kept free of Tauri and
// React imports so it stays directly testable.

// Every shot card renders one element with this attribute. Only these elements
// accept a native drop, so empty canvas space, the asset rail and overlapping
// cards all stay rejected instead of cross-binding a file to another shot.
export const shotReferenceTargetAttribute = "data-shot-reference-target";

// Mirrors the image branch of `mime_for_asset_path` in
// src-tauri/src/asset_library.rs: only these extensions import as an image.
export const supportedShotReferenceImageExtensions = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif"] as const;

export type ShotReferenceDropPathResult =
  | { ok: true; sourcePath: string }
  | { ok: false; reason: "no_path" | "multiple_paths" | "unsupported_image"; message: string };

export function classifyShotReferenceDropPaths(paths: readonly string[]): ShotReferenceDropPathResult {
  const candidates = paths.map((value) => value.trim()).filter(Boolean);
  if (candidates.length === 0) {
    return { ok: false, reason: "no_path", message: "That drop carried no file path, so no shot reference was assigned." };
  }
  if (candidates.length > 1) {
    return { ok: false, reason: "multiple_paths", message: `Drop exactly one image at a time; this drop carried ${candidates.length} files, so no shot reference was assigned.` };
  }
  const sourcePath = candidates[0];
  const fileName = sourcePath.split(/[\\/]/).pop() || sourcePath;
  const extension = (fileName.split(".").pop() || "").toLowerCase();
  if (!(supportedShotReferenceImageExtensions as readonly string[]).includes(extension)) {
    return { ok: false, reason: "unsupported_image", message: `“${fileName}” is not a supported image (${supportedShotReferenceImageExtensions.join(", ")}), so no shot reference was assigned.` };
  }
  return { ok: true, sourcePath };
}

export type ShotReferenceDropTarget =
  | { kind: "shot"; segmentId: string }
  | { kind: "background" }
  | { kind: "ambiguous" };

export function resolveShotReferenceDropTarget(elements: readonly Element[]): ShotReferenceDropTarget {
  const segmentIds: string[] = [];
  for (const element of elements) {
    const root = element.closest(`[${shotReferenceTargetAttribute}]`);
    const segmentId = root?.getAttribute(shotReferenceTargetAttribute) || "";
    if (!segmentId || segmentIds.includes(segmentId)) continue;
    segmentIds.push(segmentId);
  }
  if (segmentIds.length === 0) return { kind: "background" };
  if (segmentIds.length > 1) return { kind: "ambiguous" };
  return { kind: "shot", segmentId: segmentIds[0] };
}

// Tauri reports the drag position as a `PhysicalPosition` relative to the
// webview's top-left corner, the same origin CSS pixels use, so the only
// conversion is the webview's physical-to-CSS scale. `devicePixelRatio` is the
// ratio the webview itself renders with and also absorbs WebView2 zoom.
export function physicalToCssPoint(physical: { x: number; y: number }, scale: number): { x: number; y: number } {
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return { x: physical.x / factor, y: physical.y / factor };
}
