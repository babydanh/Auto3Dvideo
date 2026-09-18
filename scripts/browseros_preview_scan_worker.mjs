import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// This worker uses the user's already-running BrowserOS session through MCP.
// It deliberately keeps one visible tab and only reads public discovery pages.
const DEFAULT_ENDPOINT = "http://127.0.0.1:9000/mcp";
const REQUEST_TIMEOUT_MS = 30_000;
const NAVIGATION_TIMEOUT_MS = 25_000;
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_PLATFORM_RESULTS = 200;
const MAX_PLATFORMS = 9;
const MAX_SCROLLS = 8;
const MAX_SNAPSHOT_CHARS = 90_000;
const SECRET_MARKERS = [
  "api_key=",
  "apikey=",
  "access_token=",
  "authorization:",
  "bearer ",
  "client_secret=",
  "password=",
  "secret=",
  "token=",
];

const PLATFORM_CONFIG = Object.freeze({
  tiktok: { label: "TikTok", host: "tiktok.com", discoveryUrl: "https://www.tiktok.com/explore" },
  douyin: { label: "Douyin", host: "douyin.com", discoveryUrl: "https://www.douyin.com/discover" },
  kuaishou: { label: "Kuaishou", host: "kuaishou.com", discoveryUrl: "https://www.kuaishou.com/hot" },
  xiaohongshu: { label: "Xiaohongshu", host: "xiaohongshu.com", discoveryUrl: "https://www.xiaohongshu.com/explore" },
  bilibili: { label: "Bilibili", host: "bilibili.com", discoveryUrl: "https://www.bilibili.com/v/popular/all" },
  xigua: { label: "Xigua / 西瓜视频", host: "ixigua.com", discoveryUrl: "https://www.ixigua.com/channel/" },
  huoshan: { label: "Huoshan / 火山版", host: "huoshan.com", discoveryUrl: "https://www.huoshan.com/" },
  weishi: { label: "Weishi / 微视", host: "weishi.qq.com", discoveryUrl: "https://weishi.qq.com/" },
  haokan: { label: "Haokan / 好看视频", host: "haokan.baidu.com", discoveryUrl: "https://haokan.baidu.com/" },
});

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name) {
  const value = arg(name);
  if (!value) throw new Error(`Thiếu ${name}`);
  return value;
}

function safeText(value, field, max = 512) {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) {
    throw new Error(`${field} không hợp lệ`);
  }
  const lowered = value.toLowerCase();
  if (SECRET_MARKERS.some((marker) => lowered.includes(marker))) {
    throw new Error(`${field} có dấu hiệu credential`);
  }
  return value.trim();
}

function safePageId(value) {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 0 || page > 2 ** 31 - 1) throw new Error("pageId không hợp lệ");
  return page;
}

function boundedDetail(value, max = 900) {
  return String(value || "")
    .replace(/(api[_-]?key|access[_-]?token|authorization|password|secret|token)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function contentText(result) {
  return (Array.isArray(result?.content) ? result.content : [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function parseSse(text, id) {
  const plain = String(text).trim();
  if (plain.startsWith("{") || plain.startsWith("[")) {
    const response = JSON.parse(plain);
    if (response.error) throw new Error(`BrowserOS MCP ${response.error.code ?? "error"}: ${boundedDetail(response.error.message)}`);
    return response.result ?? response;
  }
  const responses = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try {
      const item = JSON.parse(line.slice(5).trim());
      if (item?.id === id) responses.push(item);
    } catch {
      // Keep reading keepalive or non-JSON SSE frames.
    }
  }
  const response = responses.at(-1);
  if (!response) throw new Error("BrowserOS MCP không trả JSON-RPC response");
  if (response.error) throw new Error(`BrowserOS MCP ${response.error.code ?? "error"}: ${boundedDetail(response.error.message)}`);
  return response.result ?? response;
}

function extractJson(text) {
  const plain = String(text || "").trim();
  if (!plain) return null;
  try {
    return JSON.parse(plain);
  } catch {
    // BrowserOS may prefix evaluated JSON with a short label.
  }
  for (let start = 0; start < plain.length; start += 1) {
    if (plain[start] !== "{" && plain[start] !== "[") continue;
    for (let end = plain.length; end > start; end -= 1) {
      if (plain[end - 1] !== "}" && plain[end - 1] !== "]") continue;
      try {
        return JSON.parse(plain.slice(start, end));
      } catch {
        // Try the next balanced-looking suffix.
      }
    }
  }
  return null;
}

function extractPageUrl(text, page) {
  const escaped = String(page).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text).match(new RegExp(`(?:^|\\n)\\[${escaped}\\]\\s+(https:\\/\\/\\S+)`));
  return match ? match[1].replace(/[)\],]+$/, "") : null;
}

function parseTabs(text) {
  const own = String(text).split("Other agents' tabs:")[0];
  return [...own.matchAll(/\[(\d+)\]\s+(https:\/\/\S+)/g)].map((match) => ({
    page: Number(match[1]),
    url: match[2].replace(/[)\],]+$/, ""),
  }));
}

function hostnameMatches(hostname, config) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  return host === config.host || host.endsWith(`.${config.host}`);
}

function safeDiscoveryUrl(value, config) {
  const parsed = new URL(safeText(value, "discovery URL", 600));
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash || !hostnameMatches(parsed.hostname, config)) {
    throw new Error(`${config.label} discovery URL không nằm trong host allowlist`);
  }
  return parsed.toString();
}

function canonicalVideoUrl(value, config) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !hostnameMatches(parsed.hostname, config)) return null;
    if (!isVideoPath(parsed.pathname, parsed.hostname)) return null;
    parsed.search = "";
    parsed.hash = "";
    if (parsed.pathname.length < 2 || parsed.pathname === "/") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function safeThumbnailUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    if (["token", "access_token", "api_key", "apikey", "signature", "sig"].some((key) => parsed.searchParams.has(key))) return null;
    return parsed.toString().slice(0, 2_000);
  } catch {
    return null;
  }
}

function isVideoPath(pathname, hostname = "") {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  const path = String(pathname || "").split(/[?#]/, 1)[0];
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    return /\/@[^/]+\/video\/\d{6,}/i.test(path) || /\/video\/\d{6,}/i.test(path);
  }
  if (host === "douyin.com" || host.endsWith(".douyin.com")) {
    return /\/(?:video|note)\/\d{6,}/i.test(path);
  }
  if (host === "kuaishou.com" || host.endsWith(".kuaishou.com")) {
    return /\/(?:short-video|photo)\/[A-Za-z0-9_-]{6,}/i.test(path);
  }
  if (host === "xiaohongshu.com" || host.endsWith(".xiaohongshu.com")) {
    return /\/explore\/[A-Za-z0-9_-]{12,}/i.test(path) || /\/discovery\/item\/[A-Za-z0-9_-]{12,}/i.test(path);
  }
  if (host === "bilibili.com" || host.endsWith(".bilibili.com")) {
    return /\/video\/(?:BV[A-Za-z0-9]{6,20}|av\d{6,})/i.test(path) || /\/(?:av\d{6,}|BV[A-Za-z0-9]{6,20})/i.test(path);
  }
  if (host === "ixigua.com" || host.endsWith(".ixigua.com")) {
    return /\/video\/\d{6,}/i.test(path) || /\/i\d{6,}/i.test(path);
  }
  if (host === "huoshan.com" || host.endsWith(".huoshan.com")) {
    return /\/video\/\d{6,}/i.test(path);
  }
  if (host === "weishi.qq.com" || host.endsWith(".weishi.qq.com")) {
    return /\/(?:video|detail)\/[A-Za-z0-9_-]{8,}/i.test(path);
  }
  if (host === "haokan.baidu.com" || host.endsWith(".haokan.baidu.com")) {
    return /\/(?:v|video)\/[A-Za-z0-9_-]{8,}/i.test(path);
  }
  return false;
}

function normalizedWords(value) {
  return new Set(String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter((word) => word.length > 1).slice(0, 32));
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function metricScore(metrics) {
  return Object.values(metrics || {}).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

function formatMetricEvidence(metrics) {
  return Object.entries(metrics || {})
    .filter(([, value]) => Number.isFinite(value) && value >= 0)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

const TOPIC_RULES = [
  { topic: "technology", needles: ["ai", "artificial intelligence", "robot", "tech", "coding", "computer", "科技", "人工智能", "机器", "技术", "công nghệ", "trí tuệ nhân tạo"] },
  { topic: "knowledge", needles: ["how", "why", "fact", "science", "history", "explained", "knowledge", "科普", "科学", "历史", "知识", "giải thích", "khoa học", "kiến thức"] },
  { topic: "story", needles: ["story", "storytime", "documentary", "document", "journey", "真实", "故事", "纪录片", "câu chuyện", "tư liệu", "hành trình"] },
  { topic: "nature", needles: ["nature", "ocean", "forest", "animal", "space", "earth", "wildlife", "自然", "海洋", "森林", "动物", "太空", "thiên nhiên", "biển", "rừng", "động vật", "vũ trụ"] },
  { topic: "lifestyle", needles: ["food", "travel", "home", "fashion", "beauty", "recipe", "美食", "旅行", "生活", "ẩm thực", "du lịch", "đời sống", "nhà cửa", "làm đẹp"] },
  { topic: "entertainment", needles: ["music", "dance", "comedy", "funny", "movie", "game", "音乐", "舞蹈", "搞笑", "娱乐", "giải trí", "nhạc", "nhảy", "hài"] },
  { topic: "sports", needles: ["sport", "football", "soccer", "basketball", "体育", "足球", "篮球", "thể thao", "bóng đá", "bóng rổ"] },
];

function classifyTopic(card) {
  const text = `${card.title || ""} ${card.author || ""} ${(card.observedSignals || []).join(" ")}`.toLowerCase();
  const match = TOPIC_RULES.find((rule) => rule.needles.some((needle) => text.includes(needle)));
  return match
    ? { topic: match.topic, evidence: `Từ khóa/chủ đề quan sát được: ${match.needles.find((needle) => text.includes(needle))}` }
    : { topic: "other", evidence: "Chưa đủ tín hiệu để gán chủ đề cụ thể" };
}

function remixPotential(card, buckets, topic) {
  let score = 30;
  const evidence = [];
  if (topic !== "other") {
    score += 14;
    evidence.push("có chủ đề rõ để viết voice/subtitle");
  }
  if (String(card.title || "").length >= 24) {
    score += 8;
    evidence.push("title có đủ ngữ cảnh để phát triển hook");
  }
  if (card.thumbnailUrl) {
    score += 7;
    evidence.push("có thumbnail để kiểm tra nhanh");
  }
  if (Object.keys(card.observedMetrics || {}).length) {
    score += 12;
    evidence.push(`có tín hiệu tương tác (${formatMetricEvidence(card.observedMetrics)})`);
  }
  if (buckets.includes("hot_new")) {
    score += 10;
    evidence.push("trang gắn tín hiệu nổi bật");
  }
  if (buckets.includes("rising")) {
    score += 9;
    evidence.push("có tín hiệu đang tăng");
  }
  if (buckets.includes("fresh")) {
    score += 6;
    evidence.push("mới đăng");
  }
  if (buckets.includes("low_clone")) {
    score += 8;
    evidence.push("ít trùng trong lượt quét này");
  }
  return { score: Math.min(score, 100), evidence: evidence.join("; ") || "Chưa có tín hiệu đủ mạnh" };
}

function interleaveTopics(cards) {
  const groups = new Map();
  for (const card of cards) {
    const topic = card.topic || "other";
    if (!groups.has(topic)) groups.set(topic, []);
    groups.get(topic).push(card);
  }
  const orderedGroups = [...groups.entries()].sort((left, right) => right[1].length - left[1].length).map(([, items]) => items);
  const output = [];
  let index = 0;
  while (orderedGroups.some((items) => items.length)) {
    for (const items of orderedGroups) {
      if (items.length) output.push(items.shift());
    }
    index += 1;
    if (index > cards.length) break;
  }
  return output;
}

function assignRadarBuckets(cards) {
  const words = cards.map((card) => normalizedWords(card.title));
  const duplicateCounts = cards.map((card, index) => cards.reduce((count, other, otherIndex) => {
    if (index === otherIndex) return count;
    if (card.thumbnailUrl && other.thumbnailUrl && card.thumbnailUrl === other.thumbnailUrl) return count + 1;
    return count + (jaccard(words[index], words[otherIndex]) >= 0.78 ? 1 : 0);
  }, 0));
  const metricScores = cards.map((card) => metricScore(card.observedMetrics));
  const rankedScores = metricScores.filter((score) => score > 0).sort((left, right) => left - right);
  const highMetricThreshold = rankedScores.length >= 3 ? rankedScores[Math.floor(rankedScores.length * 0.7)] : 0;
  return cards.map((card, index) => {
    const buckets = [];
    const evidence = [];
    const explicitHot = card.observedSignals.some((signal) => /hot|trend|popular|featured|nổi bật|热门|爆款|推荐/i.test(signal));
    const explicitRising = card.observedSignals.some((signal) => /rising|trending|tăng|上升|热度/i.test(signal));
    const hasMetrics = metricScores[index] > 0;
    const hot = explicitHot || (hasMetrics && metricScores[index] >= highMetricThreshold && highMetricThreshold > 0);
    const rising = explicitRising || (hasMetrics && card.freshSignal && metricScores[index] > 0);
    if (hot) {
      buckets.push("hot_new");
      evidence.push(explicitHot ? "Trang hiển thị tín hiệu nổi bật/trending" : `chỉ số tương tác nằm trong nhóm cao của lượt quét (${formatMetricEvidence(card.observedMetrics)})`);
    }
    if (rising) {
      buckets.push("rising");
      evidence.push(explicitRising ? "Trang hiển thị tín hiệu đang tăng" : "có chỉ số tương tác và metadata mới đăng");
    }
    if (card.freshSignal) {
      buckets.push("fresh");
      evidence.push("metadata thời gian cho biết video mới đăng");
    }
    if (duplicateCounts[index] === 0 && (words[index].size > 1 || card.thumbnailUrl)) {
      buckets.push("low_clone");
      evidence.push("heuristic: tiêu đề/thumbnail không trùng trong lượt quét này; không phải kết luận bản quyền");
    }
    if (!buckets.length) buckets.push("unranked");
    const topicResult = classifyTopic(card);
    const potential = remixPotential(card, buckets, topicResult.topic);
    if (potential.score >= 60) buckets.unshift("potential");
    return {
      ...card,
      radarBuckets: buckets,
      rankingEvidence: evidence.length ? evidence.join("; ") : "Chưa có tín hiệu xếp hạng đủ tin cậy từ trang.",
      topic: topicResult.topic,
      topicEvidence: topicResult.evidence,
      potentialScore: potential.score,
      potentialEvidence: `${potential.evidence}; điểm biên tập cho khả năng chuyển thể, không phải quyền sử dụng`,
    };
  });
}

const EXTRACTION_CODE = String.raw`return (() => {
  const clean = (value, max = 320) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const visible = (node) => {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const number = (value) => {
    const raw = String(value || '').replace(/,/g, '').trim().toLowerCase();
    const match = raw.match(/(\d+(?:\.\d+)?)([kmb万亿]?)\b/);
    if (!match) return null;
    const multiplier = ({ k: 1e3, m: 1e6, b: 1e9, 万: 1e4, 亿: 1e8 })[match[2]] || 1;
    return Math.round(Number(match[1]) * multiplier);
  };
  const currentHost = location.hostname.replace(/^www\./i, '');
  const isVideoPath = (pathname, hostname = currentHost) => {
    const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
    const path = String(pathname || '').split(/[?#]/, 1)[0];
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return /\/@[^/]+\/video\/\d{6,}/i.test(path) || /\/video\/\d{6,}/i.test(path);
    if (host === 'douyin.com' || host.endsWith('.douyin.com')) return /\/(?:video|note)\/\d{6,}/i.test(path);
    if (host === 'kuaishou.com' || host.endsWith('.kuaishou.com')) return /\/(?:short-video|photo)\/[A-Za-z0-9_-]{6,}/i.test(path);
    if (host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com')) return /\/explore\/[A-Za-z0-9_-]{12,}/i.test(path) || /\/discovery\/item\/[A-Za-z0-9_-]{12,}/i.test(path);
    if (host === 'bilibili.com' || host.endsWith('.bilibili.com')) return /\/video\/(?:BV[A-Za-z0-9]{6,20}|av\d{6,})/i.test(path) || /\/(?:av\d{6,}|BV[A-Za-z0-9]{6,20})/i.test(path);
    if (host === 'ixigua.com' || host.endsWith('.ixigua.com')) return /\/video\/\d{6,}/i.test(path) || /\/i\d{6,}/i.test(path);
    if (host === 'huoshan.com' || host.endsWith('.huoshan.com')) return /\/video\/\d{6,}/i.test(path);
    if (host === 'weishi.qq.com' || host.endsWith('.weishi.qq.com')) return /\/(?:video|detail)\/[A-Za-z0-9_-]{8,}/i.test(path);
    if (host === 'haokan.baidu.com' || host.endsWith('.haokan.baidu.com')) return /\/(?:v|video)\/[A-Za-z0-9_-]{8,}/i.test(path);
    return false;
  };
  const videoLike = (href) => {
    try {
      const parsed = new URL(href, location.href);
      return isVideoPath(parsed.pathname, parsed.hostname);
    } catch { return false; }
  };
  const allAnchors = [...document.querySelectorAll('a[href]')].slice(0, 3000);
  let visibleAnchorCount = 0;
  let videoLikeCount = 0;
  const cards = [];
  const seen = new Set();
  const decodeJsonText = (value, max = 320) => clean(String(value || '').replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/\\"/g, '"').replace(/\\u0026/gi, '&'), max);
  const parseVideoUrl = (value) => {
    let parsed;
    try { parsed = new URL(decodeJsonText(value, 2000), location.href); } catch { return null; }
    if (parsed.protocol !== 'https:' || parsed.hostname.replace(/^www\./i, '') !== currentHost || !videoLike(parsed.toString())) return null;
    parsed.search = '';
    parsed.hash = '';
    return parsed;
  };
  const contextField = (context, names, fallback) => {
    const pattern = new RegExp('"(?:' + names.join('|') + ')"\\s*:\\s*"([^"]{2,500})"', 'i');
    return decodeJsonText(context.match(pattern)?.[1] || fallback, 240);
  };
  const contextNumber = (context, names) => {
    const pattern = new RegExp('"(?:' + names.join('|') + ')"\\s*:\\s*(\\d+(?:\\.\\d+)?)', 'i');
    const match = context.match(pattern);
    return match ? number(match[1]) : null;
  };
  for (const anchor of allAnchors) {
    if (visible(anchor)) visibleAnchorCount += 1;
    let parsed;
    try { parsed = new URL(anchor.href, location.href); } catch { continue; }
    if (parsed.protocol !== 'https:' || parsed.hostname.replace(/^www\./i, '') !== currentHost || !videoLike(parsed.toString())) continue;
    videoLikeCount += 1;
    parsed.search = '';
    parsed.hash = '';
    const href = parsed.toString();
    if (seen.has(href)) continue;
    const scope = anchor.closest('article, li, [class*="card"], [class*="item"], [class*="video"], [class*="note"]') || anchor;
    const image = scope.querySelector('img');
    const lines = clean(scope.innerText || anchor.innerText || anchor.getAttribute('aria-label') || anchor.getAttribute('title') || '').split(' | ').filter(Boolean);
    const title = clean(anchor.getAttribute('title') || anchor.getAttribute('aria-label') || image?.alt || lines[0] || 'Chưa đọc tiêu đề', 240);
    const text = clean(scope.innerText || anchor.innerText || title, 500);
    const metrics = {};
    for (const node of [...scope.querySelectorAll('*')].slice(0, 120)) {
      const label = clean(node.getAttribute?.('aria-label') || node.getAttribute?.('title') || node.innerText || '', 120);
      const value = number(label);
      if (value === null) continue;
      if (/view|watched|lượt xem|观看|播放/i.test(label) && metrics.views == null) metrics.views = value;
      else if (/like|thích|点赞/i.test(label) && metrics.likes == null) metrics.likes = value;
      else if (/comment|bình luận|评论/i.test(label) && metrics.comments == null) metrics.comments = value;
      else if (/share|chia sẻ|分享/i.test(label) && metrics.shares == null) metrics.shares = value;
    }
    const timeText = clean([...scope.querySelectorAll('time, [class*="time"], [class*="date"]')].map((node) => node.innerText || node.getAttribute('datetime') || '').join(' '), 120);
    const observedSignals = [text, clean(scope.getAttribute('aria-label') || ''), clean(scope.getAttribute('data-testid') || '')].filter(Boolean).slice(0, 5);
    const author = clean(scope.querySelector('[class*="author"], [class*="user"], [class*="creator"]')?.innerText || '', 120) || 'Chưa đọc người đăng';
    const freshSignal = /\b(?:[0-9]+\s*(?:m|min|minute|h|hour|d|day|ngày|giờ|phút))\b|刚刚|分钟前|小时前|今天|hôm nay|hôm qua/i.test(timeText + ' ' + text);
    seen.add(href);
    cards.push({ href, title, author, thumbnail: image?.currentSrc || image?.src || null, timeText, observedMetrics: metrics, observedSignals, freshSignal });
  }
  const scriptNodes = [...document.scripts].filter((node) => !node.src).slice(0, 180);
  let scriptBytes = 0;
  for (const node of scriptNodes) {
    const source = String(node.textContent || '');
    if (!source || source.length > 600000 || scriptBytes + source.length > 4_000_000) continue;
    scriptBytes += source.length;
    const normalized = source.replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/\\u0026/gi, '&');
    const matches = normalized.matchAll(/https?:\/\/[^"'\s<>]+|\/@[^"'\s<>]+\/video\/\d+|\/(?:video|item|note|short-video)\/[A-Za-z0-9_-]+/gi);
    for (const match of matches) {
      const parsed = parseVideoUrl(match[0].replace(/[),\\]+$/g, ''));
      if (!parsed) continue;
      const href = parsed.toString();
      if (seen.has(href)) continue;
      const start = Math.max(0, Number(match.index || 0) - 420);
      const context = normalized.slice(start, start + 900);
      const thumbnail = contextField(context, ['cover', 'originCover', 'dynamicCover', 'thumbnail', 'image'], '');
      const metrics = {};
      const value = contextNumber(context, ['views', 'viewCount', 'playCount']);
      if (value !== null) metrics.views = value;
      const likeValue = contextNumber(context, ['likes', 'likeCount']);
      if (likeValue !== null) metrics.likes = likeValue;
      const commentValue = contextNumber(context, ['comments', 'commentCount']);
      if (commentValue !== null) metrics.comments = commentValue;
      const shareValue = contextNumber(context, ['shares', 'shareCount']);
      if (shareValue !== null) metrics.shares = shareValue;
      const observedSignals = [];
      if (/hot|trend|popular|featured|nổi bật|thịnh hành|热门|爆款|推荐/i.test(context)) observedSignals.push('script có tín hiệu nổi bật');
      if (/rising|tăng nhanh|đang tăng|上升|热度/i.test(context)) observedSignals.push('script có tín hiệu đang tăng');
      const timeText = contextField(context, ['publishTime', 'createTime', 'date', 'time'], '');
      const freshSignal = /just now|today|hôm nay|mới đăng|刚刚|今天|分钟前|小时前/i.test(context);
      seen.add(href);
      cards.push({ href, title: contextField(context, ['desc', 'title', 'name', 'text'], 'Chưa đọc tiêu đề'), author: contextField(context, ['author', 'nickname', 'username', 'uniqueId', 'userName'], 'Chưa đọc người đăng'), thumbnail, timeText, observedMetrics: metrics, observedSignals, freshSignal });
      if (cards.length >= 240) break;
    }
    if (cards.length >= 240) break;
  }
  return { cards: cards.slice(0, 240), anchorCount: allAnchors.length, visibleAnchorCount, videoLikeCount, cardsFound: cards.length, scriptCount: scriptNodes.length, pageTitle: clean(document.title, 160) };
})();`;

const SCROLL_CODE = "return (() => { const before = window.scrollY; window.scrollBy(0, Math.max(420, Math.floor(window.innerHeight * 0.8))); return { before, after: window.scrollY, height: document.documentElement.scrollHeight }; })();";

class BrowserOsMcp {
  constructor({ endpoint, statePath }) {
    this.endpoint = endpoint;
    this.statePath = statePath;
    this.state = {};
    this.nextId = 1;
    this.sessionId = null;
    this.serverInfo = null;
    this.protocolVersion = null;
    this.tools = [];
  }

  async initialize() {
    this.state = await readJson(this.statePath);
    if (this.state.endpoint && this.state.endpoint !== this.endpoint) this.state = {};
    if (typeof this.state.sessionId === "string") this.sessionId = this.state.sessionId;
    if (this.sessionId) {
      try {
        const listed = await this.call("tools/list", {});
        this.tools = Array.isArray(listed.tools) ? listed.tools.map((item) => item.name).filter(Boolean) : [];
        if (this.tools.length) return;
      } catch {
        this.sessionId = null;
        this.state = {};
      }
    }
    const initialized = await this.call("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "auto3dvideo-preview-radar", version: "1.0.0" },
    }, { includeSession: false });
    this.serverInfo = initialized.serverInfo || null;
    this.protocolVersion = initialized.protocolVersion || null;
    const listed = await this.call("tools/list", {});
    this.tools = Array.isArray(listed.tools) ? listed.tools.map((item) => item.name).filter(Boolean) : [];
    await this.persistState();
  }

  async persistState() {
    await writeJson(this.statePath, {
      schemaVersion: "1.0.0",
      endpoint: this.endpoint,
      sessionId: this.sessionId,
      previewPageId: this.state.previewPageId ?? null,
      pageUrl: this.state.pageUrl ?? null,
      serverInfo: this.serverInfo,
      protocolVersion: this.protocolVersion,
      tools: this.tools.slice(0, 64),
      updatedAt: new Date().toISOString(),
    });
  }

  async call(method, params, options = {}) {
    const id = this.nextId++;
    const headers = { Accept: "application/json, text/event-stream", "Content-Type": "application/json", "Mcp-Protocol-Version": "2025-03-26" };
    if (this.sessionId && options.includeSession !== false) headers["Mcp-Session-Id"] = this.sessionId;
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(this.endpoint, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), signal: controller.signal });
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("BrowserOS MCP response vượt giới hạn");
      if (!response.ok) throw new Error(`BrowserOS MCP HTTP ${response.status}: ${boundedDetail(text)}`);
      const responseSession = response.headers.get("mcp-session-id");
      if (responseSession) this.sessionId = responseSession;
      const result = parseSse(text, id);
      const structuredSession = result?.structuredContent?.session;
      if (typeof structuredSession === "string" && structuredSession.trim()) this.sessionId = structuredSession;
      return result;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`BrowserOS MCP timeout sau ${timeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async tool(name, argumentsValue, options = {}) {
    if (!this.tools.includes(name)) throw new Error(`BrowserOS MCP thiếu tool ${name}`);
    const args = { ...argumentsValue };
    if (this.sessionId) args.session = this.sessionId;
    return this.call("tools/call", { name, arguments: args }, options);
  }

  async listTabs() {
    return this.tool("tabs", { action: "list" });
  }

  async ensurePreviewPage(firstUrl) {
    const tabsResult = await this.listTabs();
    const tabsText = contentText(tabsResult);
    const ownTabs = parseTabs(tabsText);
    const stored = Number.isInteger(this.state.previewPageId) ? ownTabs.find((tab) => tab.page === this.state.previewPageId) : null;
    const adopted = stored || [...ownTabs].reverse().find((tab) => {
      try {
        const parsed = new URL(tab.url);
        return Object.values(PLATFORM_CONFIG).some((config) => hostnameMatches(parsed.hostname, config));
      } catch {
        return false;
      }
    });
    if (adopted) {
      this.state.previewPageId = adopted.page;
      this.state.pageUrl = adopted.url;
      await this.persistState();
      return adopted.page;
    }
    const opened = await this.tool("tabs", { action: "new", url: firstUrl, background: false });
    const openedPage = contentText(opened).match(/opened page (\d+)/i);
    if (!openedPage) throw new Error("BrowserOS MCP không trả page id khi mở tab preview");
    this.state.previewPageId = safePageId(openedPage[1]);
    this.state.pageUrl = firstUrl;
    await this.persistState();
    return this.state.previewPageId;
  }

  async navigate(page, url) {
    await this.tool("navigate", { page, action: "url", url }, { timeoutMs: NAVIGATION_TIMEOUT_MS });
    this.state.pageUrl = url;
    await this.persistState();
  }

  async snapshot(page) {
    return this.tool("snapshot", { page }, { timeoutMs: REQUEST_TIMEOUT_MS });
  }

  async evaluate(page, code) {
    const result = await this.tool("evaluate", { page, code, timeout: 20_000 }, { timeoutMs: REQUEST_TIMEOUT_MS });
    return extractJson(contentText(result));
  }

  async wait(page, milliseconds) {
    if (!this.tools.includes("wait")) return;
    await this.tool("wait", { page, for: "time", value: milliseconds, timeout: milliseconds + 5_000 }, { timeoutMs: milliseconds + 10_000 });
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}

function blockReason(snapshotText) {
  const text = String(snapshotText || "").toLowerCase();
  if (/captcha|verify you are human|prove you are human|robot check|验证码|安全验证|滑动验证|访问受限/.test(text)) {
    return { status: "waiting_user", message: "Nền tảng yêu cầu CAPTCHA/xác minh người dùng; hãy xử lý trực tiếp trong BrowserOS rồi quét lại." };
  }
  if (/log in to continue|login to continue|please sign in|请先登录|请登录后|登录后/.test(text)) {
    return { status: "waiting_user", message: "Nền tảng yêu cầu đăng nhập; hãy đăng nhập trực tiếp trong tab BrowserOS rồi quét lại." };
  }
  if (/too many requests|rate limit|请求过于频繁|访问频繁|temporarily unavailable/.test(text)) {
    return { status: "blocked", message: "Nền tảng đang giới hạn truy cập; worker dừng để tránh lặp request." };
  }
  return null;
}

function normalizeCandidate(raw, platform) {
  const config = PLATFORM_CONFIG[platform];
  const shareUrl = canonicalVideoUrl(raw?.href, config);
  if (!shareUrl) return null;
  const tiktokId = platform === "tiktok" ? shareUrl.match(/\/video\/(\d+)/i)?.[1] : null;
  const title = boundedDetail(raw?.title || "Chưa đọc tiêu đề", 240) || "Chưa đọc tiêu đề";
  const author = boundedDetail(raw?.author || "Chưa đọc người đăng", 120) || "Chưa đọc người đăng";
  const observedMetrics = Object.fromEntries(Object.entries(raw?.observedMetrics || {}).filter(([, value]) => Number.isFinite(value) && value >= 0).slice(0, 8));
  const observedSignals = Array.isArray(raw?.observedSignals) ? raw.observedSignals.map((item) => boundedDetail(item, 160)).filter(Boolean).slice(0, 5) : [];
  return {
    previewId: `preview-${platform}-${hashId(shareUrl)}`,
    platform,
    title,
    author,
    shareUrl,
    embedUrl: tiktokId ? `https://www.tiktok.com/player/v1/${tiktokId}` : null,
    thumbnailUrl: safeThumbnailUrl(raw?.thumbnail),
    scannedAt: new Date().toISOString(),
    addedToPlan: false,
    radarBuckets: [],
    rankingEvidence: "",
    observedMetrics,
    observedSignals,
    freshSignal: raw?.freshSignal === true || Boolean(raw?.timeText && /mới|today|hôm nay|刚刚|分钟前|小时前/i.test(raw.timeText)),
  };
}

function hashId(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function publicCard(card) {
  const { observedMetrics, observedSignals, freshSignal, ...safeCard } = card;
  return safeCard;
}

async function scanPlatform(browser, page, platform, maxResults) {
  const config = PLATFORM_CONFIG[platform];
  const discoveryUrl = safeDiscoveryUrl(config.discoveryUrl, config);
  const collected = new Map();
  await browser.navigate(page, discoveryUrl);
  await browser.wait(page, 3_500);
  const firstSnapshot = await browser.snapshot(page);
  const firstSnapshotText = boundedDetail(contentText(firstSnapshot), MAX_SNAPSHOT_CHARS);
  const blocked = blockReason(firstSnapshotText);
  if (blocked) return { platform, status: blocked.status, scannedCount: 0, discoveryUrl, message: blocked.message, cards: [] };

  let previousHeight = 0;
  let lastDiagnostics = null;
  for (let scroll = 0; scroll <= MAX_SCROLLS && collected.size < maxResults; scroll += 1) {
    const data = await browser.evaluate(page, EXTRACTION_CODE);
    lastDiagnostics = data && typeof data === "object"
      ? { anchorCount: Number(data.anchorCount) || 0, visibleAnchorCount: Number(data.visibleAnchorCount) || 0, videoLikeCount: Number(data.videoLikeCount) || 0, cardsFound: Number(data.cardsFound) || 0, scriptCount: Number(data.scriptCount) || 0 }
      : null;
    const candidates = Array.isArray(data?.cards) ? data.cards : [];
    for (const raw of candidates) {
      const card = normalizeCandidate(raw, platform);
      if (card && !collected.has(card.shareUrl)) collected.set(card.shareUrl, card);
      if (collected.size >= maxResults) break;
    }
    if (collected.size >= maxResults || scroll === MAX_SCROLLS) break;
    const moved = await browser.evaluate(page, SCROLL_CODE);
    await browser.wait(page, 1_700);
    const height = Number(moved?.height) || 0;
    const after = Number(moved?.after) || 0;
    if (after === Number(moved?.before) && height <= previousHeight) break;
    previousHeight = height;
  }
  const cards = [...collected.values()].slice(0, maxResults);
  if (!cards.length) {
    const diagnosticText = lastDiagnostics
      ? " (anchor=" + lastDiagnostics.anchorCount + ", video-like=" + lastDiagnostics.videoLikeCount + ", card=" + lastDiagnostics.cardsFound + ", script=" + lastDiagnostics.scriptCount + ")"
      : " (evaluate không trả metadata)";
    return { platform, status: "blocked", scannedCount: 0, discoveryUrl, message: "Đã mở trang nhưng chưa đọc được card video" + diagnosticText + ". Có thể layout đã đổi hoặc trang yêu cầu người dùng tương tác.", cards: [] };
  }
  return { platform, status: "success", scannedCount: cards.length, discoveryUrl, message: `Đã đọc ${cards.length} card preview công khai trong giới hạn ${maxResults}.`, cards };
}

async function main() {
  const workspace = resolve(process.cwd());
  const output = required("--output");
  const endpoint = process.env.AUTO3DVIDEO_BROWSEROS_MCP_ENDPOINT || DEFAULT_ENDPOINT;
  const platforms = JSON.parse(required("--platforms-json"));
  const maxResults = Number(required("--max-results"));
  if (!Array.isArray(platforms) || !platforms.length || platforms.length > MAX_PLATFORMS || platforms.some((platform) => typeof platform !== "string" || !PLATFORM_CONFIG[platform])) {
    throw new Error("Danh sách nền tảng không hợp lệ");
  }
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_PLATFORM_RESULTS) throw new Error("maxResults phải nằm trong khoảng 1..200");
  const statePath = resolve(workspace, ".auto3dvideo", "browseros", "preview-scan-session.json");
  const browser = new BrowserOsMcp({ endpoint, statePath });
  const runId = safeText(arg("--run-id") || `preview-scan-${Date.now()}`, "runId", 120);
  const reportPath = output.replaceAll("\\", "/");
  const report = {
    schemaVersion: "1.0.0",
    runId,
    status: "blocked",
    worker: "BrowserOS neo · 1 tab tuần tự",
    scanMode: "discovery_all",
    previewOnly: true,
    platforms,
    maxResults,
    platformResults: [],
    cards: [],
    sortMode: "topic_interleave_remix_potential",
    reportPath,
    browserSessionAttached: false,
    networkCallsMade: false,
    message: "Chưa chạy worker.",
  };
  try {
    await browser.initialize();
    const firstConfig = PLATFORM_CONFIG[platforms[0]];
    const page = await browser.ensurePreviewPage(firstConfig.discoveryUrl);
    report.browserSessionAttached = true;
    report.networkCallsMade = true;
    const allCards = [];
    for (const platform of platforms) {
      try {
        const result = await scanPlatform(browser, page, platform, maxResults);
        report.platformResults.push({ ...result, cards: undefined });
        allCards.push(...result.cards);
      } catch (error) {
        const config = PLATFORM_CONFIG[platform];
        report.platformResults.push({ platform, status: "error", scannedCount: 0, discoveryUrl: config.discoveryUrl, message: boundedDetail(error?.message || error) });
      }
    }
    const deduped = [];
    const seen = new Set();
    for (const card of allCards) {
      if (seen.has(card.shareUrl)) continue;
      seen.add(card.shareUrl);
      deduped.push(card);
    }
    report.cards = interleaveTopics(assignRadarBuckets(deduped)).map(publicCard).slice(0, platforms.length * maxResults);
    const successful = report.platformResults.filter((item) => item.status === "success").length;
    const blockedCount = report.platformResults.filter((item) => ["blocked", "waiting_user", "error"].includes(item.status)).length;
    report.status = report.cards.length && blockedCount ? "partial" : report.cards.length ? "success" : "blocked";
    report.message = report.cards.length
      ? `Đã nhận ${report.cards.length} card preview từ ${successful}/${platforms.length} nền tảng. Các nhóm được gắn theo tín hiệu quan sát được.`
      : "Không nhận được card preview. Xem lý do riêng của từng nền tảng bên dưới.";
  } catch (error) {
    report.status = "blocked";
    report.message = boundedDetail(error?.message || error);
  }
  await writeJson(resolve(workspace, reportPath), report);
  if (report.status === "blocked") process.exitCode = 2;
}

main().catch(async (error) => {
  const output = arg("--output");
  if (output) {
    try {
      await writeJson(resolve(process.cwd(), output), { status: "blocked", message: boundedDetail(error?.message || error), cards: [], platformResults: [] });
    } catch {
      // Native supervisor will report the non-zero process and missing output.
    }
  }
  process.stderr.write(`${boundedDetail(error?.stack || error)}\n`);
  process.exitCode = 1;
});
