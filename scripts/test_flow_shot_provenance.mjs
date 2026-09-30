import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Runner-level contracts for the paid shot run: the compiled prompt an
// explicitly bound shot sends, the canonical reference fingerprint, and the
// reconcile -> binding -> preflight -> exact-attach gates.
//
// The gates are the same exported functions `autoGenerateBrowserFlowSequential`
// calls, so they are exercised as production code rather than re-implemented
// here. They live in the desktop workspace, so vite is resolved from that
// workspace's own install instead of being added as a root dependency.
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const desktopRoot = path.join(repoRoot, "desktop");
const { createServer } = await import(pathToFileURL(createRequire(path.join(desktopRoot, "package.json")).resolve("vite")).href);

const viteServer = await createServer({
  configFile: path.join(desktopRoot, "vite.config.ts"),
  root: desktopRoot,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

try {
  const {
    buildBrowserFlowShotPrompt,
    flowReferenceFingerprintInput,
    flowSegmentsForGeneration,
    flowShotImageCoverage,
    flowShotImageCoverageFromCards,
    flowShotInputHashInput,
    describeFlowReferenceCoverage,
    hasCompleteFlowReferenceSet,
    describeFlowReferenceSetShortfall,
    describeFlowShotReferenceAttach,
    planFlowShotReferenceAttach,
    stableBrowserFlowPrompt,
    verifyFlowShotReferenceAttach,
  } = await viteServer.ssrLoadModule("/src/features/browserflow/browserFlowHelpers.ts");

  const MEDIA = "media-alpha";
  const boundShot = {
    segmentId: "segment-002",
    revisionId: "rev-001",
    durationSeconds: 5,
    subject: "Hắc Vân, a Bengal tiger",
    visualPrompt: "Wet rainforest floor at dusk, shallow depth of field",
    action: "The tiger is dragged forward by the widening tear",
    cameraIntent: "Slow push-in, 50mm",
    lightingIntent: "Warm dusk rim light",
    continuityNotes: "Same scar above the right eye",
    negativePrompt: "text overlay",
  };
  const runnerScript = {
    title: "Tiger time rift",
    hook: "A tear in time",
    promptVersion: "cinematic-3d-bible-v1",
    referenceAssetPaths: ["assets/references/C:/Windows/System32/start.png"],
    comfyuiAssetPaths: ["assets/references/shot-002.png"],
    geminiAssetPaths: [],
    segments: [
      { ...boundShot, segmentId: "segment-001", action: "Paw steps through mud" },
      boundShot,
    ],
  };
  const explicitBinding = {
    segmentId: "segment-002",
    referenceSetId: "set-shot",
    assignmentId: "assignment-start",
    assetId: "asset-start",
    assetSha256: "d".repeat(64),
    role: "start_frame",
    flowProjectId: "proj-9",
    flowMediaId: MEDIA,
    confirmationKind: "manual_visual",
  };

  // --- a bound shot states the role and never names a local file ----------
  const boundShotPrompt = buildBrowserFlowShotPrompt(
    runnerScript,
    boundShot,
    1,
    "auto-muigr1z5-browser-flow",
    "rev-001",
    { providerProjectKey: "proj-9" },
    "video-session-test",
    "",
    2,
    { role: explicitBinding.role },
  );
  assert.ok(boundShotPrompt);
  assert.match(boundShotPrompt, /Use the attached image as this shot's starting frame\/identity\/composition reference/);
  assert.match(boundShotPrompt, /role: start_frame/);
  assert.doesNotMatch(boundShotPrompt, /@Image/i);
  assert.doesNotMatch(boundShotPrompt, /[A-Za-z]:[\\/]/, "no absolute Windows path reaches the paid prompt");
  assert.doesNotMatch(boundShotPrompt, /assets\/references/, "no local relative path reaches the paid prompt");
  assert.doesNotMatch(boundShotPrompt, /\.png\b/i, "no local file name reaches the paid prompt");
  assert.match(boundShotPrompt, /one continuous unbroken shot/);
  assert.match(boundShotPrompt, /no unrelated subject/);
  assert.match(boundShotPrompt, /CONTINUITY FROM PREVIOUS SHOT: SHOT-001/, "continuity is anchored to the source shot, not the part index");

  const unboundShotPrompt = buildBrowserFlowShotPrompt(
    runnerScript,
    boundShot,
    1,
    "auto-muigr1z5-browser-flow",
    "rev-001",
    { providerProjectKey: "proj-9" },
    "video-session-test",
  );
  assert.ok(unboundShotPrompt);
  assert.doesNotMatch(unboundShotPrompt, /Use the attached image as this shot's starting frame/, "an unbound shot never claims an attached image");
  assert.match(unboundShotPrompt, /no bound reference image/);
  assert.match(unboundShotPrompt, /one continuous unbroken shot/);
  assert.match(unboundShotPrompt, /no extra voice-over/);

  // --- a script field that names a local file is prose, not a path ---------
  // The planner writes free text into these fields, so the script branch gets
  // the same sanitizing the brief branch gets. Prose that only looks like a
  // path, such as the "16:9" ratio, must still survive whole.
  const dirtySegment = {
    ...boundShot,
    subject: "Hắc Vân, a Bengal tiger traced from C:\\Users\\Alice\\start.png",
    visualPrompt: "Wet rainforest floor at dusk; see assets/references/shot-002.png and @Image1",
    cameraIntent: "Slow push-in, 50mm, cut from outputs/shot-002.mp4",
    lightingIntent: "Warm dusk rim light, 16:9, 720p",
  };
  const dirtyShotPrompt = buildBrowserFlowShotPrompt(
    { ...runnerScript, segments: [{ ...boundShot, segmentId: "segment-001", action: "Paw steps through mud" }, dirtySegment] },
    dirtySegment,
    1,
    "auto-muigr1z5-browser-flow",
    "rev-001",
    { providerProjectKey: "proj-9" },
    "video-session-test",
    "",
    2,
    { role: explicitBinding.role },
  );
  assert.ok(dirtyShotPrompt);
  for (const [label, pattern] of [
    ["an absolute Windows path", /[A-Za-z]:[\\/]/],
    ["a bare local file name", /\.(?:png|jpe?g|webp|gif|bmp|mp4|mov|webm|mkv)\b/i],
    ["a local relative workspace path", /(?:assets|outputs)[\\/]|\.auto3dvideo[\\/]/],
    ["a provider media tag", /@(?:Image|Video|Audio)\d*/i],
  ]) {
    assert.doesNotMatch(dirtyShotPrompt, pattern, `${label} reaches the paid prompt: ${dirtyShotPrompt}`);
  }
  assert.match(dirtyShotPrompt, /a Bengal tiger/, "the subject's real description survives");
  assert.match(dirtyShotPrompt, /16:9, 720p/, "ordinary camera and light prose survives");

  // --- the reference fingerprint is a canonical function of its 9 fields --
  const fingerprintParts = {
    projectId: "project-test",
    flowProjectId: "proj-9",
    sessionId: "video-session-test",
    segmentId: "segment-002",
    assignmentId: "assignment-start",
    assetSha256: "d".repeat(64),
    flowMediaId: MEDIA,
    role: "start_frame",
    confirmationKind: "manual_visual",
  };
  const fingerprint = flowReferenceFingerprintInput(fingerprintParts);
assert.notEqual(
  flowReferenceFingerprintInput({ ...fingerprintParts, sessionId: null }),
  fingerprint,
  "a session-less binding is its own identity, not the session-scoped one",
);
assert.equal(
  flowReferenceFingerprintInput({ ...fingerprintParts, sessionId: undefined }),
  flowReferenceFingerprintInput({ ...fingerprintParts, sessionId: null }),
  "an absent optional field and an explicit null are one canonical value",
);
  for (const [field, value] of [
    ["projectId", "project-other"],
    ["flowProjectId", "proj-other"],
    ["sessionId", "video-session-other"],
    ["segmentId", "segment-001"],
    ["assignmentId", "assignment-other"],
    ["assetSha256", "e".repeat(64)],
    ["flowMediaId", "media-beta"],
    ["role", "composition"],
    ["confirmationKind", "manual_visual_x"],
  ]) {
    assert.notEqual(
      flowReferenceFingerprintInput({ ...fingerprintParts, [field]: value }),
      fingerprint,
      `changing ${field} changes the reference fingerprint`,
    );
  }

  // --- the shot input hash: prompt only when unbound, prompt+print when bound
  const stableBound = stableBrowserFlowPrompt(boundShotPrompt);
  const stableUnbound = stableBrowserFlowPrompt(unboundShotPrompt);
  assert.equal(
    flowShotInputHashInput(stableUnbound, null),
    stableUnbound,
    "a reference-free shot keeps the legacy prompt-only hash input",
  );
  assert.notEqual(flowShotInputHashInput(stableBound, fingerprint), flowShotInputHashInput(stableBound, "f".repeat(64)));
  assert.ok(flowShotInputHashInput(stableBound, fingerprint).startsWith(stableBound), "the bound hash still covers the exact compiled prompt");

  // --- a split segment keeps its stable source id for binding resolution --
  const splitSegments = flowSegmentsForGeneration({ ...runnerScript, segments: [{ ...boundShot, segmentId: "segment-long", durationSeconds: 24 }] });
  assert.equal(splitSegments.length, 3);
  assert.deepEqual([...new Set(splitSegments.map((part) => part.sourceSegmentId))], ["segment-long"], "every part resolves to its source segment");
  assert.deepEqual(
    splitSegments.map((part) => part.segment.segmentId),
    ["segment-long-part-01", "segment-long-part-02", "segment-long-part-03"],
  );
  assert.deepEqual(flowSegmentsForGeneration(runnerScript).map((part) => part.sourceSegmentId), ["segment-001", "segment-002"]);

  // --- attach planning: an explicit binding never falls back to a label ----
  const unboundFlowMedia = planFlowShotReferenceAttach({
    binding: { ...explicitBinding, flowMediaId: undefined },
    shotHasSubjectImage: true,
    runIsImageDriven: false,
    legacyShotId: "SHOT-002",
    legacyRevisionId: "rev-001",
  });
  assert.equal(unboundFlowMedia.ok, false, "an explicit binding with no Flow media blocks before any attach");
  assert.equal(unboundFlowMedia.code, "unbound_flow_media");
  const explicitPlan = planFlowShotReferenceAttach({
    binding: explicitBinding,
    shotHasSubjectImage: true,
    runIsImageDriven: false,
    legacyShotId: "SHOT-002",
    legacyRevisionId: "rev-001",
  });
  assert.equal(explicitPlan.ok, true);
  assert.equal(explicitPlan.route, "explicit_media", "a bound shot never takes the historical label route");
  assert.equal(explicitPlan.mediaId, MEDIA, "a bound shot attaches that exact media ID");
  const legacyPlan = planFlowShotReferenceAttach({
    binding: null,
    shotHasSubjectImage: true,
    runIsImageDriven: false,
    legacyShotId: "SHOT-002",
    legacyRevisionId: "rev-001",
  });
  assert.equal(legacyPlan.ok, true, "a legacy unbound shot still generates through the historical label route");
  assert.equal(legacyPlan.route, "legacy_label");
  assert.equal(legacyPlan.mediaId, null);
  assert.equal(
    planFlowShotReferenceAttach({ binding: null, shotHasSubjectImage: false, legacyShotId: "SHOT-002", legacyRevisionId: "rev-001" }).route,
    "text_to_video",
  );
  // --- route diagnosis: a silent drop to text_to_video must be readable ---
  assert.equal(
    describeFlowShotReferenceAttach("SHOT-002", legacyPlan),
    "SHOT-002: tìm ảnh chủ thể theo nhãn SHOT_ID trong lưới Flow; không có binding đã xác nhận nên dùng đường nhãn lịch sử.",
  );
  assert.equal(
    describeFlowShotReferenceAttach("SHOT-002", explicitPlan),
    "SHOT-002: gắn đúng card Flow đã xác nhận (media media-alpha).",
  );
  const noImagePlan = planFlowShotReferenceAttach({
    binding: null,
    shotHasSubjectImage: false,
    runIsImageDriven: false,
    legacyShotId: "SHOT-002",
    legacyRevisionId: "rev-001",
  });
  assert.match(
    describeFlowShotReferenceAttach("SHOT-002", noImagePlan),
    /không kèm ảnh/i,
    "a shot that runs text-only must say so in plain language",
  );
  // --- reference-set diagnosis: name the shortfall, not just "incomplete" ---
  const elevenOfTwelve = {
    segments: Array.from({ length: 12 }, (_, i) => ({ segmentId: `segment-${String(i + 1).padStart(3, "0")}` })),
    comfyuiAssetPaths: Array.from({ length: 11 }, (_, i) => `assets/shot-${String(i + 1).padStart(3, "0")}.png`),
  };
  assert.equal(hasCompleteFlowReferenceSet(elevenOfTwelve), false, "eleven assets cannot cover twelve shots");
  assert.equal(
    describeFlowReferenceSetShortfall(elevenOfTwelve),
    "Thiếu ảnh chủ thể: có 11 ảnh cho 12 shot, còn thiếu 1. Toàn bộ run sẽ chạy KHÔNG kèm ảnh cho mọi shot.",
  );
  assert.equal(
    describeFlowReferenceSetShortfall({
      segments: elevenOfTwelve.segments,
      comfyuiAssetPaths: Array.from({ length: 12 }, (_, i) => `assets/shot-${String(i + 1).padStart(3, "0")}.png`),
    }),
    "Đủ 12 ảnh chủ thể cho 12 shot; mỗi shot sẽ tự tìm ảnh của mình trong lưới Flow.",
  );
  assert.match(
    describeFlowReferenceSetShortfall({ segments: elevenOfTwelve.segments, comfyuiAssetPaths: [] }),
    /còn thiếu 12/,
    "an empty asset pack reports the full shortfall, not zero",
  );

  // --- coverage: the Flow grid knows each image's shot, local paths do not ---
  const workflow = {
    downloadedFiles: [
      { downloadId: "1", name: "a.png", mediaKind: "image", shotId: "SHOT-001", revisionId: "rev-001" },
      { downloadId: "2", name: "b.png", mediaKind: "image", shotId: "SHOT-002", revisionId: "rev-001" },
      { downloadId: "3", name: "c.mp4", mediaKind: "video", shotId: "SHOT-003", revisionId: "rev-001" },
    ],
  };
  const shotIds = ["SHOT-001", "SHOT-002", "SHOT-003"];
  assert.deepEqual(
    flowShotImageCoverage(workflow, shotIds),
    { withImage: ["SHOT-001", "SHOT-002"], withoutImage: ["SHOT-003"] },
    "a video is not a subject image, so SHOT-003 has no image",
  );
  assert.equal(
    describeFlowReferenceCoverage({ withImage: ["SHOT-001"], withoutImage: ["SHOT-002", "SHOT-003"] }),
    "Thiếu ảnh chủ thể cho: SHOT-002, SHOT-003. Các shot này sẽ không tìm thấy card trong lưới Flow.",
  );
  assert.equal(
    describeFlowReferenceCoverage({ withImage: shotIds, withoutImage: [] }),
    "Mọi shot đều có ảnh chủ thể trong lưới Flow.",
  );
  // --- per-shot routing: one missing image must not downgrade every shot --
  const perShotPlan = (shotId, hasImage) => planFlowShotReferenceAttach({
    binding: null,
    shotHasSubjectImage: hasImage,
    legacyShotId: shotId,
    legacyRevisionId: "rev-001",
  });
  assert.equal(perShotPlan("SHOT-001", true).route, "legacy_label", "a shot that owns an image attaches it");
  assert.equal(perShotPlan("SHOT-002", false).route, "text_to_video", "a shot with no image runs text-only");
  assert.equal(
    planFlowShotReferenceAttach({
      binding: explicitBinding,
      shotHasSubjectImage: false,
    runIsImageDriven: false,
      legacyShotId: "SHOT-002",
      legacyRevisionId: "rev-001",
    }).route,
    "explicit_media",
    "a confirmed binding still wins over the per-shot image check",
  );

  // --- fail closed: an image-driven run must never quietly drop a subject --
  const imageDrivenPlan = (shotId, hasImage) => planFlowShotReferenceAttach({
    binding: null,
    shotHasSubjectImage: hasImage,
    runIsImageDriven: true,
    legacyShotId: shotId,
    legacyRevisionId: "rev-001",
  });
  assert.equal(imageDrivenPlan("SHOT-001", true).route, "legacy_label", "a shot that owns an image attaches it");
  const droppedSubject = imageDrivenPlan("SHOT-002", false);
  assert.equal(droppedSubject.ok, false, "a subject present elsewhere in the run must not be dropped silently");
  assert.equal(droppedSubject.code, "subject_image_missing");
  assert.match(droppedSubject.message, /KHÔNG kèm ảnh/, "the stop must say the shot would spend credits without its subject");
  assert.equal(
    planFlowShotReferenceAttach({
      binding: null,
      shotHasSubjectImage: false,
    runIsImageDriven: false,
      runIsImageDriven: false,
      legacyShotId: "SHOT-002",
      legacyRevisionId: "rev-001",
    }).route,
    "text_to_video",
    "a run with no subject images anywhere is a genuine text-to-video run",
  );

  // --- a degraded card read must never count as a subject ---------------
  assert.deepEqual(
    flowShotImageCoverageFromCards(
      [{ label: "SHOT_ID: SHOT-001", selectable: false }],
      ["SHOT-001"],
    ),
    { withImage: [], withoutImage: ["SHOT-001"] },
    "a card the backend could not read completely is not a usable subject",
  );
  assert.deepEqual(
    flowShotImageCoverageFromCards(
      [{ label: "SHOT_ID: SHOT-001", selectable: true }],
      ["SHOT-001"],
    ),
    { withImage: ["SHOT-001"], withoutImage: [] },
    "a fully read, selectable card does count",
  );
  // --- grid coverage: a card on the page is a subject image even if the
  // --- machine never downloaded it ------------------------------------------
  const gridCards = [
    { mediaId: "m1", label: "SHOT_ID: SHOT-001\nREVISION_ID: rev-001" },
    { mediaId: "m2", label: "a high-end 3x3 visual storyboard grid" },
  ];
  assert.deepEqual(
    flowShotImageCoverageFromCards(gridCards, ["SHOT-001", "SHOT-002"]),
    { withImage: ["SHOT-001"], withoutImage: ["SHOT-002"] },
    "a card labelled with the shot counts; an unlabelled card does not",
  );
  assert.deepEqual(
    flowShotImageCoverageFromCards([], ["SHOT-001"]),
    { withImage: [], withoutImage: ["SHOT-001"] },
    "an empty grid reports every shot as missing, not none",
  );
  // --- attach verification: the report must name that exact media ---------
  assert.equal(
    verifyFlowShotReferenceAttach(MEDIA, { status: "ready", referenceAttached: true, sourceMediaId: MEDIA }).ok,
    true,
  );
  for (const [report, reason] of [
    [{ status: "ready", referenceAttached: true, sourceMediaId: "media-other" }, "mismatched_source_media"],
    [{ status: "ready", referenceAttached: true, sourceMediaId: null }, "mismatched_source_media"],
    [{ status: "ready", referenceAttached: false, sourceMediaId: MEDIA }, "reference_not_attached"],
    [{ status: "failed", referenceAttached: true, sourceMediaId: MEDIA }, "animate_failed"],
    [null, "animate_failed"],
  ]) {
    const verified = verifyFlowShotReferenceAttach(MEDIA, report);
    assert.equal(verified.ok, false, `a report that is not an exact match blocks: ${JSON.stringify(report)}`);
    assert.equal(verified.code, reason);
  }
} finally {
  await viteServer.close();
}

console.log("Flow shot provenance and runner gate checks passed.");
