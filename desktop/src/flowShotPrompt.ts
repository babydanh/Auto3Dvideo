export type FlowShotBriefContext = {
  character: string;
  openingSetting: string;
  shot: string;
  style: string;
  continuity: string;
};

/**
 * The only thing the paid prompt may know about a reference: which role the
 * user selected. A local path, a provider tag or any attachment claim the
 * worker has not verified back never reaches the prompt text.
 */
export type FlowShotPromptReference = {
  role: string;
};

export type BriefDrivenFlowShotPromptInput = {
  brief: string;
  shotNumber: number;
  shotId: string;
  revisionId: string;
  runId: string;
  projectId: string;
  sessionId: string | null;
  durationSeconds: number;
  maxDurationSeconds: number;
  shotReference?: FlowShotPromptReference | null;
};

export const MAX_FLOW_SHOT_PROMPT_CHARS = 3_950;

const FLOW_SHOT_SUBMISSION_HEADER = "AUTO3DVIDEO SHOT SUBMISSION — create exactly one standalone video shot; render one continuous unbroken shot with no scene cuts, never a contact sheet, storyboard grid, collage, or repeated placeholder.";

const FLOW_SHOT_TAIL_EXCLUSIONS = "no unrelated subject, no extra voice-over, no on-screen text or logo, no watermark, no contact sheet, no scene cuts.";

export function isRepeatedBriefShotTemplate(subject: string, visualPrompt: string, brief: string): boolean {
  const briefShotCount = [...brief.matchAll(/(?:^|\n)\s*shot\s+\d+\s*:/gi)].length;
  const firstShotSourceMarker = /(?:^|\n)\s*shot\s+0*1\s*:/i;
  return briefShotCount >= 2
    && /topic grounding:/i.test(subject)
    && /role contract/i.test(visualPrompt)
    && firstShotSourceMarker.test(visualPrompt);
}

export function extractFlowShotBriefContext(brief: string, shotNumber: number): FlowShotBriefContext | null {
  const source = brief.trim();
  if (!source || !Number.isSafeInteger(shotNumber) || shotNumber < 1) return null;

  const shotMatches = [...source.matchAll(/(?:^|\n)\s*shot\s+(\d+)\s*:\s*/gi)];
  const index = shotMatches.findIndex((match) => Number(match[1]) === shotNumber);
  if (index < 0) return null;

  const marker = shotMatches[index];
  const contentStart = (marker.index ?? 0) + marker[0].length;
  const nextMarker = shotMatches[index + 1];
  const styleStart = source.search(/(?:phong cách hình ảnh|visual style)\s*:/i);
  const contentEnd = Math.min(
    nextMarker?.index ?? Number.POSITIVE_INFINITY,
    styleStart >= 0 ? styleStart : Number.POSITIVE_INFINITY,
    source.length,
  );
  const shot = source.slice(contentStart, contentEnd).trim();
  const character = source.match(/(?:nhân vật chính duy nhất|nhân vật chính|main character|protagonist)\s*[:：]?\s*[\s\S]*?(?=\n\s*\n|$)/i)?.[0]?.trim() ?? "";
  const openingText = source.match(/(?:mở đầu|opening)(?:\s+scene)?\s*[:：]?\s*([^\n]+)/i)?.[1] ?? "";
  const openingSetting = openingText.match(/^[^.!?]+[.!?]?/)?.[0]?.trim() ?? "";
  const continuityStart = source.search(/(?:giữ continuity(?: tuyệt đối)?|continuity(?: bible| rules)?)\s*[:：]/i);
  const style = styleStart >= 0
    ? source.slice(styleStart, continuityStart >= 0 ? continuityStart : source.length).trim()
    : "";
  const continuity = continuityStart >= 0 ? source.slice(continuityStart).trim() : "";

  if (!shot || !character || !style || !continuity) return null;
  return { character, openingSetting, shot, style, continuity };
}

function compactFlowShotLine(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/**
 * The single reference sentence. With a confirmed binding it names the role
 * the user chose; without one it says plainly that nothing is bound, so the
 * prompt never implies an attachment nobody verified.
 */
export function flowShotReferenceLine(reference?: FlowShotPromptReference | null) {
  // The role is a label the user picked, but it is still a value interpolated
  // into a paid prompt, so it gets the same treatment as any other prose: a
  // role that carries nothing but a local path names no bound reference.
  const role = sanitizeFlowShotPromptProse(reference?.role, MAX_FLOW_SHOT_ROLE_CHARS);
  return role
    ? `REFERENCE: Use the attached image as this shot's starting frame/identity/composition reference (role: ${role}).`
    : "REFERENCE: this shot has no bound reference image; do not invent or assume any attached image.";
}

export function flowShotExclusionLine(negativePrompt = "") {
  const negative = sanitizeFlowShotPromptProse(negativePrompt, MAX_FLOW_SHOT_NEGATIVE_CHARS);
  return `EXCLUDE: ${negative ? `${negative}; ` : ""}${FLOW_SHOT_TAIL_EXCLUSIONS}`;
}

/**
 * How much one dynamic value may contribute to a paid prompt. The whole
 * submission is capped at 3,950 characters, so a single brief value longer
 * than this could only ever be truncated into noise.
 */
export const MAX_FLOW_SHOT_PROSE_CHARS = 600;

// A role is a short label and a negative prompt is one line of the same brief;
// the role is bounded well below the general prose bound to keep a long one
// from crowding out the description, and the negative prompt keeps the 600
// characters the script branch has always allowed it.
const MAX_FLOW_SHOT_ROLE_CHARS = 80;
const MAX_FLOW_SHOT_NEGATIVE_CHARS = 600;

// Everything below is a local fact or a provider claim, not shot prose. A
// brief is written by a person against a local workspace, so it routinely
// names the file it was drafted from, and an API tag typed into a composer is
// an instruction the model would act on rather than a description of a shot.
// Each rule is token-shaped so ordinary prose that only resembles a path
// ("16:9", "2.5 stops", "A/B take") is left exactly as written.
const FLOW_SHOT_PROSE_LOCAL_TOKENS: RegExp[] = [
  // Provider ingredient tags, bare or numbered: @Image, @Image1, @Video2.
  /@(?:Image|Video|Audio|Text)\d*/gi,
  // A Windows UNC share: \\server\share\...
  /\\\\[\w.-]+(?:[\\/][^\\/\s"']+)+/g,
  // A Windows absolute path in either separator: C:\Users\..., C:/Users/...
  /(?<![\p{L}\p{N}_])[A-Za-z]:[\\/][^\s"']*/gu,
  // A POSIX absolute path under known system roots. Require a path boundary so
  // a later slash in ordinary prose cannot turn into a partial path match.
  /(?<![\w./\\-])\/(?:Users|home|var|opt|tmp|private|Volumes|mnt|srv|etc|usr|media|root|data|app|workspace|Library|System|proc|dev|run|boot|bin|sbin|lib|snap)\/[^\s"']*/g,
  // Known workspace directories are path anchors; exclude generic "input"
  // so prose like "input/output" stays untouched.
  /(?<![\w./\\-])(?:\.{1,2}[\\/])?(?:assets|outputs|refs|\.auto3dvideo)[\\/][^\s"']*/gi,
  // "input" is only an anchor when the remaining token is a known local file.
  /(?<![\w./\\-])(?:\.{1,2}[\\/])?inputs?[\\/][^\s"']+\.(?:png|jpe?g|webp|gif|bmp|tiff|mp4|mov|webm|mkv|avi|txt|json|ya?ml)\b/gi,
  // A bare local media file name: shot-002.png, take-01.mp4.
  /\b[\w-]{2,}\.(?:png|jpe?g|webp|gif|bmp|tiff|mp4|mov|webm|mkv|avi)\b/gi,
];

const FLOW_SHOT_CONTROL_CHARS = new RegExp(
  "[\\u0000-\\u001f\\u007f]",
  "g",
);

/**
 * The one place a dynamic value becomes paid-prompt prose. A local path, a
 * workspace folder, a bare media file name or a provider ingredient tag is
 * removed outright rather than neutralised, because there is no reading of
 * "C:\Users\Alice\start.png" inside a shot description. What survives is
 * collapsed, control-stripped and bounded, and a value that carries none of
 * these tokens is returned exactly as it was written.
 */
export function sanitizeFlowShotPromptProse(
  value: string | null | undefined,
  maxLength: number = MAX_FLOW_SHOT_PROSE_CHARS,
): string {
  let text = String(value ?? "").replace(FLOW_SHOT_CONTROL_CHARS, " ");
  for (const token of FLOW_SHOT_PROSE_LOCAL_TOKENS) text = text.replace(token, " ");
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/**
 * Mandatory identity and reference lines are reserved first. Only the optional
 * description is compacted to fit, and a mandatory set that cannot fit at all
 * yields no prompt: a truncated prompt that lost a mandatory line would claim
 * a shot identity it no longer carries.
 */
export function assembleFlowShotPrompt(mandatory: string[], optional: string[]): string | null {
  const mandatoryText = mandatory.map((line) => line.trim()).filter(Boolean).join("\n");
  if (mandatoryText.length > MAX_FLOW_SHOT_PROMPT_CHARS) return null;
  const optionalLines = optional.map((line) => line.trim()).filter(Boolean);
  if (!optionalLines.length) return mandatoryText;
  // Reserve one separator per surviving optional line before compacting.
  let remaining = MAX_FLOW_SHOT_PROMPT_CHARS - mandatoryText.length - optionalLines.length;
  if (remaining <= 0) return mandatoryText;
  const kept: string[] = [];
  for (const line of optionalLines) {
    const text = remaining > 0 ? compactFlowShotLine(line, remaining) : "";
    remaining -= text.length;
    if (text) kept.push(text);
  }
  return [mandatoryText, ...kept].join("\n");
}

export function buildBriefDrivenFlowShotPrompt(input: BriefDrivenFlowShotPromptInput): string | null {
  const context = extractFlowShotBriefContext(input.brief, input.shotNumber);
  if (!context) return null;
  const previousShot = input.shotNumber > 1
    ? sanitizeFlowShotPromptProse(extractFlowShotBriefContext(input.brief, input.shotNumber - 1)?.shot)
    : "";
  // Everything below is text a person wrote against a local workspace, and
  // all of it is typed into a paid composer, so it is prose and nothing else.
  const character = sanitizeFlowShotPromptProse(context.character);
  const openingSetting = sanitizeFlowShotPromptProse(context.openingSetting);
  const shot = sanitizeFlowShotPromptProse(context.shot);
  const style = sanitizeFlowShotPromptProse(context.style);
  const continuity = sanitizeFlowShotPromptProse(context.continuity);

  const mandatory = [
    FLOW_SHOT_SUBMISSION_HEADER,
    `SHOT_ID: ${input.shotId} | REVISION_ID: ${input.revisionId} | RUN_ID: ${input.runId}`,
    `PROJECT_IDENTITY: ${input.projectId || "UNVERIFIED — do not submit until the current Flow project URL is verified"}`,
    `SESSION_ID: ${input.sessionId || "local-session"}`,
    `DURATION: ${input.durationSeconds.toFixed(2)} seconds (must be <= ${input.maxDurationSeconds}s); keep this shot separate and in story order.`,
    flowShotReferenceLine(input.shotReference),
  ];
  const optional = [
    `SOURCE CHARACTER / SUBJECT: ${character}`,
    openingSetting ? `OPENING SETTING: ${openingSetting}` : "",
    `SHOT ${input.shotNumber}: ${shot}`,
    `ENVIRONMENT: ${openingSetting || "keep the world exactly as this shot's own text describes"}`,
    `CAMERA / LENS: hold this shot's own framing for the whole take; no cut, no reframing, no second angle`,
    `LIGHT / STYLE: ${style}`,
    previousShot
      ? `CONTINUITY FROM PREVIOUS SHOT: shot ${input.shotNumber - 1} ended with "${previousShot}"; continue from that exact subject, world, screen direction and light into this shot's new action.`
      : "CONTINUITY FROM PREVIOUS SHOT: this is the opening shot; establish the subject identity, world, screen direction and light that every later shot continues.",
    `CONTINUITY: ${continuity}`,
    flowShotExclusionLine(),
    "Render only the action described for this shot. Preserve the primary subject and supporting subjects as specified in the source brief.",
  ];
  return assembleFlowShotPrompt(mandatory, optional);
}
