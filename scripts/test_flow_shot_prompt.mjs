import assert from "node:assert/strict";
import {
  buildBriefDrivenFlowShotPrompt,
  extractFlowShotBriefContext,
  isRepeatedBriefShotTemplate,
  sanitizeFlowShotPromptProse,
} from "../desktop/src/flowShotPrompt.ts";

const brief = `Tạo video 60 giây, 3 shot về Hắc Vân, hổ Bengal xuyên thời gian và đối đầu T-Rex.

Nhân vật chính duy nhất là Hắc Vân, một hổ Bengal đực có lông cam sẫm, sọc đen, mắt vàng và sẹo nhỏ trên mắt phải. Giữ nguyên ngoại hình trong mọi shot.

Mở đầu trong một khu rừng nhiệt đới hiện đại lúc hoàng hôn. Hắc Vân đi giữa mưa lớn và nghe tiếng gầm lạ.

Shot 01: cận cảnh bàn chân Hắc Vân bước qua bùn, móng vuốt siết chặt.
Shot 02: vết rách thời gian mở rộng giữa rừng; Hắc Vân bị lực hút kéo về phía trước.
Shot 03: Hắc Vân rơi xuyên qua đường hầm không gian và đáp xuống rừng dương xỉ cổ đại.

Phong cách hình ảnh: cinematic 3D photorealistic, dramatic volumetric lighting, wet fur and realistic movement.

Giữ continuity tuyệt đối: Hắc Vân luôn là cùng một con hổ Bengal; T-Rex là đối thủ riêng, không có máu me, không thêm người.`;

const subject = `One primary scene hero with consistent appearance. Topic grounding: ${brief}`;
const visualPrompt = `ROLE CONTRACT — planner. Scene mode: generic_scene. ${brief}`;
assert.equal(isRepeatedBriefShotTemplate(subject, visualPrompt, brief), true);

const shot1 = extractFlowShotBriefContext(brief, 1);
assert.ok(shot1);
assert.match(shot1.character, /Hắc Vân/);
assert.match(shot1.openingSetting, /khu rừng nhiệt đới hiện đại lúc hoàng hôn/);
assert.match(shot1.shot, /bàn chân Hắc Vân bước qua bùn/);

const prompt = buildBriefDrivenFlowShotPrompt({
  brief,
  shotNumber: 2,
  shotId: "SHOT-002",
  revisionId: "rev-001",
  runId: "flow-test-run",
  projectId: "flow-project-test",
  sessionId: "local-test-session",
  durationSeconds: 5,
  maxDurationSeconds: 10,
});
assert.ok(prompt);
assert.match(prompt, /SHOT 2: vết rách thời gian mở rộng/);
assert.match(prompt, /Hắc Vân, một hổ Bengal đực/);
assert.match(prompt, /Giữ continuity tuyệt đối/);
assert.match(prompt, /exactly one standalone video shot/);
assert.doesNotMatch(prompt, /One primary scene hero/i);
assert.doesNotMatch(prompt, /^SHOT 1:/m, "the previous shot is never presented as this shot's own action line");
assert.doesNotMatch(prompt, /SHOT 3: Hắc Vân rơi/);
assert.ok(prompt.length < 3_950);

const missingShot = buildBriefDrivenFlowShotPrompt({
  brief,
  shotNumber: 4,
  shotId: "SHOT-004",
  revisionId: "rev-001",
  runId: "flow-test-run",
  projectId: "flow-project-test",
  sessionId: null,
  durationSeconds: 5,
  maxDurationSeconds: 10,
});
assert.equal(missingShot, null);
assert.equal(isRepeatedBriefShotTemplate(subject, visualPrompt, "A generic dinosaur scene"), false);

// --- Omni per-shot prose: the paid prompt carries shot identity, one
// continuous shot, real per-shot context and the explicit reference role ---
const boundPrompt = buildBriefDrivenFlowShotPrompt({
  brief,
  shotNumber: 2,
  shotId: "SHOT-002",
  revisionId: "rev-001",
  runId: "flow-test-run",
  projectId: "flow-project-test",
  sessionId: "local-test-session",
  durationSeconds: 5,
  maxDurationSeconds: 10,
  shotReference: { role: "start_frame" },
});
assert.ok(boundPrompt, "a bound reference still compiles a prompt");
assert.match(boundPrompt, /Use the attached image as this shot's starting frame\/identity\/composition reference/);
assert.match(boundPrompt, /role: start_frame/, "the selected role names itself in the prompt");
assert.match(boundPrompt, /SHOT_ID: SHOT-002 \| REVISION_ID: rev-001 \| RUN_ID: flow-test-run/);
assert.match(boundPrompt, /PROJECT_IDENTITY: flow-project-test/);
assert.match(boundPrompt, /SESSION_ID: local-test-session/);
assert.match(boundPrompt, /DURATION: 5\.00 seconds/);
assert.match(boundPrompt, /CONTINUITY FROM PREVIOUS SHOT:/, "continuity is anchored to the previous shot");
assert.match(boundPrompt, /bàn chân Hắc Vân bước qua bùn/, "the previous shot's own action is the continuity anchor");

const unboundPrompt = buildBriefDrivenFlowShotPrompt({
  brief,
  shotNumber: 2,
  shotId: "SHOT-002",
  revisionId: "rev-001",
  runId: "flow-test-run",
  projectId: "flow-project-test",
  sessionId: "local-test-session",
  durationSeconds: 5,
  maxDurationSeconds: 10,
});
assert.ok(unboundPrompt);
assert.doesNotMatch(unboundPrompt, /Use the attached image as this shot's starting frame\/identity\/composition reference/, "an unbound shot never claims an attached image");
assert.match(unboundPrompt, /no bound reference image/);
assert.match(unboundPrompt, /do not invent/);

for (const compiled of [boundPrompt, unboundPrompt]) {
  assert.match(compiled, /exactly one standalone video shot/);
  assert.match(compiled, /one continuous unbroken shot/);
  assert.match(compiled, /no scene cuts/);
  assert.match(compiled, /no unrelated subject/);
  assert.match(compiled, /no extra voice-over/);
  assert.ok(compiled.length <= 3_950, "the local prompt cap still holds");
  // Nothing that names a local file, a Windows path or the provider's own
  // ingredient tag may ever reach the paid prompt.
  assert.doesNotMatch(compiled, /@Image/i);
  assert.doesNotMatch(compiled, /[A-Za-z]:[\\/]/, "no absolute Windows path");
  assert.doesNotMatch(compiled, /\.(?:png|jpe?g|webp|mp4|mov)\b/i, "no local file name");
  assert.doesNotMatch(compiled, /(?:^|[\s(])\.{0,2}[/\\][\w.-]+[/\\][\w.-]+/, "no local relative path");
  assert.doesNotMatch(compiled, /assets\/references/);
}

// Mandatory identity/reference lines are reserved first: a huge optional
// description is compacted instead of the prompt losing its identity lines.
const paddedBrief = brief.replace("Phong cách hình ảnh:", `Phong cách hình ảnh: ${"cinematic volumetric detail ".repeat(400)}`);
const paddedPrompt = buildBriefDrivenFlowShotPrompt({
  brief: paddedBrief,
  shotNumber: 2,
  shotId: "SHOT-002",
  revisionId: "rev-001",
  runId: "flow-test-run",
  projectId: "flow-project-test",
  sessionId: "local-test-session",
  durationSeconds: 5,
  maxDurationSeconds: 10,
  shotReference: { role: "composition" },
});
assert.ok(paddedPrompt, "a long description is trimmed, not rejected");
assert.ok(paddedPrompt.length <= 3_950, `truncated prompt is ${paddedPrompt?.length} chars`);
assert.match(paddedPrompt, /SHOT_ID: SHOT-002 \| REVISION_ID: rev-001 \| RUN_ID: flow-test-run/, "mandatory identity survives truncation");
assert.match(paddedPrompt, /role: composition/, "the mandatory reference-role line survives truncation");
assert.match(paddedPrompt, /DURATION: 5\.00 seconds/, "the mandatory duration line survives truncation");
assert.match(paddedPrompt, /…/, "the optional description is what got truncated");

// Mandatory lines alone over the cap: a truncated prompt would have lost a
// mandatory line, so no prompt is emitted at all.
assert.equal(
  buildBriefDrivenFlowShotPrompt({
    brief,
    shotNumber: 2,
    shotId: "SHOT-002",
    revisionId: "rev-001",
    runId: "flow-test-run",
    projectId: `proj-${"x".repeat(3_960)}`,
    sessionId: "local-test-session",
    durationSeconds: 5,
    maxDurationSeconds: 10,
    shotReference: { role: "start_frame" },
  }),
  null,
  "mandatory-line overflow returns null instead of a lossy prompt",
);

const oldPrompt = buildBriefDrivenFlowShotPrompt({
  brief,
  shotNumber: 1,
  shotId: "SHOT-001",
  revisionId: "rev-001",
  runId: "flow-test-run",
  projectId: "flow-project-test",
  sessionId: "local-test-session",
  durationSeconds: 4,
  maxDurationSeconds: 10,
});
assert.ok(oldPrompt);
assert.doesNotMatch(oldPrompt, /CONTINUITY FROM PREVIOUS SHOT: Shot 0/, "the opening shot has no invented previous shot");

// --- a brief is prose, not a filesystem -----------------------------------
// Every dynamic value a brief contributes is typed into a paid Flow composer.
// A brief that names a local file, a workspace folder or the provider's own
// ingredient tag must lose those tokens; ordinary prose must survive whole.
const DIRTY_BRIEF = `Nhân vật chính duy nhất là Hắc Vân, một hổ Bengal đực, nạp từ C:\\Users\\Alice\\Pictures\\start.png.

Mở đầu trong khu rừng nhiệt đới hiện đại lúc hoàng hôn.

Shot 01: Hắc Vân bước qua bùn, dựa trên @Image1 và @Video2 đã gắn sẵn.

Phong cách hình ảnh: cinematic 3D photorealistic, nguồn assets/references/shot-001.png, bản xuất ở outputs/shot-001.png và .auto3dvideo/runs/flow-test/.

Giữ continuity tuyệt đối: Hắc Vân luôn là cùng một con hổ Bengal.`;

const dirtyPrompt = buildBriefDrivenFlowShotPrompt({
  brief: DIRTY_BRIEF,
  shotNumber: 1,
  shotId: "SHOT-001",
  revisionId: "rev-001",
  runId: "flow-test-run",
  projectId: "flow-project-test",
  sessionId: "local-test-session",
  durationSeconds: 4,
  maxDurationSeconds: 10,
});
assert.ok(dirtyPrompt, "a brief carrying local tokens still compiles a prompt");
for (const [label, pattern] of [
  ["an absolute Windows path", /[A-Za-z]:[\\/]/],
  ["a bare local file name", /\.(?:png|jpe?g|webp|gif|bmp|mp4|mov|webm|mkv)\b/i],
  ["a local relative workspace path", /(?:assets|outputs)[\\/]|\.auto3dvideo[\\/]/],
  ["a provider media tag", /@(?:Image|Video|Audio)\d*/i],
]) {
  assert.doesNotMatch(dirtyPrompt, pattern, `${label} reaches the paid prompt: ${dirtyPrompt}`);
}
assert.match(dirtyPrompt, /Hắc Vân bước qua bùn/, "the shot's own prose survives sanitizing");
assert.match(dirtyPrompt, /cinematic 3D photorealistic/, "ordinary style prose survives sanitizing");
assert.match(dirtyPrompt, /một hổ Bengal đực/, "the character line survives sanitizing");
assert.match(dirtyPrompt, /Giữ continuity tuyệt đối/, "the continuity line survives sanitizing");

// A clean brief is untouched: every extracted value is compiled verbatim.
const cleanContext = extractFlowShotBriefContext(brief, 2);
assert.ok(cleanContext);
for (const value of [cleanContext.character, cleanContext.openingSetting, cleanContext.shot, cleanContext.style, cleanContext.continuity]) {
  assert.ok(prompt.includes(value), `a clean brief value is compiled verbatim: ${value}`);
}

// --- the sanitizer itself, on the same inputs -----------------------------
for (const [label, value] of [
  ["an absolute Windows path", "mở đầu từ C:\\Users\\Alice\\start.png"],
  ["a forward-slash Windows path", "mở đầu từ C:/Users/Alice/start.png"],
  ["a UNC share", "nguồn \\\\fileserver\\media\\shot.png"],
  ["a macOS home path", "nguồn /Users/alice/Pictures/shot.png"],
  ["a POSIX home path", "nguồn /home/alice/shot.png"],
  ["a workspace assets folder", "nguồn assets/references/shot-001.png"],
  ["a workspace outputs folder", "lưu ở outputs/shot-001.mp4"],
  ["the app's own run folder", "lưu ở .auto3dvideo/runs/flow-test/prompt.txt"],
  ["a provider image tag", "dùng @Image1 làm tham chiếu"],
  ["a bare provider image tag", "dùng @Image làm tham chiếu"],
  ["a provider video tag", "dùng @Video2 làm tham chiếu"],
  ["a bare local file name", "tệp shot-001.png"],
  ["a Linux root path", "source /root/private/scene-notes.txt"],
  ["a Linux root file", "nguồn /root/notes.txt"],
  ["a punctuation-adjacent POSIX path", "nguồn:/root/notes.txt"],
  ["a punctuation-adjacent workspace path", "nguồn:assets/references/shot-001.png"],
  ["an extensionless workspace path", "nguồn outputs/current-run"],
  ["a dot-prefixed workspace path", "nguồn .\\assets/references/shot-001.png"],
  ["an input workspace media file", "nguồn input/references/shot.png"],
  ["a Windows path after ordinary prose", "xem tại C:\\Users\\a\\b.png"],
  ["a colon-adjacent Windows path", "nguồn:C:\\Users\\a\\b.png"],
]) {
  const cleaned = sanitizeFlowShotPromptProse(value);
  assert.ok(cleaned.length <= 600, `the sanitizer bounds its result: ${label} -> ${cleaned.length} chars`);
  assert.doesNotMatch(cleaned, /[A-Za-z]:[\\/]|\\\\|\/(?:Users|home)\//, `a local path survives sanitizing: ${label}`);
  assert.doesNotMatch(cleaned, /(?:assets|outputs|refs|inputs?)[\\/]|\.auto3dvideo[\\/]/i, `a workspace path survives sanitizing: ${label}`);
  assert.doesNotMatch(cleaned, /@(?:Image|Video|Audio)\d*/i, `a provider media tag survives sanitizing: ${label}`);
  assert.doesNotMatch(cleaned, /\.(?:png|jpe?g|webp|gif|bmp|mp4|mov|webm|mkv)\b/i, `a local file name survives sanitizing: ${label}`);
  assert.ok(cleaned.length < value.length, `sanitizing removed something: ${label}`);
}

// Ordinary prose is returned unchanged, including the punctuation that only
// looks path-like: "16:9" is a ratio, not a drive letter, and "2.5 stops" is
// not a file name.
for (const value of [
  "Hắc Vân đi giữa mưa lớn; camera push-in chậm 50mm, 16:9, 720p, 8s.",
  "Continuity tuyệt đối: giữ đúng sẹo trên mắt phải của hổ Bengal.",
  "A/B test hướng sáng, dịch sắc độ nhẹ, nhiệt độ 5600K xuyên cảnh.",
  "Dramatic volumetric lighting, wet fur and realistic movement.",
  "input/output hướng sáng",
  "and/or creative framing",
]) {
  assert.equal(sanitizeFlowShotPromptProse(value), value, `clean prose must survive untouched: ${value}`);
}
assert.equal(
  sanitizeFlowShotPromptProse("nguồn:/root/notes.txt"),
  "nguồn:",
  "the user-authored prefix before an absolute path remains intact",
);
assert.equal(
  sanitizeFlowShotPromptProse("nguồn:C:\\Users\\a\\b.png"),
  "nguồn:",
  "a drive path after a colon preserves the Vietnamese prefix",
);
assert.equal(sanitizeFlowShotPromptProse(""), "");
assert.equal(sanitizeFlowShotPromptProse("mưa\r\n\n  lớn   gió"), "mưa lớn gió", "whitespace is collapsed");
const longProse = `prose ${"x".repeat(2_000)}`;
assert.equal(sanitizeFlowShotPromptProse(longProse).length, 600, "an oversized value is bounded");
assert.match(sanitizeFlowShotPromptProse(longProse), /…$/, "a bounded value says so");
console.log("Flow shot prompt regression checks passed.");
