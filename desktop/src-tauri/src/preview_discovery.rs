use super::asset_library::validate_reference_video_source_url;
use super::tool_readiness::resolve_configured_tool;
use super::voice_tts::project_workspace_and_python;
use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PreviewDiscoveryScanRequest {
    project_id: String,
    platforms: Vec<String>,
    max_results: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PreviewCreatorScanRequest {
    project_id: String,
    platform: String,
    source_url: String,
    max_results: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LicensedFootageScanRequest {
    project_id: String,
    max_results: u32,
}

const PREVIEW_DISCOVERY_PLATFORMS: [&str; 9] = [
    "tiktok",
    "douyin",
    "kuaishou",
    "xiaohongshu",
    "bilibili",
    "xigua",
    "huoshan",
    "weishi",
    "haokan",
];

const OBSCURA_PREVIEW_EVAL: &str = r###"(()=>{const c=(v,n=240)=>String(v??"").replace(/\s+/g," ").trim().slice(0,n);const h=location.hostname.toLowerCase().replace(/^www\./,"");const p=location.pathname.toLowerCase();const video=p.includes("/video/")||p.includes("/item/")||p.includes("/note/")||p.includes("/watch/")||p.includes("/play/")||p.includes("/short-video/")||p.includes("/photo/")||/^\/(?:av|bv)[a-z0-9]/.test(p)||/^\/explore\/[^/]+/.test(p)||/^\/detail\/[^/]+/.test(p)||/^\/[^/]*\d{6,}[^/]*$/.test(p);const text=(e)=>c(e?.innerText||e?.textContent||"",900);const cards=[...document.querySelectorAll("a[href]")].map(a=>{let u;try{u=new URL(a.href,location.href)}catch{return null}const same=u.protocol==="https:"&&u.hostname.toLowerCase().replace(/^www\./,"")===h;if(!same)return null;const root=a.closest("article,li,[class*='card'],[class*='item']")||a.parentElement||a;const body=text(root);const lower=body.toLowerCase();const title=c(a.getAttribute("aria-label")||a.title||root.querySelector("h1,h2,h3,h4,[class*='title']")?.textContent||body,240);const img=root.querySelector("img");const thumb=c(img?.currentSrc||img?.src||img?.getAttribute("data-src")||"",2000);const author=c(root.querySelector("[class*='author'],[class*='user'],[class*='name']")?.textContent||"",120);const observedSignals=[];if(/hot|trending|popular|featured|nổi bật|thịnh hành|热门|爆款|推荐/.test(lower))observedSignals.push("hot");if(/rising|tăng nhanh|đang tăng|上升|热度/.test(lower))observedSignals.push("rising");const freshSignal=/just now|\b\d+\s*(?:m|min|h|hr|hour|d|day)s?\b|vừa đăng|hôm nay|mới đăng|刚刚|今天|分钟|小时/.test(lower);const observedMetrics={};if(/like|thích|喜欢|comment|bình luận|评论|share|chia sẻ|分享|view|lượt xem|播放/.test(lower)&&/\d/.test(lower))observedMetrics.engagement=true;return {shareUrl:u.href,title,author,thumbnailUrl:thumb,timeText:c(body.match(/(?:just now|\d+\s*(?:m|min|h|hr|hour|d|day)s?|vừa đăng|hôm nay|mới đăng|刚刚|今天|分钟|小时)/i)?.[0]||"",80),observedSignals,freshSignal,observedMetrics}}).filter(x=>x&&x.shareUrl);return JSON.stringify({sourceUrl:location.href,pageTitle:c(document.title,160),pageRoute:video,cards})})()"###;

fn preview_discovery_url(platform: &str) -> Option<&'static str> {
    match platform {
        "tiktok" => Some("https://www.tiktok.com/explore"),
        "douyin" => Some("https://www.douyin.com/discover"),
        "kuaishou" => Some("https://www.kuaishou.com/hot"),
        "xiaohongshu" => Some("https://www.xiaohongshu.com/explore"),
        "bilibili" => Some("https://www.bilibili.com/v/popular/all"),
        "xigua" => Some("https://www.ixigua.com/channel/"),
        "huoshan" => Some("https://www.huoshan.com/"),
        "weishi" => Some("https://weishi.qq.com/"),
        "haokan" => Some("https://haokan.baidu.com/"),
        _ => None,
    }
}

fn preview_host_matches_platform(host: &str, platform: &str) -> bool {
    let host = host.strip_prefix("www.").unwrap_or(host);
    match platform {
        "tiktok" => host == "tiktok.com" || host.ends_with(".tiktok.com"),
        "douyin" => {
            host == "douyin.com"
                || host.ends_with(".douyin.com")
                || host == "iesdouyin.com"
                || host.ends_with(".iesdouyin.com")
        }
        "kuaishou" => host == "kuaishou.com" || host.ends_with(".kuaishou.com"),
        "xiaohongshu" => host == "xiaohongshu.com" || host.ends_with(".xiaohongshu.com"),
        "bilibili" => host == "bilibili.com" || host.ends_with(".bilibili.com"),
        "xigua" => {
            host == "ixigua.com"
                || host.ends_with(".ixigua.com")
                || host == "xigua.com"
                || host.ends_with(".xigua.com")
        }
        "huoshan" => host == "huoshan.com" || host.ends_with(".huoshan.com"),
        "weishi" => host == "weishi.qq.com" || host.ends_with(".weishi.qq.com"),
        "haokan" => host == "haokan.baidu.com" || host.ends_with(".haokan.baidu.com"),
        _ => false,
    }
}

fn preview_path_looks_like_video(value: &str, platform: &str) -> bool {
    let path = value
        .strip_prefix("https://")
        .and_then(|rest| rest.split_once('/').map(|(_, path)| path))
        .unwrap_or_default()
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let path = format!("/{path}");
    match platform {
        "tiktok" => {
            path.split('/')
                .any(|part| part.len() >= 6 && part.chars().all(|c| c.is_ascii_digit()))
                && (path.contains("/@") && path.contains("/video/") || path.starts_with("/video/"))
        }
        "douyin" => {
            path.split('/')
                .any(|part| part.len() >= 6 && part.chars().all(|c| c.is_ascii_digit()))
                && (path.starts_with("/video/") || path.starts_with("/note/"))
        }
        "kuaishou" => ["/short-video/", "/photo/"].iter().any(|prefix| {
            path.strip_prefix(prefix).is_some_and(|rest| {
                rest.len() >= 6
                    && rest
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            })
        }),
        "xiaohongshu" => ["/explore/", "/discovery/item/"].iter().any(|prefix| {
            path.strip_prefix(prefix).is_some_and(|rest| {
                rest.len() >= 12
                    && rest
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            })
        }),
        "bilibili" => {
            path.strip_prefix("/video/").is_some_and(|rest| {
                (rest.starts_with("bv") && rest.len() >= 8)
                    || (rest.starts_with("av")
                        && rest[2..].chars().take_while(|c| c.is_ascii_digit()).count() >= 6)
            }) || path.split('/').any(|part| {
                (part.starts_with("bv") && part.len() >= 8)
                    || (part.starts_with("av")
                        && part[2..].chars().take_while(|c| c.is_ascii_digit()).count() >= 6)
            })
        }
        "xigua" => {
            path.starts_with("/video/")
                && path
                    .strip_prefix("/video/")
                    .is_some_and(|rest| rest.len() >= 6 && rest.chars().all(|c| c.is_ascii_digit()))
                || path
                    .strip_prefix("/i")
                    .is_some_and(|rest| rest.len() >= 6 && rest.chars().all(|c| c.is_ascii_digit()))
        }
        "huoshan" => {
            path.starts_with("/video/")
                && path
                    .strip_prefix("/video/")
                    .is_some_and(|rest| rest.len() >= 6 && rest.chars().all(|c| c.is_ascii_digit()))
        }
        "weishi" => ["/video/", "/detail/"].iter().any(|prefix| {
            path.strip_prefix(prefix)
                .is_some_and(|rest| rest.len() >= 8)
        }),
        "haokan" => ["/v/", "/video/"].iter().any(|prefix| {
            path.strip_prefix(prefix)
                .is_some_and(|rest| rest.len() >= 8)
        }),
        _ => false,
    }
}

pub(super) fn obscura_canonical_video_url(value: &str, platform: &str) -> Option<String> {
    let candidate = value.trim().split(['?', '#']).next().unwrap_or_default();
    if !preview_path_looks_like_video(candidate, platform) {
        return None;
    }
    let host = validate_reference_video_source_url(candidate).ok()?;
    if !preview_host_matches_platform(&host, platform) {
        return None;
    }
    Some(candidate.to_string())
}

fn obscura_safe_thumbnail_url(value: &str) -> Option<String> {
    let candidate = value.trim().split(['?', '#']).next().unwrap_or_default();
    if candidate.len() > 2000
        || !candidate.starts_with("https://")
        || preview_secret_like(candidate)
    {
        return None;
    }
    let authority = candidate["https://".len()..]
        .split('/')
        .next()
        .unwrap_or_default();
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    Some(candidate.to_string())
}

fn obscura_string_field(
    object: &serde_json::Map<String, Value>,
    keys: &[&str],
    limit: usize,
) -> String {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .map(|value| {
            value
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(limit)
                .collect()
        })
        .unwrap_or_default()
}

fn obscura_string_array(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Vec<String> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_array))
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(|value| value.chars().take(80).collect::<String>())
                .filter(|value| !value.trim().is_empty())
                .take(12)
                .collect()
        })
        .unwrap_or_default()
}

fn obscura_source_url(object: &serde_json::Map<String, Value>) -> Option<String> {
    ["sourceUrl", "pageUrl", "requestUrl", "location", "url"]
        .iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| value.starts_with("https://"))
        .map(str::to_string)
}

fn collect_obscura_records(
    value: &Value,
    inherited_source_url: Option<&str>,
    records: &mut Vec<(Option<String>, Value)>,
    depth: usize,
) {
    if depth > 6 || records.len() >= 4_000 {
        return;
    }
    match value {
        Value::String(text) if text.trim_start().starts_with(['{', '[']) => {
            if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                collect_obscura_records(&parsed, inherited_source_url, records, depth + 1);
            }
        }
        Value::Array(values) => {
            for child in values {
                collect_obscura_records(child, inherited_source_url, records, depth + 1);
            }
        }
        Value::Object(object) => {
            let source_url =
                obscura_source_url(object).or_else(|| inherited_source_url.map(str::to_string));
            if let Some(cards) = object.get("cards").and_then(Value::as_array) {
                for card in cards {
                    if card.is_object() {
                        records.push((source_url.clone(), card.clone()));
                    }
                }
                for (key, child) in object {
                    if key != "cards" {
                        collect_obscura_records(child, source_url.as_deref(), records, depth + 1);
                    }
                }
                return;
            }
            let looks_like_card = object.contains_key("shareUrl")
                || object.contains_key("videoUrl")
                || (object.contains_key("href") && object.contains_key("title"));
            if looks_like_card {
                records.push((source_url.clone(), value.clone()));
            }
            for child in object.values() {
                collect_obscura_records(child, source_url.as_deref(), records, depth + 1);
            }
        }
        _ => {}
    }
}

fn parse_obscura_documents(stdout: &str) -> Vec<Value> {
    let mut documents = Vec::new();
    for line in stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if let Ok(value) = serde_json::from_str::<Value>(line) {
            documents.push(value);
        }
    }
    if documents.is_empty() {
        if let Ok(value) = serde_json::from_str::<Value>(stdout.trim()) {
            documents.push(value);
        }
    }
    documents
}

#[derive(Debug, Clone)]
struct ObscuraPreviewCandidate {
    platform: String,
    title: String,
    author: String,
    share_url: String,
    thumbnail_url: Option<String>,
    fresh_signal: bool,
    observed_signals: Vec<String>,
    has_engagement_metadata: bool,
}

fn obscura_fresh_signal(candidate: &serde_json::Map<String, Value>) -> bool {
    if candidate
        .get("freshSignal")
        .or_else(|| candidate.get("fresh"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return true;
    }
    let time_text = obscura_string_field(candidate, &["timeText", "publishedAt", "date"], 80)
        .to_ascii_lowercase();
    [
        "just now",
        "vừa đăng",
        "hôm nay",
        "mới đăng",
        "刚刚",
        "今天",
        "分钟",
        "小时",
    ]
    .iter()
    .any(|signal| time_text.contains(signal))
        || time_text.split_whitespace().any(|token| {
            let number = token
                .chars()
                .take_while(|character| character.is_ascii_digit())
                .count();
            number > 0 && token[number..].starts_with(['m', 'h', 'd'])
        })
}

fn obscura_normalize_key(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn obscura_has_signal(signals: &[String], expected: &[&str]) -> bool {
    signals.iter().any(|signal| {
        let lower = signal.to_ascii_lowercase();
        expected.iter().any(|needle| lower.contains(needle))
    })
}

fn preview_topic_for_text(title: &str, author: &str) -> (&'static str, &'static str) {
    let text = format!("{title} {author}").to_ascii_lowercase();
    if [
        "how",
        "why",
        "science",
        "history",
        "fact",
        "knowledge",
        "giải thích",
        "kiến thức",
        "lịch sử",
        "vì sao",
        "bí mật",
    ]
    .iter()
    .any(|needle| text.contains(needle))
    {
        return (
            "knowledge",
            "Có tín hiệu giải thích/kiến thức trong title hoặc author",
        );
    }
    if [
        "story",
        "storytime",
        "documentary",
        "document",
        "câu chuyện",
        "tư liệu",
        "hành trình",
        "sự thật",
    ]
    .iter()
    .any(|needle| text.contains(needle))
    {
        return (
            "story",
            "Có tín hiệu kể chuyện/tư liệu trong title hoặc author",
        );
    }
    if [
        "nature",
        "ocean",
        "forest",
        "animal",
        "space",
        "earth",
        "thiên nhiên",
        "biển",
        "rừng",
        "động vật",
        "vũ trụ",
    ]
    .iter()
    .any(|needle| text.contains(needle))
    {
        return ("nature", "Có tín hiệu thiên nhiên trong title hoặc author");
    }
    if [
        "tech",
        "robot",
        "machine",
        "ai",
        "computer",
        "công nghệ",
        "máy móc",
        "kỹ thuật",
    ]
    .iter()
    .any(|needle| text.contains(needle))
    {
        return (
            "technology",
            "Có tín hiệu công nghệ trong title hoặc author",
        );
    }
    if [
        "food",
        "travel",
        "home",
        "fashion",
        "beauty",
        "đời sống",
        "ẩm thực",
        "du lịch",
        "nhà cửa",
        "làm đẹp",
    ]
    .iter()
    .any(|needle| text.contains(needle))
    {
        return ("lifestyle", "Có tín hiệu đời sống trong title hoặc author");
    }
    if [
        "music",
        "dance",
        "comedy",
        "funny",
        "movie",
        "game",
        "giải trí",
        "nhạc",
        "nhảy",
        "hài",
    ]
    .iter()
    .any(|needle| text.contains(needle))
    {
        return (
            "entertainment",
            "Có tín hiệu giải trí trong title hoặc author",
        );
    }
    if [
        "sport",
        "football",
        "soccer",
        "basketball",
        "thể thao",
        "bóng đá",
        "bóng rổ",
    ]
    .iter()
    .any(|needle| text.contains(needle))
    {
        return ("sports", "Có tín hiệu thể thao trong title hoặc author");
    }
    ("other", "Chưa đủ tín hiệu title để phân loại chủ đề")
}

fn preview_social_potential_score(
    hot_new: bool,
    rising: bool,
    fresh: bool,
    low_clone: bool,
    has_engagement_metadata: bool,
) -> u32 {
    let mut score = 35;
    if hot_new {
        score += 20;
    }
    if rising {
        score += 20;
    }
    if fresh {
        score += 10;
    }
    if low_clone {
        score += 10;
    }
    if has_engagement_metadata {
        score += 5;
    }
    score.min(100)
}

fn obscura_tiktok_embed_url(share_url: &str, platform: &str) -> Option<String> {
    if platform != "tiktok" {
        return None;
    }
    let id = share_url
        .split("/video/")
        .nth(1)
        .and_then(|value| value.split('/').next())
        .filter(|value| {
            !value.is_empty() && value.chars().all(|character| character.is_ascii_digit())
        })?;
    Some(format!("https://www.tiktok.com/player/v1/{id}"))
}

pub(super) fn build_obscura_preview_report(
    stdout: &str,
    platforms: &[String],
    max_results: u32,
) -> Value {
    let documents = parse_obscura_documents(stdout);
    let mut records = Vec::new();
    for document in &documents {
        collect_obscura_records(document, None, &mut records, 0);
    }

    let mut candidates = Vec::new();
    let mut seen_urls = std::collections::HashSet::new();
    for (source_url, raw) in records {
        let Some(object) = raw.as_object() else {
            continue;
        };
        let share_raw =
            obscura_string_field(object, &["shareUrl", "videoUrl", "href", "url"], 2000);
        let platform = platforms
            .iter()
            .find(|platform| {
                source_url
                    .as_deref()
                    .and_then(|value| validate_reference_video_source_url(value).ok())
                    .is_some_and(|host| preview_host_matches_platform(&host, platform))
                    || obscura_canonical_video_url(&share_raw, platform).is_some()
            })
            .cloned();
        let Some(platform) = platform else { continue };
        let Some(share_url) = obscura_canonical_video_url(&share_raw, &platform) else {
            continue;
        };
        if !seen_urls.insert(share_url.clone()) {
            continue;
        }
        let title = obscura_string_field(object, &["title", "name", "description", "text"], 240);
        let author = obscura_string_field(object, &["author", "creator", "username", "user"], 120);
        let thumbnail_url = obscura_string_field(
            object,
            &[
                "thumbnailUrl",
                "thumbnail",
                "imageUrl",
                "image",
                "cover",
                "poster",
            ],
            2000,
        );
        let mut observed_signals = obscura_string_array(object, &["observedSignals", "signals"]);
        if observed_signals.is_empty() {
            observed_signals = obscura_string_array(object, &["rankingSignals"]);
        }
        let has_engagement_metadata = object
            .get("observedMetrics")
            .and_then(Value::as_object)
            .is_some_and(|metrics| !metrics.is_empty())
            || object
                .get("engagement")
                .and_then(Value::as_bool)
                .unwrap_or(false);
        candidates.push(ObscuraPreviewCandidate {
            platform,
            title: if title.is_empty() {
                "Video preview".to_string()
            } else {
                title
            },
            author: if author.is_empty() {
                "Không rõ tác giả".to_string()
            } else {
                author
            },
            share_url,
            thumbnail_url: obscura_safe_thumbnail_url(&thumbnail_url),
            fresh_signal: obscura_fresh_signal(object),
            observed_signals,
            has_engagement_metadata,
        });
    }

    let scanned_at = now_string();
    let mut cards = Vec::new();
    let mut platform_results = Vec::new();
    for platform in platforms {
        let mut platform_cards = candidates
            .iter()
            .filter(|candidate| &candidate.platform == platform)
            .take(max_results as usize)
            .cloned()
            .collect::<Vec<_>>();
        if platform_cards.is_empty() {
            platform_results.push(serde_json::json!({
                "platform": platform,
                "status": "blocked",
                "scannedCount": 0,
                "discoveryUrl": preview_discovery_url(platform).unwrap_or_default(),
                "message": "Obscura đã mở route public nhưng không đọc được card video hợp lệ; cần fixture/adapter mới hoặc người dùng kiểm tra trang này."
            }));
            continue;
        }
        let mut title_counts = HashMap::new();
        let mut thumbnail_counts = HashMap::new();
        for candidate in &platform_cards {
            *title_counts
                .entry(obscura_normalize_key(&candidate.title))
                .or_insert(0_u32) += 1;
            if let Some(thumbnail) = &candidate.thumbnail_url {
                *thumbnail_counts.entry(thumbnail.clone()).or_insert(0_u32) += 1;
            }
        }
        for candidate in platform_cards.drain(..) {
            let hot_new = obscura_has_signal(
                &candidate.observed_signals,
                &[
                    "hot", "trend", "popular", "featured", "nổi", "热门", "爆款", "推荐",
                ],
            );
            let rising = obscura_has_signal(
                &candidate.observed_signals,
                &["rising", "tăng", "上升", "热度"],
            ) || (candidate.fresh_signal && candidate.has_engagement_metadata);
            let fresh = candidate.fresh_signal;
            let low_clone = title_counts
                .get(&obscura_normalize_key(&candidate.title))
                .copied()
                .unwrap_or(2)
                == 1
                && candidate.thumbnail_url.as_ref().is_none_or(|thumbnail| {
                    thumbnail_counts.get(thumbnail).copied().unwrap_or(2) == 1
                });
            let mut buckets = Vec::new();
            let mut evidence = Vec::new();
            if hot_new {
                buckets.push("hot_new");
                evidence.push("DOM có tín hiệu hot/nổi bật được quan sát");
            }
            if rising {
                buckets.push("rising");
                evidence.push("DOM có tín hiệu tăng hoặc metadata tương tác đi cùng card mới");
            }
            if low_clone {
                buckets.push("low_clone");
                evidence.push("title/thumbnail không trùng trong lượt quét này; chỉ là heuristic");
            }
            if fresh {
                buckets.push("fresh");
                evidence.push("DOM có tín hiệu thời gian mới đăng");
            }
            if buckets.is_empty() {
                buckets.push("unranked");
                evidence.push("Chưa có metadata đủ tin cậy để xếp nhóm");
            }
            let (topic, topic_evidence) =
                preview_topic_for_text(&candidate.title, &candidate.author);
            let potential_score = preview_social_potential_score(
                hot_new,
                rising,
                fresh,
                low_clone,
                candidate.has_engagement_metadata,
            );
            if potential_score >= 60 {
                buckets.insert(0, "potential");
                evidence.insert(0, "điểm biên tập đủ cao để ưu tiên xem trước");
            }
            cards.push(serde_json::json!({
                "previewId": format!("preview-{}-{}", candidate.platform, preview_id_digest(&candidate.share_url)),
                "platform": candidate.platform,
                "title": candidate.title,
                "author": candidate.author,
                "shareUrl": candidate.share_url,
                "embedUrl": obscura_tiktok_embed_url(&candidate.share_url, platform),
                "thumbnailUrl": candidate.thumbnail_url,
                "scannedAt": scanned_at,
                "addedToPlan": false,
                "radarBuckets": buckets,
                "rankingEvidence": evidence.join("; "),
                "topic": topic,
                "topicEvidence": topic_evidence,
                "potentialScore": potential_score,
                "potentialEvidence": format!("{}; điểm dựa trên tín hiệu public trong lượt quét, không phải quyền sử dụng", evidence.join("; ")),
                "reuseStatus": "permission_required",
                "reuseEvidence": "URL public không chứng minh quyền sao chép hoặc đăng lại; cần giấy phép hoặc quyền sở hữu.",
                "reviewStatus": "unreviewed"
            }));
        }
        platform_results.push(serde_json::json!({
            "platform": platform,
            "status": "success",
            "scannedCount": cards.iter().filter(|card| card.get("platform").and_then(Value::as_str) == Some(platform)).count(),
            "discoveryUrl": preview_discovery_url(platform).unwrap_or_default(),
            "message": "Obscura đã trả card metadata từ route public; chưa tải video."
        }));
    }
    let successful_platforms = platform_results
        .iter()
        .filter(|result| result.get("status").and_then(Value::as_str) == Some("success"))
        .count();
    let status = if cards.is_empty() {
        "blocked"
    } else if successful_platforms == platforms.len() {
        "success"
    } else {
        "partial"
    };
    serde_json::json!({
        "status": status,
        "worker": "Obscura · public scrape · concurrency 3",
        "engine": "obscura_public_scrape",
        "scanMode": "discovery_all",
        "previewOnly": true,
        "platforms": platforms,
        "maxResults": max_results,
        "platformResults": platform_results,
        "cards": cards,
        "browserSessionAttached": false,
        "networkCallsMade": true,
        "message": if cards.is_empty() { "Obscura không trả card video hợp lệ; không ghi kết quả giả." } else { "Đã quét public bằng Obscura; hãy review card và quyền sử dụng trước khi tải." }
    })
}

fn parse_ytdlp_catalog_document(stdout: &str) -> Option<Value> {
    let trimmed = stdout.trim();
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return Some(value);
    }
    stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .find_map(|line| serde_json::from_str::<Value>(line).ok())
}

fn ytdlp_entry_url(object: &serde_json::Map<String, Value>) -> Option<String> {
    [
        "webpage_url",
        "webpageUrl",
        "original_url",
        "originalUrl",
        "url",
    ]
    .iter()
    .find_map(|key| object.get(*key).and_then(Value::as_str))
    .map(str::trim)
    .filter(|value| value.starts_with("https://"))
    .map(str::to_string)
}

fn ytdlp_fresh_signal(object: &serde_json::Map<String, Value>) -> bool {
    let timestamp = object
        .get("timestamp")
        .and_then(Value::as_i64)
        .or_else(|| object.get("release_timestamp").and_then(Value::as_i64));
    let Some(timestamp) = timestamp else {
        return false;
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    timestamp >= now.saturating_sub(14 * 24 * 60 * 60) && timestamp <= now.saturating_add(300)
}

pub(super) fn validate_preview_creator_source_url(
    value: &str,
    platform: &str,
) -> Result<String, String> {
    let source_url = value.trim();
    let host = validate_reference_video_source_url(source_url)?;
    if !preview_host_matches_platform(&host, platform) {
        return Err(format!(
            "URL nguồn không thuộc nền tảng đã chọn: {}",
            preview_platform_label(platform)
        ));
    }
    Ok(source_url.to_string())
}

fn preview_platform_label(platform: &str) -> &'static str {
    match platform {
        "tiktok" => "TikTok",
        "douyin" => "Douyin",
        "kuaishou" => "Kuaishou",
        "xiaohongshu" => "Xiaohongshu",
        "bilibili" => "Bilibili",
        "xigua" => "Xigua / 西瓜视频",
        "huoshan" => "Huoshan / 火山版",
        "weishi" => "Weishi / 微视",
        "haokan" => "Haokan / 好看视频",
        _ => "nền tảng đã chọn",
    }
}

pub(super) fn build_ytdlp_creator_preview_report(
    stdout: &str,
    platform: &str,
    source_url: &str,
    max_results: u32,
) -> Value {
    let document = parse_ytdlp_catalog_document(stdout);
    let entry_values = document
        .as_ref()
        .and_then(|value| value.get("entries").and_then(Value::as_array))
        .or_else(|| document.as_ref().and_then(Value::as_array))
        .map(|entries| entries.iter().collect::<Vec<_>>())
        .unwrap_or_default();
    let scanned_at = now_string();
    let mut cards = Vec::new();
    let mut seen_urls = std::collections::HashSet::new();
    for entry in entry_values.into_iter().take(max_results as usize) {
        let Some(object) = entry.as_object() else {
            continue;
        };
        let Some(raw_url) = ytdlp_entry_url(object) else {
            continue;
        };
        let Some(share_url) = obscura_canonical_video_url(&raw_url, platform) else {
            continue;
        };
        if !seen_urls.insert(share_url.clone()) {
            continue;
        }
        let title =
            obscura_string_field(object, &["title", "fulltitle", "description", "name"], 240);
        let author = obscura_string_field(
            object,
            &["uploader", "channel", "creator", "username", "uploader_id"],
            120,
        );
        let thumbnail_url = obscura_string_field(
            object,
            &[
                "thumbnail",
                "thumbnail_url",
                "thumbnailUrl",
                "cover",
                "poster",
            ],
            2000,
        );
        let fresh = ytdlp_fresh_signal(object);
        let (topic, topic_evidence) = preview_topic_for_text(
            if title.is_empty() {
                "Video preview"
            } else {
                title.as_str()
            },
            if author.is_empty() {
                "Không rõ tác giả"
            } else {
                author.as_str()
            },
        );
        let potential_score = preview_social_potential_score(false, false, fresh, false, false);
        let (radar_buckets, ranking_evidence) = if fresh {
            (
                vec!["fresh"],
                "Catalog có timestamp trong 14 ngày gần đây; chưa có dữ liệu view/like để xếp hot hoặc rising.",
            )
        } else {
            (
                vec!["unranked"],
                "yt-dlp catalog chỉ trả metadata URL; chưa có dữ liệu view/like và không suy diễn hot/rising.",
            )
        };
        cards.push(serde_json::json!({
            "previewId": format!("preview-{}-{}", platform, preview_id_digest(&share_url)),
            "platform": platform,
            "title": if title.is_empty() { "Video preview" } else { title.as_str() },
            "author": if author.is_empty() { "Không rõ tác giả" } else { author.as_str() },
            "shareUrl": share_url,
            "embedUrl": obscura_tiktok_embed_url(&raw_url, platform),
            "thumbnailUrl": obscura_safe_thumbnail_url(&thumbnail_url),
            "scannedAt": scanned_at.clone(),
            "addedToPlan": false,
            "radarBuckets": radar_buckets,
            "rankingEvidence": ranking_evidence,
            "topic": topic,
            "topicEvidence": topic_evidence,
            "potentialScore": potential_score,
            "potentialEvidence": "Chỉ có metadata catalog; chưa có dữ liệu tương tác để xác nhận độ hot hoặc tăng trưởng.",
            "reuseStatus": "permission_required",
            "reuseEvidence": "URL public không chứng minh quyền sao chép hoặc đăng lại; cần giấy phép hoặc quyền sở hữu.",
            "reviewStatus": "unreviewed"
        }));
    }
    let scanned_count = cards.len();
    let status = if scanned_count > 0 {
        "success"
    } else {
        "blocked"
    };
    serde_json::json!({
        "status": status,
        "worker": "yt-dlp · creator/playlist catalog",
        "engine": "yt_dlp_creator_catalog",
        "scanMode": "creator_catalog",
        "previewOnly": true,
        "platforms": [platform],
        "maxResults": max_results,
        "sourceUrl": source_url,
        "platformResults": [{
            "platform": platform,
            "status": status,
            "scannedCount": scanned_count,
            "discoveryUrl": source_url,
            "message": if scanned_count > 0 {
                "yt-dlp đã đọc catalog public của nguồn; chưa tải video và chưa có số liệu tương tác."
            } else {
                "Nguồn đã mở nhưng không trả URL video hợp lệ; có thể là trang yêu cầu đăng nhập, CAPTCHA hoặc extractor đã đổi."
            }
        }],
        "cards": cards,
        "browserSessionAttached": false,
        "networkCallsMade": true,
        "message": if scanned_count > 0 {
            format!("Đã nhận {scanned_count} card từ catalog public của nguồn; hãy review trước khi tải.")
        } else {
            "yt-dlp không trả card video hợp lệ; không ghi kết quả giả.".to_string()
        }
    })
}

fn preview_id_digest(value: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(value.as_bytes());
    let encoded = format!("{:x}", digest.finalize());
    encoded.chars().take(16).collect()
}

async fn run_obscura_preview_scan(
    platforms: &[String],
    max_results: u32,
    run_id: &str,
    workspace_root: &Path,
    obscura_path: PathBuf,
    report_path: &Path,
    report_relative: &str,
) -> Result<Value, String> {
    // `obscura scrape` evaluates immediately after navigation. SPA discovery
    // pages such as TikTok often have no anchors at that point even though the
    // page becomes readable a few seconds later. Use the single-page `fetch`
    // path with an explicit settle policy, while keeping the old bounded
    // concurrency of three routes.
    let semaphore = Arc::new(tokio::sync::Semaphore::new(3));
    let mut jobs = Vec::with_capacity(platforms.len());
    for (index, platform) in platforms.iter().enumerate() {
        let Some(discovery_url) = preview_discovery_url(platform) else {
            continue;
        };
        let semaphore = Arc::clone(&semaphore);
        let platform = platform.clone();
        let discovery_url = discovery_url.to_string();
        let obscura_path = obscura_path.clone();
        let workspace_root = workspace_root.to_path_buf();
        jobs.push(tokio::spawn(async move {
            let permit = semaphore
                .acquire_owned()
                .await
                .map_err(|error| format!("Obscura concurrency gate lỗi: {error}"))?;
            let _permit = permit;
            let process = run_external_process(ExternalProcessRequest {
                spec: ProcessSpec {
                    executable_id: "obscura".to_string(),
                    args: vec![
                        "fetch".to_string(),
                        discovery_url,
                        "--wait".to_string(),
                        "8".to_string(),
                        "--wait-until".to_string(),
                        "networkidle0".to_string(),
                        "--timeout".to_string(),
                        "45".to_string(),
                        "--eval".to_string(),
                        OBSCURA_PREVIEW_EVAL.to_string(),
                        "--quiet".to_string(),
                    ],
                    working_directory: ".".to_string(),
                    environment: Default::default(),
                    timeout_seconds: 60,
                    expected_outputs: Vec::new(),
                },
                executable_path: obscura_path,
                absolute_working_directory: workspace_root.clone(),
                output_root: workspace_root,
                cancellation: Arc::new(AtomicBool::new(false)),
            })
            .await;
            Ok::<_, String>((index, platform, process))
        }));
    }

    let mut combined_stdout = String::new();
    let mut processes: Vec<Option<ExternalProcessResult>> = vec![None; platforms.len()];
    let mut failures = Vec::new();
    for job in jobs {
        let (index, platform, result) = job
            .await
            .map_err(|error| format!("Obscura worker task lỗi: {error}"))??;
        match result {
            Ok(process) => {
                if process.succeeded {
                    combined_stdout.push_str(&process.stdout);
                    combined_stdout.push('\n');
                } else {
                    let reason = if process.timed_out {
                        "timeout 60 giây"
                    } else if process.cancelled {
                        "đã bị hủy"
                    } else {
                        "kết thúc non-zero"
                    };
                    failures.push((platform.clone(), reason.to_string()));
                }
                processes[index] = Some(process);
            }
            Err(error) => failures.push((platform, error)),
        }
    }
    let total_output_bytes = processes
        .iter()
        .flatten()
        .map(|process| process.stdout_bytes)
        .sum::<usize>();

    let mut report = build_obscura_preview_report(&combined_stdout, platforms, max_results);
    {
        let object = report
            .as_object_mut()
            .ok_or_else(|| "Obscura preview report phải là JSON object".to_string())?;
        object.insert(
            "worker".to_string(),
            Value::String("Obscura · public fetch + networkidle · concurrency 3".to_string()),
        );
        object.insert(
            "engine".to_string(),
            Value::String("obscura_public_fetch".to_string()),
        );
        let evidence = processes
            .iter()
            .flatten()
            .filter_map(|process| {
                let mut process_evidence = process.clone();
                process_evidence.stdout = format!(
                    "Obscura stdout đã parse: {} byte; raw page output không ghi vào report.",
                    process.stdout_bytes
                );
                serde_json::to_value(process_evidence).ok()
            })
            .collect::<Vec<_>>();
        object.insert("processes".to_string(), Value::Array(evidence));
        if !failures.is_empty() {
            let results = object
                .entry("platformResults".to_string())
                .or_insert_with(|| Value::Array(Vec::new()))
                .as_array_mut()
                .ok_or_else(|| "Obscura preview platformResults không phải array".to_string())?;
            for (platform, reason) in &failures {
                if let Some(result) = results.iter_mut().find(|result| {
                    result.get("platform").and_then(Value::as_str) == Some(platform.as_str())
                }) {
                    result["status"] = Value::String("error".to_string());
                    result["message"] = Value::String(format!(
                        "Obscura không hoàn tất route public: {reason}; không ghi card từ process lỗi."
                    ));
                }
            }
        }
    }
    preview_report_refresh_status(&mut report, platforms)?;
    let status = report
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("blocked")
        .to_string();
    let message = if failures.is_empty() {
        report
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Obscura chưa trả thông báo kết quả hợp lệ.")
            .to_string()
    } else {
        let failed_platforms = failures
            .iter()
            .map(|(platform, _)| preview_platform_label(platform))
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            "Đã quét public bằng Obscura nhưng route lỗi: {failed_platforms}. Card hợp lệ vẫn được giữ; hãy mở BrowserOS để thử lại nền tảng thiếu."
        )
    };
    let object = report
        .as_object_mut()
        .ok_or_else(|| "Obscura preview report phải là JSON object".to_string())?;
    object.insert("status".to_string(), Value::String(status));
    object.insert("runId".to_string(), Value::String(run_id.to_string()));
    object.insert(
        "reportPath".to_string(),
        Value::String(report_relative.to_string()),
    );
    object.insert(
        "obscuraOutputBytes".to_string(),
        Value::from(total_output_bytes),
    );
    object.insert("message".to_string(), Value::String(message));
    let bytes = serde_json::to_vec_pretty(&report)
        .map_err(|error| format!("Không serialize được Obscura preview report: {error}"))?;
    if bytes.is_empty() {
        return Err("Obscura preview report rỗng".to_string());
    }
    fs::write(report_path, bytes)
        .map_err(|error| format!("Không ghi được Obscura preview report: {error}"))?;
    let report_size = fs::metadata(report_path)
        .map_err(|error| format!("Không xác nhận được Obscura preview report: {error}"))?
        .len();
    if report_size == 0 {
        return Err("Obscura preview report ghi ra nhưng có kích thước 0".to_string());
    }
    Ok(report)
}

pub(super) fn preview_report_has_cards_for_platform(report: &Value, platform: &str) -> bool {
    report
        .get("cards")
        .and_then(Value::as_array)
        .is_some_and(|cards| {
            cards.iter().any(|card| {
                card.get("platform").and_then(Value::as_str) == Some(platform)
                    && card
                        .get("shareUrl")
                        .and_then(Value::as_str)
                        .is_some_and(|url| obscura_canonical_video_url(url, platform).is_some())
            })
        })
}

fn preview_report_card_count_for_platform(report: &Value, platform: &str) -> usize {
    report
        .get("cards")
        .and_then(Value::as_array)
        .map(|cards| {
            cards
                .iter()
                .filter(|card| {
                    card.get("platform").and_then(Value::as_str) == Some(platform)
                        && card
                            .get("shareUrl")
                            .and_then(Value::as_str)
                            .is_some_and(|url| obscura_canonical_video_url(url, platform).is_some())
                })
                .count()
        })
        .unwrap_or_default()
}

fn preview_report_refresh_status(report: &mut Value, platforms: &[String]) -> Result<(), String> {
    let card_count = platforms
        .iter()
        .map(|platform| preview_report_card_count_for_platform(report, platform))
        .sum::<usize>();
    let success_count = report
        .get("platformResults")
        .and_then(Value::as_array)
        .map(|results| {
            platforms
                .iter()
                .filter(|platform| {
                    results.iter().any(|result| {
                        result.get("platform").and_then(Value::as_str) == Some(platform.as_str())
                            && result.get("status").and_then(Value::as_str) == Some("success")
                    })
                })
                .count()
        })
        .unwrap_or_default();
    let object = report
        .as_object_mut()
        .ok_or_else(|| "Preview report phải là JSON object".to_string())?;
    let status = if card_count == 0 {
        "blocked"
    } else if success_count == platforms.len() {
        "success"
    } else {
        "partial"
    };
    object.insert("status".to_string(), Value::String(status.to_string()));
    Ok(())
}

pub(super) fn merge_preview_platform_fallback(
    mut report: Value,
    fallback: &Value,
    fallback_platforms: &[String],
    browser_process: &ExternalProcessResult,
) -> Result<Value, String> {
    let all_platforms = report
        .get("platforms")
        .and_then(Value::as_array)
        .map(|platforms| {
            platforms
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| fallback_platforms.to_vec());
    {
        let object = report
            .as_object_mut()
            .ok_or_else(|| "Preview report phải là JSON object".to_string())?;
        let fallback_cards = fallback
            .get("cards")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let cards = object
            .entry("cards".to_string())
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| "Preview report cards không phải array".to_string())?;
        let mut seen = cards
            .iter()
            .filter_map(|card| card.get("shareUrl").and_then(Value::as_str))
            .map(str::to_string)
            .collect::<std::collections::HashSet<_>>();
        for card in fallback_cards {
            let Some(platform) = card.get("platform").and_then(Value::as_str) else {
                continue;
            };
            if !fallback_platforms.iter().any(|item| item == platform) {
                continue;
            }
            let Some(url) = card.get("shareUrl").and_then(Value::as_str) else {
                continue;
            };
            if obscura_canonical_video_url(url, platform).is_some() && seen.insert(url.to_string())
            {
                cards.push(card);
            }
        }
        let fallback_results = fallback
            .get("platformResults")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let results = object
            .entry("platformResults".to_string())
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| "Preview report platformResults không phải array".to_string())?;
        for platform in fallback_platforms {
            let Some(fallback_result) = fallback_results.iter().find(|result| {
                result.get("platform").and_then(Value::as_str) == Some(platform.as_str())
            }) else {
                continue;
            };
            if let Some(existing) = results.iter_mut().find(|result| {
                result.get("platform").and_then(Value::as_str) == Some(platform.as_str())
            }) {
                *existing = fallback_result.clone();
            } else {
                results.push(fallback_result.clone());
            }
        }
        let previous_reason = object
            .get("fallbackReason")
            .and_then(Value::as_str)
            .unwrap_or("Obscura không trả đủ card hợp lệ")
            .to_string();
        object.insert(
            "worker".to_string(),
            Value::String("Obscura + BrowserOS neo fallback theo nền tảng".to_string()),
        );
        object.insert(
            "engine".to_string(),
            Value::String("obscura_public_scrape+browseros_preview_scan".to_string()),
        );
        object.insert(
            "fallbackReason".to_string(),
            Value::String(format!(
                "{previous_reason}. BrowserOS neo đã được dùng 1 tab tuần tự cho nền tảng còn thiếu; không dùng stealth/proxy."
            )),
        );
        object.insert("browserSessionAttached".to_string(), Value::Bool(true));
        let mut process_evidence = browser_process.clone();
        process_evidence.stdout = format!(
            "BrowserOS stdout đã parse: {} byte; raw page output không ghi vào report.",
            browser_process.stdout_bytes
        );
        object.insert(
            "browserProcess".to_string(),
            serde_json::to_value(process_evidence).map_err(|error| {
                format!("Không serialize được BrowserOS process evidence: {error}")
            })?,
        );
    }
    preview_report_refresh_status(&mut report, &all_platforms)?;
    Ok(report)
}

fn preview_report_attach_public_catalog_attempt(
    report: &mut Value,
    status: &str,
    message: String,
    process: Option<&ExternalProcessResult>,
    output_path: Option<String>,
) {
    let Some(object) = report.as_object_mut() else {
        return;
    };
    let mut attempt = serde_json::Map::new();
    attempt.insert(
        "platform".to_string(),
        Value::String("bilibili".to_string()),
    );
    attempt.insert(
        "engine".to_string(),
        Value::String("bilibili_public_catalog".to_string()),
    );
    attempt.insert("status".to_string(), Value::String(status.to_string()));
    attempt.insert("message".to_string(), Value::String(message.clone()));
    if let Some(path) = output_path {
        attempt.insert("reportPath".to_string(), Value::String(path));
    }
    if let Some(process) = process {
        let mut evidence = process.clone();
        evidence.stdout = format!(
            "Bilibili public catalog stdout đã parse: {} byte; raw response không ghi vào report.",
            process.stdout_bytes
        );
        if let Ok(value) = serde_json::to_value(evidence) {
            attempt.insert("process".to_string(), value);
        }
    }
    object.insert("publicCatalogAttempt".to_string(), Value::Object(attempt));
    if status != "success" {
        if let Some(results) = object
            .get_mut("platformResults")
            .and_then(Value::as_array_mut)
        {
            if let Some(result) = results
                .iter_mut()
                .find(|result| result.get("platform").and_then(Value::as_str) == Some("bilibili"))
            {
                let previous = result
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                result["message"] =
                    Value::String(format!("{} Fallback catalog public: {}", previous, message));
            }
        }
    }
}

pub(super) fn merge_bilibili_public_catalog(
    report: &mut Value,
    catalog: &Value,
) -> Result<usize, String> {
    let catalog_cards = catalog
        .get("cards")
        .and_then(Value::as_array)
        .ok_or_else(|| "Bilibili catalog report thiếu cards".to_string())?;
    let object = report
        .as_object_mut()
        .ok_or_else(|| "Preview report phải là JSON object".to_string())?;
    let (added, card_count) = {
        let cards = object
            .entry("cards".to_string())
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| "Preview report cards không phải array".to_string())?;
        let mut seen = cards
            .iter()
            .filter_map(|card| card.get("shareUrl").and_then(Value::as_str))
            .map(str::to_string)
            .collect::<std::collections::HashSet<_>>();
        let mut added = 0_usize;
        for card in catalog_cards {
            let Some(url) = card.get("shareUrl").and_then(Value::as_str) else {
                continue;
            };
            if card.get("platform").and_then(Value::as_str) != Some("bilibili")
                || obscura_canonical_video_url(url, "bilibili").is_none()
            {
                continue;
            }
            if seen.insert(url.to_string()) {
                cards.push(card.clone());
                added += 1;
            }
        }
        (added, cards.len())
    };
    let catalog_result = catalog
        .get("platformResults")
        .and_then(Value::as_array)
        .and_then(|results| results.first())
        .cloned();
    if let Some(catalog_result) = catalog_result {
        let results = object
            .entry("platformResults".to_string())
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| "Preview report platformResults không phải array".to_string())?;
        if let Some(index) = results
            .iter()
            .position(|result| result.get("platform").and_then(Value::as_str) == Some("bilibili"))
        {
            results[index] = catalog_result;
        } else {
            results.push(catalog_result);
        }
    }
    let platform_results = object
        .get("platformResults")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let success_count = platform_results
        .iter()
        .filter(|result| result.get("status").and_then(Value::as_str) == Some("success"))
        .count();
    let status = if card_count == 0 {
        "blocked"
    } else if success_count == platform_results.len() && !platform_results.is_empty() {
        "success"
    } else {
        "partial"
    };
    object.insert("status".to_string(), Value::String(status.to_string()));
    if added > 0 {
        let previous = object
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or_default();
        object.insert(
            "message".to_string(),
            Value::String(format!(
                "{} Đã bổ sung {} card từ Bilibili public catalog; hãy xem preview và review quyền trước khi tải.",
                previous.trim(),
                added
            )),
        );
        let worker = object
            .get("worker")
            .and_then(Value::as_str)
            .unwrap_or("Preview Radar");
        object.insert(
            "worker".to_string(),
            Value::String(format!("{} + Bilibili public catalog", worker)),
        );
        object.insert(
            "engine".to_string(),
            Value::String("preview_discovery+bilibili_public_catalog".to_string()),
        );
    }
    Ok(added)
}

async fn run_bilibili_public_catalog_fallback(
    mut report: Value,
    platforms: &[String],
    max_results: u32,
    run_id: &str,
    workspace_root: &Path,
    node_path: Option<&PathBuf>,
    worker_path: &Path,
    output_dir: &Path,
    final_report_path: &Path,
) -> Result<Value, String> {
    if !platforms.iter().any(|platform| platform == "bilibili")
        || preview_report_has_cards_for_platform(&report, "bilibili")
    {
        return Ok(report);
    }
    let Some(node_path) = node_path else {
        preview_report_attach_public_catalog_attempt(
            &mut report,
            "blocked",
            "Node chưa sẵn sàng để chạy Bilibili public catalog fallback.".to_string(),
            None,
            None,
        );
        return Ok(report);
    };
    let catalog_report_path = output_dir.join("bilibili-public-catalog-report.json");
    let catalog_worker_relative = worker_path
        .strip_prefix(workspace_root)
        .map_err(|_| "Bilibili catalog worker vượt project workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let catalog_report_relative = catalog_report_path
        .strip_prefix(workspace_root)
        .map_err(|_| "Bilibili catalog report vượt project workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "node".to_string(),
            args: vec![
                catalog_worker_relative,
                "--max-results".to_string(),
                max_results.to_string(),
                "--run-id".to_string(),
                run_id.to_string(),
                "--output".to_string(),
                catalog_report_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: 90,
            expected_outputs: vec![catalog_report_relative.clone()],
        },
        executable_path: node_path.clone(),
        absolute_working_directory: workspace_root.to_path_buf(),
        output_root: workspace_root.to_path_buf(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await;
    let process = match process {
        Ok(process) => process,
        Err(error) => {
            preview_report_attach_public_catalog_attempt(
                &mut report,
                "failed",
                format!("Không chạy được Bilibili public catalog: {}", error),
                None,
                Some(catalog_report_relative),
            );
            return Ok(report);
        }
    };
    let catalog = fs::read_to_string(&catalog_report_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    let Some(catalog) = catalog else {
        preview_report_attach_public_catalog_attempt(
            &mut report,
            "failed",
            "Bilibili public catalog không ghi được report hợp lệ.".to_string(),
            Some(&process),
            Some(catalog_report_relative),
        );
        return Ok(report);
    };
    let catalog_status = catalog
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("blocked");
    if catalog_status != "success" || !process.succeeded || process.timed_out || process.cancelled {
        let message = catalog
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Bilibili public catalog bị chặn hoặc không trả card.")
            .to_string();
        preview_report_attach_public_catalog_attempt(
            &mut report,
            if process.timed_out || process.cancelled || !process.succeeded {
                "failed"
            } else {
                "blocked"
            },
            message,
            Some(&process),
            Some(catalog_report_relative),
        );
        return Ok(report);
    }
    let added = merge_bilibili_public_catalog(&mut report, &catalog)?;
    let mut process_evidence = process.clone();
    process_evidence.stdout = format!(
        "Bilibili public catalog stdout đã parse: {} byte; raw response không ghi vào report.",
        process.stdout_bytes
    );
    preview_report_attach_public_catalog_attempt(
        &mut report,
        "success",
        format!("Bilibili public catalog bổ sung {} card hợp lệ.", added),
        Some(&process_evidence),
        Some(catalog_report_relative),
    );
    if let Some(object) = report.as_object_mut() {
        object.insert(
            "reportPath".to_string(),
            Value::String(
                final_report_path
                    .strip_prefix(workspace_root)
                    .map_err(|_| "Preview report vượt project workspace".to_string())?
                    .to_string_lossy()
                    .replace('\\', "/"),
            ),
        );
    }
    Ok(report)
}

#[tauri::command]
pub(super) async fn scan_preview_discovery(
    request: PreviewDiscoveryScanRequest,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    valid_text(&request.project_id, "Project ID")?;
    if request.platforms.is_empty() || request.platforms.len() > PREVIEW_DISCOVERY_PLATFORMS.len() {
        return Err("Phải chọn từ 1 đến 9 nền tảng preview".to_string());
    }
    if !(1..=200).contains(&request.max_results) {
        return Err("Số video mỗi nền tảng phải nằm trong khoảng 1..200".to_string());
    }
    let project_id = request.project_id.trim().to_string();
    let mut platforms = Vec::with_capacity(request.platforms.len());
    let mut seen = std::collections::HashSet::new();
    for platform in &request.platforms {
        let normalized = platform.trim().to_ascii_lowercase();
        if !PREVIEW_DISCOVERY_PLATFORMS.contains(&normalized.as_str()) {
            return Err(format!(
                "Nền tảng preview chưa được allowlist: {normalized}"
            ));
        }
        if !seen.insert(normalized.clone()) {
            return Err(format!("Nền tảng preview bị lặp: {normalized}"));
        }
        platforms.push(normalized);
    }

    let (workspace_root, obscura_path, obscura_error, node_path) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        ensure_project_exists(&connection, &project_id)?;
        let workspace_root = fs::canonicalize(project_workspace_root(&connection, &project_id)?)
            .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
        let configured_obscura: Option<String> = connection
            .query_row(
                "SELECT executable_ref FROM tool_configs WHERE tool_id = 'obscura'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("Không đọc được Obscura config: {error}"))?;
        let obscura_resolution = resolve_configured_tool(&connection, "obscura");
        let obscura_is_configured = configured_obscura
            .as_deref()
            .is_some_and(|reference| !reference.trim().is_empty())
            || obscura_resolution.is_ok();
        let (obscura_path, obscura_error) = if obscura_is_configured {
            match obscura_resolution {
                Ok(path) => (Some(path), None),
                Err(error) => (None, Some(error)),
            }
        } else {
            (None, None)
        };
        let node_path = resolve_configured_tool(&connection, "node").ok();
        (workspace_root, obscura_path, obscura_error, node_path)
    };

    let run_id = now_id("preview-scan");
    let output_dir = workspace_root
        .join(".auto3dvideo")
        .join("runs")
        .join(&run_id)
        .join("preview-scan");
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Không tạo được thư mục preview scan: {error}"))?;
    let worker_path = workspace_root
        .join(".auto3dvideo")
        .join("tools")
        .join("browseros_preview_scan_worker.mjs");
    browser_handoff::sync_embedded_worker(
        &worker_path,
        BROWSEROS_PREVIEW_SCAN_WORKER_SCRIPT,
        "BrowserOS preview scan worker",
    )?;
    let public_catalog_worker_path = workspace_root
        .join(".auto3dvideo")
        .join("tools")
        .join("public_preview_catalog_worker.mjs");
    browser_handoff::sync_embedded_worker(
        &public_catalog_worker_path,
        PUBLIC_PREVIEW_CATALOG_WORKER_SCRIPT,
        "Public preview catalog worker",
    )?;
    let report_path = output_dir.join("preview-scan-report.json");
    let relative = |path: &Path| -> Result<String, String> {
        path.strip_prefix(&workspace_root)
            .map_err(|_| "Preview scan output vượt project workspace".to_string())
            .map(|value| value.to_string_lossy().replace('\\', "/"))
    };
    let worker_relative = relative(&worker_path)?;
    let report_relative = relative(&report_path)?;
    let browser_report_path = output_dir.join("browseros-preview-scan-report.json");
    let browser_report_relative = relative(&browser_report_path)?;
    if let Some(error) = obscura_error {
        return Ok(serde_json::json!({
            "status": "blocked",
            "worker": "Obscura · cấu hình lỗi",
            "engine": "obscura_public_scrape",
            "scanMode": "discovery_all",
            "previewOnly": true,
            "platforms": platforms,
            "maxResults": request.max_results,
            "platformResults": [],
            "cards": [],
            "browserSessionAttached": false,
            "networkCallsMade": false,
            "message": format!("Obscura đã được cấu hình nhưng không resolve được: {error}. Không tự rơi về engine khác để tránh báo sai.")
        }));
    }
    let mut obscura_attempt: Option<Value> = None;
    let mut base_report: Option<Value> = None;
    let mut browser_platforms = platforms.clone();
    if let Some(obscura_path) = obscura_path {
        let obscura_report = run_obscura_preview_scan(
            &platforms,
            request.max_results,
            &run_id,
            &workspace_root,
            obscura_path,
            &report_path,
            &report_relative,
        )
        .await;
        let obscura_report = obscura_report?;
        let report = run_bilibili_public_catalog_fallback(
            obscura_report,
            &platforms,
            request.max_results,
            &run_id,
            &workspace_root,
            node_path.as_ref(),
            &public_catalog_worker_path,
            &output_dir,
            &report_path,
        )
        .await?;
        browser_platforms = platforms
            .iter()
            .filter(|platform| !preview_report_has_cards_for_platform(&report, platform))
            .cloned()
            .collect();
        // Obscura may succeed for one platform while returning a shell or
        // navigation links for another. Keep the valid cards and hand only
        // the missing platforms to the user's one-tab BrowserOS session.
        if browser_platforms.is_empty()
            || !browser_handoff::browseros_backend_enabled()
            || node_path.is_none()
        {
            fs::write(
                &report_path,
                serde_json::to_vec_pretty(&report).map_err(|error| {
                    format!("Không serialize được preview scan report: {error}")
                })?,
            )
            .map_err(|error| format!("Không cập nhật được preview scan report: {error}"))?;
            return Ok(report);
        }
        obscura_attempt = Some(serde_json::json!({
            "status": report.get("status").and_then(Value::as_str).unwrap_or("blocked"),
            "worker": report.get("worker").and_then(Value::as_str).unwrap_or("Obscura · public scrape · concurrency 3"),
            "message": format!("Obscura chưa trả card hợp lệ cho: {}", browser_platforms.join(", ")),
            "cardCount": report.get("cards").and_then(Value::as_array).map(Vec::len).unwrap_or(0),
            "outputBytes": report.get("obscuraOutputBytes").and_then(Value::as_u64).unwrap_or(0),
        }));
        base_report = Some(report);
    }
    if !browser_handoff::browseros_backend_enabled() {
        let report = serde_json::json!({
            "status": "blocked",
            "worker": "Chưa có Obscura · BrowserOS đang tắt",
            "engine": "none",
            "scanMode": "discovery_all",
            "previewOnly": true,
            "platforms": platforms,
            "maxResults": request.max_results,
            "cards": [],
            "platformResults": [],
            "browserSessionAttached": false,
            "networkCallsMade": false,
            "runId": run_id,
            "reportPath": report_relative,
            "message": "Chưa cấu hình obscura.exe và BrowserOS backend đang tắt; chỉ thử public catalog adapter nào có sẵn, không tạo kết quả giả."
        });
        let report = run_bilibili_public_catalog_fallback(
            report,
            &platforms,
            request.max_results,
            &run_id,
            &workspace_root,
            node_path.as_ref(),
            &public_catalog_worker_path,
            &output_dir,
            &report_path,
        )
        .await?;
        fs::write(
            &report_path,
            serde_json::to_vec_pretty(&report)
                .map_err(|error| format!("Không serialize được preview scan report: {error}"))?,
        )
        .map_err(|error| format!("Không cập nhật được preview scan report: {error}"))?;
        return Ok(report);
    }
    let node_path = node_path.ok_or_else(|| {
        "Obscura chưa cấu hình và Node cũng chưa sẵn sàng cho BrowserOS fallback; hãy cấu hình obscura.exe hoặc node.exe trong Cài đặt.".to_string()
    })?;
    let platforms_json = serde_json::to_string(&browser_platforms)
        .map_err(|error| format!("Không serialize được danh sách nền tảng: {error}"))?;
    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "node".to_string(),
            args: vec![
                worker_relative,
                "--platforms-json".to_string(),
                platforms_json,
                "--max-results".to_string(),
                request.max_results.to_string(),
                "--run-id".to_string(),
                run_id.clone(),
                "--output".to_string(),
                browser_report_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: 360,
            expected_outputs: vec![browser_report_relative.clone()],
        },
        executable_path: node_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;

    let mut browser_report = fs::read_to_string(&browser_report_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or_else(|| {
            serde_json::json!({
                "status": "failed",
                "cards": [],
                "platformResults": [],
                "message": "Worker không ghi được report preview scan."
            })
        });
    let raw_status = browser_report
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("blocked")
        .to_string();
    let status = if process.timed_out || process.cancelled {
        "failed".to_string()
    } else if !process.succeeded && matches!(raw_status.as_str(), "success" | "partial") {
        "failed".to_string()
    } else if matches!(raw_status.as_str(), "success" | "partial" | "blocked") {
        raw_status
    } else {
        "blocked".to_string()
    };
    let fallback_message = if process.timed_out {
        "Preview scan hết thời gian 360 giây; worker đã bị dừng."
    } else if process.cancelled {
        "Preview scan đã bị hủy trước khi hoàn tất."
    } else if !process.succeeded {
        "Preview scan worker kết thúc không thành công; không coi là đã quét xong."
    } else {
        "Worker chưa trả thông báo kết quả hợp lệ."
    };
    let message = browser_report
        .get("message")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(fallback_message)
        .to_string();
    {
        let object = browser_report
            .as_object_mut()
            .ok_or_else(|| "Preview scan report phải là JSON object".to_string())?;
        object.insert("status".to_string(), Value::String(status));
        object.insert("projectId".to_string(), Value::String(project_id.clone()));
        object.insert("runId".to_string(), Value::String(run_id.clone()));
        object.insert(
            "reportPath".to_string(),
            Value::String(browser_report_relative.clone()),
        );
        object.insert("message".to_string(), Value::String(message));
        object.insert(
            "process".to_string(),
            serde_json::to_value(&process)
                .map_err(|error| format!("Không serialize được process evidence: {error}"))?,
        );
    }
    let report = if let Some(mut base_report) = base_report {
        if let Some(attempt) = obscura_attempt {
            if let Some(object) = base_report.as_object_mut() {
                object.insert("obscuraAttempt".to_string(), attempt);
            }
        }
        merge_preview_platform_fallback(base_report, &browser_report, &browser_platforms, &process)?
    } else {
        let mut report = browser_report;
        let report_object = report
            .as_object_mut()
            .ok_or_else(|| "Preview scan report phải là JSON object".to_string())?;
        report_object.insert(
            "reportPath".to_string(),
            Value::String(report_relative.clone()),
        );
        report_object.insert("projectId".to_string(), Value::String(project_id));
        report_object.insert("runId".to_string(), Value::String(run_id));
        report_object.insert(
            "worker".to_string(),
            Value::String("BrowserOS neo · 1 tab tuần tự".to_string()),
        );
        report_object.insert(
            "engine".to_string(),
            Value::String("browseros_preview_scan".to_string()),
        );
        report
    };
    fs::write(
        &report_path,
        serde_json::to_vec_pretty(&report)
            .map_err(|error| format!("Không serialize được preview scan report: {error}"))?,
    )
    .map_err(|error| format!("Không cập nhật được preview scan report: {error}"))?;
    Ok(report)
}

#[tauri::command]
pub(super) async fn scan_preview_creator_catalog(
    request: PreviewCreatorScanRequest,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    valid_text(&request.project_id, "Project ID")?;
    valid_text(&request.platform, "Nền tảng")?;
    valid_text(&request.source_url, "URL creator/playlist")?;
    if !(1..=200).contains(&request.max_results) {
        return Err("Số video phải nằm trong khoảng 1..200".to_string());
    }
    let project_id = request.project_id.trim().to_string();
    let platform = request.platform.trim().to_ascii_lowercase();
    if !PREVIEW_DISCOVERY_PLATFORMS.contains(&platform.as_str()) {
        return Err(format!("Nền tảng preview chưa được allowlist: {platform}"));
    }
    let source_url = validate_preview_creator_source_url(&request.source_url, &platform)?;

    let (workspace_root, ytdlp_path, ytdlp_error) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        ensure_project_exists(&connection, &project_id)?;
        let workspace_root = fs::canonicalize(project_workspace_root(&connection, &project_id)?)
            .map_err(|error| format!("Không canonicalize được project workspace: {error}"))?;
        match resolve_configured_tool(&connection, "yt-dlp") {
            Ok(path) => (workspace_root, Some(path), None),
            Err(error) => (workspace_root, None, Some(error)),
        }
    };

    let run_id = now_id("preview-creator-scan");
    let output_dir = workspace_root
        .join(".auto3dvideo")
        .join("runs")
        .join(&run_id)
        .join("preview-creator-scan");
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Không tạo được thư mục creator scan: {error}"))?;
    let report_path = output_dir.join("preview-creator-scan-report.json");
    let report_relative = report_path
        .strip_prefix(&workspace_root)
        .map_err(|_| "Creator scan report vượt project workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    if let Some(error) = ytdlp_error {
        let report = serde_json::json!({
            "status": "blocked",
            "worker": "yt-dlp · creator/playlist catalog",
            "engine": "yt_dlp_creator_catalog",
            "scanMode": "creator_catalog",
            "previewOnly": true,
            "platforms": [platform],
            "maxResults": request.max_results,
            "sourceUrl": source_url,
            "platformResults": [{
                "platform": platform,
                "status": "blocked",
                "scannedCount": 0,
                "discoveryUrl": source_url,
                "message": format!("Chưa sẵn sàng quét catalog: {error}. Hãy cấu hình yt-dlp.exe trong Cài đặt.")
            }],
            "cards": [],
            "browserSessionAttached": false,
            "networkCallsMade": false,
            "runId": run_id,
            "reportPath": report_relative,
            "message": format!("Chưa chạy creator scan: {error}. Không gọi web và không tạo kết quả giả.")
        });
        let bytes = serde_json::to_vec_pretty(&report).map_err(|serialize_error| {
            format!("Không serialize được creator scan report: {serialize_error}")
        })?;
        fs::write(&report_path, bytes)
            .map_err(|write_error| format!("Không ghi được creator scan report: {write_error}"))?;
        return Ok(report);
    }

    let ytdlp_path = ytdlp_path.ok_or_else(|| "Không resolve được yt-dlp.exe".to_string())?;
    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "yt-dlp".to_string(),
            args: vec![
                "--ignore-config".to_string(),
                "--flat-playlist".to_string(),
                "--skip-download".to_string(),
                "--ignore-errors".to_string(),
                "--no-warnings".to_string(),
                "--dump-single-json".to_string(),
                "--playlist-end".to_string(),
                request.max_results.to_string(),
                "--socket-timeout".to_string(),
                "20".to_string(),
                "--retries".to_string(),
                "2".to_string(),
                source_url.clone(),
            ],
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: 180,
            expected_outputs: Vec::new(),
        },
        executable_path: ytdlp_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;

    let mut report = build_ytdlp_creator_preview_report(
        &process.stdout,
        &platform,
        &source_url,
        request.max_results,
    );
    let raw_status = report
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("blocked")
        .to_string();
    let status = if process.timed_out || process.cancelled || !process.succeeded {
        "failed"
    } else {
        raw_status.as_str()
    };
    let message = if process.timed_out {
        "Creator scan hết thời gian 180 giây; yt-dlp đã bị dừng, không coi là quét xong."
            .to_string()
    } else if process.cancelled {
        "Creator scan đã bị hủy trước khi hoàn tất.".to_string()
    } else if !process.succeeded {
        format!(
            "yt-dlp kết thúc không thành công; không coi là quét xong. {}",
            process
                .stderr
                .lines()
                .next()
                .unwrap_or("Kiểm tra extractor và quyền truy cập nguồn.")
        )
    } else {
        report
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("yt-dlp chưa trả thông báo kết quả hợp lệ.")
            .to_string()
    };
    let object = report
        .as_object_mut()
        .ok_or_else(|| "Creator scan report phải là JSON object".to_string())?;
    object.insert("status".to_string(), Value::String(status.to_string()));
    object.insert("projectId".to_string(), Value::String(project_id));
    object.insert("runId".to_string(), Value::String(run_id));
    object.insert("reportPath".to_string(), Value::String(report_relative));
    object.insert("message".to_string(), Value::String(message));
    let mut process_evidence = process.clone();
    process_evidence.stdout = format!(
        "yt-dlp stdout đã parse: {} byte; raw catalog không ghi vào report.",
        process.stdout_bytes
    );
    object.insert(
        "process".to_string(),
        serde_json::to_value(process_evidence)
            .map_err(|error| format!("Không serialize được yt-dlp process evidence: {error}"))?,
    );
    let bytes = serde_json::to_vec_pretty(&report)
        .map_err(|error| format!("Không serialize được creator scan report: {error}"))?;
    if bytes.is_empty() {
        return Err("Creator scan report rỗng".to_string());
    }
    fs::write(&report_path, bytes)
        .map_err(|error| format!("Không ghi được creator scan report: {error}"))?;
    let report_size = fs::metadata(&report_path)
        .map_err(|error| format!("Không xác nhận được creator scan report: {error}"))?
        .len();
    if report_size == 0 {
        return Err("Creator scan report ghi ra nhưng có kích thước 0".to_string());
    }
    Ok(report)
}

#[tauri::command]
pub(super) async fn scan_licensed_footage_discovery(
    request: LicensedFootageScanRequest,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    valid_text(&request.project_id, "Project ID")?;
    if !(1..=200).contains(&request.max_results) {
        return Err("Số footage phải nằm trong khoảng 1..200".to_string());
    }
    let project_id = request.project_id.trim().to_string();
    let (workspace_root, python_path) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Không thể khóa database".to_string())?;
        ensure_project_exists(&connection, &project_id)?;
        project_workspace_and_python(&connection, &project_id)?
    };

    let run_id = now_id("licensed-footage-scan");
    let output_dir = workspace_root
        .join(".auto3dvideo")
        .join("runs")
        .join(&run_id)
        .join("licensed-footage-scan");
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Không tạo được thư mục licensed footage scan: {error}"))?;
    let worker_path = workspace_root
        .join(".auto3dvideo")
        .join("tools")
        .join("licensed_footage_preview_worker.py");
    browser_handoff::sync_embedded_worker(
        &worker_path,
        LICENSED_FOOTAGE_PREVIEW_WORKER_SCRIPT,
        "Licensed footage preview worker",
    )?;
    let report_path = output_dir.join("licensed-footage-scan-report.json");
    let relative = |path: &Path| -> Result<String, String> {
        path.strip_prefix(&workspace_root)
            .map_err(|_| "Licensed footage scan output vượt project workspace".to_string())
            .map(|value| value.to_string_lossy().replace('\\', "/"))
    };
    let worker_relative = relative(&worker_path)?;
    let report_relative = relative(&report_path)?;
    let process = run_external_process(ExternalProcessRequest {
        spec: ProcessSpec {
            executable_id: "python".to_string(),
            args: vec![
                worker_relative,
                "--max-results".to_string(),
                request.max_results.to_string(),
                "--output".to_string(),
                report_relative.clone(),
            ],
            working_directory: ".".to_string(),
            environment: Default::default(),
            timeout_seconds: 180,
            expected_outputs: vec![report_relative.clone()],
        },
        executable_path: python_path,
        absolute_working_directory: workspace_root.clone(),
        output_root: workspace_root.clone(),
        cancellation: Arc::new(AtomicBool::new(false)),
    })
    .await?;

    let mut report = fs::read_to_string(&report_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or_else(|| {
            serde_json::json!({
                "status": "failed",
                "cards": [],
                "platformResults": [],
                "message": "Worker licensed footage không ghi được report."
            })
        });
    let raw_status = report
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("blocked")
        .to_string();
    let status = if process.timed_out || process.cancelled || !process.succeeded {
        "failed"
    } else if matches!(raw_status.as_str(), "success" | "partial" | "blocked") {
        raw_status.as_str()
    } else {
        "blocked"
    };
    let message = if process.timed_out {
        "Quét footage hết thời gian 180 giây; worker đã bị dừng, không coi là quét xong."
            .to_string()
    } else if process.cancelled {
        "Quét footage đã bị hủy trước khi hoàn tất.".to_string()
    } else if !process.succeeded {
        format!(
            "Worker quét footage kết thúc không thành công; không coi là quét xong. {}",
            process
                .stderr
                .lines()
                .next()
                .unwrap_or("Kiểm tra Python và kết nối Wikimedia Commons.")
        )
    } else {
        report
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Worker chưa trả thông báo kết quả hợp lệ.")
            .to_string()
    };
    let object = report
        .as_object_mut()
        .ok_or_else(|| "Licensed footage report phải là JSON object".to_string())?;
    object.insert("status".to_string(), Value::String(status.to_string()));
    object.insert("projectId".to_string(), Value::String(project_id));
    object.insert("runId".to_string(), Value::String(run_id));
    object.insert("reportPath".to_string(), Value::String(report_relative));
    object.insert("message".to_string(), Value::String(message));
    let mut process_evidence = process.clone();
    process_evidence.stdout = format!(
        "Licensed footage worker stdout đã parse: {} byte; raw response không ghi vào report.",
        process.stdout_bytes
    );
    object.insert(
        "process".to_string(),
        serde_json::to_value(process_evidence).map_err(|error| {
            format!("Không serialize được licensed footage process evidence: {error}")
        })?,
    );
    let bytes = serde_json::to_vec_pretty(&report)
        .map_err(|error| format!("Không serialize được licensed footage report: {error}"))?;
    fs::write(&report_path, bytes)
        .map_err(|error| format!("Không cập nhật được licensed footage report: {error}"))?;
    if fs::metadata(&report_path)
        .map_err(|error| format!("Không xác nhận được licensed footage report: {error}"))?
        .len()
        == 0
    {
        return Err("Licensed footage report ghi ra nhưng có kích thước 0".to_string());
    }
    Ok(report)
}
