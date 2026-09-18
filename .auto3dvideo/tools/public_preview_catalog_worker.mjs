#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// This worker reads a fixed public Bilibili catalog endpoint. It is deliberately
// not a general URL fetcher: the native app supplies only the platform and cap.
// No cookies, proxy, stealth flags or CAPTCHA workarounds are used.
const MAX_RESULTS = 200;
const PAGE_SIZE = 50;
const MAX_PAGES = Math.ceil(MAX_RESULTS / PAGE_SIZE);
const REQUEST_TIMEOUT_MS = 20_000;
const PUBLIC_ENDPOINT = "https://api.bilibili.com/x/web-interface/popular";
const TEST_ENDPOINT = process.env.AUTO3DVIDEO_PUBLIC_CATALOG_ENDPOINT;
const TOPIC_RULES = [
  { topic: "technology", needles: ["ai", "人工智能", "科技", "数码", "手机", "电脑", "robot", "công nghệ", "trí tuệ nhân tạo"] },
  { topic: "knowledge", needles: ["科普", "科学", "历史", "知识", "解释", "教程", "how", "why", "science", "khoa học", "kiến thức"] },
  { topic: "story", needles: ["故事", "纪录片", "纪实", "旅行", "故事会", "documentary", "story", "journey", "câu chuyện", "tư liệu"] },
  { topic: "nature", needles: ["自然", "海洋", "森林", "动物", "太空", "地球", "nature", "ocean", "animal", "space", "thiên nhiên", "động vật"] },
  { topic: "lifestyle", needles: ["美食", "旅行", "生活", "时尚", "美容", "家居", "food", "travel", "fashion", "beauty", "ẩm thực", "du lịch", "đời sống"] },
  { topic: "entertainment", needles: ["音乐", "舞蹈", "搞笑", "娱乐", "电影", "游戏", "music", "dance", "comedy", "movie", "game", "giải trí"] },
  { topic: "sports", needles: ["体育", "足球", "篮球", "运动", "sport", "football", "soccer", "basketball", "thể thao", "bóng đá"] },
];

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function safeOutput(value) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw new Error("output không hợp lệ");
  const path = resolve(value);
  const workspace = resolve(process.cwd());
  const windowsChildPrefix = `${workspace}${String.fromCharCode(92)}`;
  if (path !== workspace && !path.startsWith(windowsChildPrefix) && !path.startsWith(`${workspace}/`)) {
    throw new Error("output phải nằm trong workspace");
  }
  return path;
}

function required(name) {
  const value = arg(name);
  if (!value) throw new Error(`Thiếu ${name}`);
  return value;
}

function boundedText(value, max = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function publicEndpoint() {
  if (!TEST_ENDPOINT) return PUBLIC_ENDPOINT;
  if (!/^http:\/\/127\.0\.0\.1(?::\d+)?\/[A-Za-z0-9_/?=&.-]+$/.test(TEST_ENDPOINT)) {
    throw new Error("test endpoint không hợp lệ");
  }
  return TEST_ENDPOINT;
}

function safeThumbnail(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!(host === "bilibili.com" || host.endsWith(".bilibili.com") || host.endsWith(".hdslb.com") || host.endsWith(".biliimg.com"))) return null;
    url.protocol = "https:";
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, 2_000);
  } catch {
    return null;
  }
}

function topicFor(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  const match = TOPIC_RULES.find((rule) => rule.needles.some((needle) => text.includes(needle)));
  return match
    ? { topic: match.topic, evidence: `Tín hiệu chủ đề: ${match.needles.find((needle) => text.includes(needle))}` }
    : { topic: "other", evidence: "Chưa đủ tín hiệu để gán chủ đề cụ thể" };
}

function freshSignal(timestamp) {
  const now = Math.floor(Date.now() / 1000);
  return Number.isFinite(timestamp) && timestamp >= now - 14 * 24 * 60 * 60 && timestamp <= now + 300;
}

function metricScore(metrics) {
  return positiveNumber(metrics.view) + positiveNumber(metrics.like) * 4 + positiveNumber(metrics.reply) * 8 + positiveNumber(metrics.share) * 10;
}

function buildCard(entry, scannedAt) {
  const bvid = typeof entry?.bvid === "string" && /^BV[0-9A-Za-z]{6,20}$/.test(entry.bvid) ? entry.bvid : null;
  if (!bvid) return null;
  const title = boundedText(entry.title) || "Bilibili preview";
  const description = boundedText(entry.desc, 600);
  const author = boundedText(entry.owner?.name || entry.author) || "Không rõ tác giả";
  const metrics = {
    view: positiveNumber(entry.stat?.view),
    like: positiveNumber(entry.stat?.like),
    reply: positiveNumber(entry.stat?.reply),
    share: positiveNumber(entry.stat?.share),
  };
  const metricTotal = metricScore(metrics);
  const fresh = freshSignal(Number(entry.pubdate));
  const topicResult = topicFor(title, description);
  const observedSignals = ["popular_feed"];
  if (fresh) observedSignals.push("fresh");
  const thumbnailUrl = safeThumbnail(entry.pic);
  let score = 38;
  const evidence = ["Bilibili public popular feed"];
  if (topicResult.topic !== "other") {
    score += 14;
    evidence.push("có chủ đề rõ để viết voice/subtitle");
  }
  if (title.length >= 24) {
    score += 8;
    evidence.push("title có đủ ngữ cảnh để phát triển hook");
  }
  if (thumbnailUrl) {
    score += 7;
    evidence.push("có thumbnail để kiểm tra nhanh");
  }
  if (metricTotal > 0) {
    score += 15;
    evidence.push(`có tín hiệu tương tác (view=${metrics.view}, like=${metrics.like})`);
  }
  if (fresh) {
    score += 6;
    evidence.push("mới đăng trong 14 ngày");
  }
  return {
    previewId: `preview-bilibili-${bvid.toLowerCase()}`,
    platform: "bilibili",
    title,
    author,
    shareUrl: `https://www.bilibili.com/video/${bvid}`,
    embedUrl: `https://player.bilibili.com/player.html?bvid=${bvid}&page=1`,
    thumbnailUrl,
    scannedAt,
    addedToPlan: false,
    radarBuckets: ["potential", "hot_new", ...(fresh ? ["fresh"] : [])],
    rankingEvidence: `${evidence.join("; ")}; xếp theo popular feed trong lượt quét này, không phải giấy phép reup.`,
    topic: topicResult.topic,
    topicEvidence: topicResult.evidence,
    potentialScore: Math.min(score, 100),
    potentialEvidence: `${evidence.join("; ")}; đây là điểm shortlist biên tập, không kết luận quyền sử dụng.`,
    reuseStatus: "permission_required",
    reuseEvidence: "URL public không chứng minh quyền sao chép hoặc đăng lại; cần giấy phép hoặc quyền sở hữu.",
    reviewStatus: "unreviewed",
    _metricScore: metricTotal,
    _topic: topicResult.topic,
  };
}

function interleaveTopics(cards) {
  const groups = new Map();
  for (const card of cards) {
    if (!groups.has(card._topic)) groups.set(card._topic, []);
    groups.get(card._topic).push(card);
  }
  const ordered = [...groups.values()].sort((left, right) => right.length - left.length);
  const result = [];
  while (ordered.some((items) => items.length)) {
    for (const items of ordered) if (items.length) result.push(items.shift());
  }
  return result;
}

async function fetchPage(page) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${publicEndpoint()}?ps=${PAGE_SIZE}&pn=${page}`, {
      headers: {
        accept: "application/json",
        referer: "https://www.bilibili.com/v/popular/all",
        "user-agent": "Auto3Dvideo-PublicPreview/1.0",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Bilibili trả HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.code !== 0 || !Array.isArray(payload?.data?.list)) {
      throw new Error(boundedText(payload?.message || "Bilibili public endpoint không trả danh sách video", 180));
    }
    return payload.data.list;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const output = safeOutput(required("--output"));
  const maxRaw = Number(required("--max-results"));
  if (!Number.isInteger(maxRaw) || maxRaw < 1 || maxRaw > MAX_RESULTS) throw new Error("max-results phải trong khoảng 1..200");
  const scannedAt = new Date().toISOString();
  const entries = [];
  const seen = new Set();
  const pages = Math.min(MAX_PAGES, Math.ceil(maxRaw / PAGE_SIZE));
  let errorMessage = "";
  for (let page = 1; page <= pages && entries.length < maxRaw; page += 1) {
    try {
      const pageEntries = await fetchPage(page);
      for (const entry of pageEntries) {
        if (!seen.has(entry?.bvid)) {
          seen.add(entry?.bvid);
          entries.push(entry);
        }
        if (entries.length >= maxRaw) break;
      }
    } catch (error) {
      errorMessage = boundedText(error?.message || error, 300);
      break;
    }
  }
  const cards = interleaveTopics(entries.map((entry) => buildCard(entry, scannedAt)).filter(Boolean)).slice(0, maxRaw);
  cards.sort((left, right) => (right.potentialScore - left.potentialScore) || (right._metricScore - left._metricScore));
  for (const card of cards) {
    delete card._metricScore;
    delete card._topic;
  }
  const status = cards.length > 0 ? "success" : "blocked";
  const report = {
    status,
    worker: "Bilibili · public popular catalog",
    engine: "bilibili_public_catalog",
    scanMode: "discovery_all",
    previewOnly: true,
    platforms: ["bilibili"],
    maxResults: maxRaw,
    sortMode: "popular_feed_topic_interleave_remix_potential",
    platformResults: [{
      platform: "bilibili",
      status,
      scannedCount: cards.length,
      discoveryUrl: "https://www.bilibili.com/v/popular/all",
      message: cards.length > 0
        ? `Đã đọc ${cards.length} card từ public popular feed Bilibili; chưa tải video.`
        : `Bilibili public catalog không trả card hợp lệ${errorMessage ? `: ${errorMessage}` : "."}`,
    }],
    cards,
    browserSessionAttached: false,
    networkCallsMade: true,
    message: cards.length > 0
      ? `Bilibili đã trả ${cards.length} card từ catalog public; hãy xem preview và review quyền trước khi tải.`
      : "Không có card Bilibili hợp lệ; không ghi kết quả giả.",
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2), "utf8");
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || error}\n`);
  process.exitCode = 1;
});
