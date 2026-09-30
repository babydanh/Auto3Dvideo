export type FlowDirectiveGroup =
  | "camera_angle"
  | "framing"
  | "camera_movement"
  | "action"
  | "time_speed"
  | "lighting"
  | "portrait_focus"
  | "detail_emphasis"
  | "film_look"
  | "color_effect";

export type FlowCinematicDirective = {
  command: string;
  group: FlowDirectiveGroup;
  label: string;
  instruction: string;
};

const directive = (
  command: string,
  group: FlowDirectiveGroup,
  label: string,
  instruction: string,
): FlowCinematicDirective => ({ command, group, label, instruction });

/**
 * Prompt vocabulary from the user's Flow camera reference sheets.
 * These are prompt tokens, not browser/UI commands. Keep the spelling stable
 * because the exact token is recorded in the shot plan and audit trail.
 */
export const FLOW_CINEMATIC_DIRECTIVES: readonly FlowCinematicDirective[] = [
  directive("/groundlevel", "camera_angle", "Góc sát đất", "đặt máy sát đất để chủ thể trông quyền lực và bề thế"),
  directive("/birdseye", "camera_angle", "Góc nhìn chim", "nhìn từ trên cao để nhấn sự đơn độc và lẻ loi"),
  directive("/skyview", "camera_angle", "Góc nhìn bầu trời", "góc nhìn cao, bao quát và mở rộng không gian"),
  directive("/straightdown", "camera_angle", "Nhìn thẳng xuống", "nhìn vuông góc từ trên xuống, rõ ràng và gọn"),
  directive("/firstperson", "camera_angle", "Góc nhìn thứ nhất", "đưa khán giả vào vị trí người trong cuộc"),
  directive("/secondview", "camera_angle", "Góc đối thoại", "khung hình đối thoại tự nhiên cho hai người"),
  directive("/openingshot", "camera_angle", "Cảnh mở màn", "cảnh mở màn để thiết lập bối cảnh"),
  directive("/focusswap", "camera_angle", "Đổi điểm nét", "chuyển điểm chú ý trong khung hình"),

  directive("/fullscene", "framing", "Toàn cảnh", "cho thấy không gian và quy mô"),
  directive("/vastview", "framing", "Toàn cảnh rộng", "tạo cảm giác hoành tráng và quy mô lớn"),
  directive("/closecrop", "framing", "Cận cảnh", "tập trung trọn vẹn vào chủ thể"),
  directive("/tightframe", "framing", "Khung chặt", "cận chi tiết để làm nổi bật chủ thể và cảm xúc"),
  directive("/extremeclose", "framing", "Siêu cận", "làm lộ những chi tiết và bề mặt ẩn"),
  directive("/thirdgrid", "framing", "Quy tắc một phần ba", "cân bằng hình ảnh theo tỉ lệ một phần ba"),
  directive("/innerframe", "framing", "Khung trong khung", "dùng cảnh vật để tôn chủ thể"),
  directive("/midpoint", "framing", "Trung tâm khung", "đặt trọng tâm ngay chính giữa khung hình"),
  directive("/allclear", "framing", "Toàn cảnh rõ nét", "giữ toàn cảnh rõ nét"),

  directive("/pushin", "camera_movement", "Tiến máy", "máy quay tiến dần vào để tăng cảm giác kịch tính"),
  directive("/pullback", "camera_movement", "Lùi máy", "máy quay lùi ra để hé lộ và mở rộng bối cảnh"),
  directive("/followshot", "camera_movement", "Bám chủ thể", "bám theo chủ thể đang di chuyển"),
  directive("/circleshot", "camera_movement", "Quay vòng", "quay vòng quanh chủ thể để làm nổi bật đối tượng"),
  directive("/hheld", "camera_movement", "Cầm tay", "rung máy tự nhiên"),
  directive("/glidecam", "camera_movement", "Trượt mượt", "chuyển động mượt mà"),
  directive("/liftup", "camera_movement", "Nâng máy", "hé lộ không gian rộng lớn hơn"),
  directive("/settledown", "camera_movement", "Hạ máy ổn định", "tạo cảm giác gần gũi"),

  directive("/sprintmode", "action", "Nhịp chạy", "hành động giàu năng lượng"),
  directive("/strollmode", "action", "Nhịp dạo", "chuyển động tự nhiên"),
  directive("/spinreveal", "action", "Xoay hé lộ", "hiện sản phẩm hoặc chủ thể 360 độ"),
  directive("/unveil", "action", "Hé lộ", "màn hé lộ đầy kịch tính"),
  directive("/firstlook", "action", "Lần xuất hiện đầu", "màn xuất hiện mạnh mẽ"),
  directive("/lastlook", "action", "Ánh nhìn cuối", "kết cảnh giàu cảm xúc"),
  directive("/weightless", "action", "Không trọng lượng", "chuyển động nhẹ như mơ"),
  directive("/dropshot", "action", "Cú rơi", "cú rơi gấp gáp, mạnh mẽ"),

  directive("/timestretch", "time_speed", "Kéo giãn thời gian", "làm chậm chuyển động để tạo hiệu ứng điện ảnh"),
  directive("/fastforward", "time_speed", "Tua nhanh", "tăng tốc thời gian để thể hiện sự trôi nhanh"),
  directive("/hypershot", "time_speed", "Tốc độ cực nhanh", "chuyển động cực nhanh, tạo cảm giác lao qua không gian"),
  directive("/timestop", "time_speed", "Đóng băng khoảnh khắc", "đóng băng khoảnh khắc cao trào"),
  directive("/speedshift", "time_speed", "Đổi tốc", "chuyển từ nhanh sang chậm"),
  directive("/matrixtime", "time_speed", "Bullet time", "hiệu ứng thời gian kiểu bullet time"),
  directive("/speedblur", "time_speed", "Nhòe tốc độ", "thể hiện tốc độ bằng motion blur có kiểm soát"),

  directive("/sunsetglow", "lighting", "Hoàng hôn", "ánh sáng giờ vàng ấm áp"),
  directive("/duskhour", "lighting", "Chạng vạng", "không khí chạng vạng mát lành"),
  directive("/neonpulse", "lighting", "Xung neon", "ánh sáng neon rực rỡ"),
  directive("/darkmood", "lighting", "Tâm trạng tối", "ánh sáng tối, tương phản kịch tính"),
  directive("/softbox", "lighting", "Softbox", "ánh sáng studio mềm mại"),
  directive("/edgelight", "lighting", "Viền sáng", "viền sáng nổi bật quanh chủ thể"),
  directive("/shadowform", "lighting", "Silhouette", "bóng silhouette mạnh mẽ"),
  directive("/spotbeam", "lighting", "Tia tập trung", "luồng sáng tập trung"),
  directive("/lightrays", "lighting", "Tia thể tích", "tia sáng tạo chiều sâu không khí"),
  directive("/glowbehind", "lighting", "Sáng ngược", "ánh sáng ngược mơ màng"),
  directive("/nightcity", "lighting", "Thành phố đêm", "khung cảnh thành phố đêm điện ảnh"),

  directive("/glowskin", "portrait_focus", "Da sáng", "da sáng đẹp tự nhiên, tôn nét mặt"),
  directive("/softbackdrop", "portrait_focus", "Hậu cảnh mềm", "hậu cảnh mờ nhẹ, loại bỏ chi tiết gây xao nhãng"),
  directive("/crispsubject", "portrait_focus", "Chủ thể sắc nét", "độ nét chân dung chân thực, rõ từng chi tiết"),
  directive("/macroeyes", "portrait_focus", "Mắt siêu cận", "cận cảnh ánh mắt"),
  directive("/headtotoe", "portrait_focus", "Toàn thân", "thể hiện đầy đủ dáng vóc nhân vật"),
  directive("/blurback", "portrait_focus", "Xóa phông", "độ sâu trường ảnh nông, nền mờ"),
  directive("/isolatefocus", "portrait_focus", "Tách nét", "tách chủ thể khỏi hậu cảnh"),
  directive("/gazepoint", "portrait_focus", "Điểm nhìn", "tập trung vào đôi mắt"),
  directive("/coresharp", "portrait_focus", "Nét trung tâm", "lấy nét sắc ở trung tâm"),

  directive("/darkedges", "detail_emphasis", "Viền tối", "tạo hiệu ứng tập trung kiểu đường hầm"),
  directive("/layerstack", "detail_emphasis", "Nhiều lớp nét", "nhiều điểm lấy nét"),
  directive("/dropdetail", "detail_emphasis", "Rơi vào chi tiết", "làm nổi bật chi tiết rất nhỏ"),
  directive("/precisefocus", "detail_emphasis", "Nét chính xác", "kiểm soát điểm lấy nét chính xác"),
  directive("/lightshapes", "detail_emphasis", "Bokeh hình", "tạo bokeh theo hình tùy chỉnh"),
  directive("/burstzoom", "detail_emphasis", "Zoom bùng nổ", "hiệu ứng zoom mạnh, kịch tính"),
  directive("/spinblur", "detail_emphasis", "Nhòe xoay", "làm mờ xoay hướng tâm"),

  directive("/filmlook", "film_look", "Chất phim", "màu sắc và tương phản như phim chiếu rạp"),
  directive("/singletone", "film_look", "Đơn sắc", "đơn sắc kinh điển, cảm xúc hoài niệm"),
  directive("/oldfilm", "film_look", "Phim cổ điển", "cảm giác phim cổ điển"),
  directive("/duotone", "film_look", "Hai tông", "phối màu hai tông"),
  directive("/grayscale", "film_look", "Đen trắng", "đen trắng giàu kịch tính"),
  directive("/amberlook", "film_look", "Hổ phách", "ấm áp, hoài niệm"),
  directive("/icylook", "film_look", "Băng lạnh", "mát lạnh, sạch và yên tĩnh"),
  directive("/highcontrast", "film_look", "Tương phản cao", "hình ảnh điện ảnh tương phản mạnh"),
  directive("/brightbalance", "film_look", "Sáng cân bằng", "phơi sáng sạch, chuyên nghiệp"),

  directive("/colorpop", "color_effect", "Màu bật", "làm màu sắc sống động hơn"),
  directive("/mutedtone", "color_effect", "Màu dịu", "tông màu dịu, mang chất nghệ thuật"),
  directive("/gradeflat", "color_effect", "Màu phẳng mượt", "màu phim mượt, chín chu"),
  directive("/orangeteal", "color_effect", "Cam xanh", "phong cách màu bom tấn cam xanh"),
  directive("/boldcolor", "color_effect", "Màu đậm", "màu sắc nổi bật, thu hút ánh nhìn"),
  directive("/purebw", "color_effect", "Đen trắng tinh", "đen trắng thanh lịch, vượt thời gian"),
  directive("/neonwash", "color_effect", "Neon phủ", "phong cách neon tương lai mạnh mẽ"),
  directive("/softdots", "color_effect", "Bokeh mềm", "bokeh mềm mại, mơ màng"),
  directive("/sunflare", "color_effect", "Lóa ống kính", "lóa sáng ống kính điện ảnh"),
  directive("/edgefade", "color_effect", "Tối viền", "làm tối viền khung hình"),
  directive("/rainbowsplit", "color_effect", "Tách cầu vồng", "hiệu ứng tách sáng lăng kính"),
  directive("/digitalglitch", "color_effect", "Glitch số", "hiệu ứng kỹ thuật số có chủ đích"),
];

const FLOW_DIRECTIVE_BY_COMMAND = new Map(
  FLOW_CINEMATIC_DIRECTIVES.map((item) => [item.command, item]),
);

export function normalizeFlowDirective(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.trim().toLowerCase().replace(/\s+/g, "").replace(/:$/, "");
  if (!compact) return null;
  const command = compact.startsWith("/") ? compact : `/${compact}`;
  return FLOW_DIRECTIVE_BY_COMMAND.has(command) ? command : null;
}

export function normalizeFlowDirectives(value: unknown, max = 8): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[;,|]/) : [];
  const result: string[] = [];
  for (const item of values) {
    const command = normalizeFlowDirective(item);
    if (command && !result.includes(command)) result.push(command);
    if (result.length >= max) break;
  }
  return result;
}

export function describeFlowDirectives(value: unknown): string {
  const commands = normalizeFlowDirectives(value);
  if (!commands.length) return "Không có lệnh đặc biệt; ưu tiên camera tự nhiên và nhất quán.";
  return commands
    .map((command) => {
      const item = FLOW_DIRECTIVE_BY_COMMAND.get(command)!;
      return `${item.command} — ${item.instruction}`;
    })
    .join("; ");
}

export function formatFlowDirectives(value: unknown): string {
  const commands = normalizeFlowDirectives(value);
  return commands.length ? commands.join(" ") : "none";
}

const DEFAULT_FLOW_DIRECTIVES_BY_SHOT: readonly (readonly string[])[] = [
  ["/openingshot", "/vastview", "/pullback", "/filmlook", "/brightbalance"],
  ["/groundlevel", "/fullscene", "/followshot", "/strollmode", "/sunsetglow"],
  ["/closecrop", "/pushin", "/focusswap", "/spotbeam", "/coresharp"],
  ["/thirdgrid", "/glidecam", "/unveil", "/edgelight", "/highcontrast"],
  ["/innerframe", "/circleshot", "/spinreveal", "/lightrays", "/colorpop"],
  ["/headtotoe", "/liftup", "/weightless", "/glowbehind", "/filmlook"],
  ["/tightframe", "/burstzoom", "/speedshift", "/darkmood", "/crispsubject"],
  ["/vastview", "/pullback", "/lastlook", "/timestop", "/amberlook"],
];

export function flowDirectivesForShot(value: unknown, shotIndex: number): string[] {
  const commands = normalizeFlowDirectives(value, 5);
  if (commands.length) return commands;
  const safeIndex = Math.max(0, shotIndex);
  return [...DEFAULT_FLOW_DIRECTIVES_BY_SHOT[safeIndex % DEFAULT_FLOW_DIRECTIVES_BY_SHOT.length]];
}

export function flowDirectiveVocabularyPrompt(): string {
  const groups = new Map<FlowDirectiveGroup, FlowCinematicDirective[]>();
  for (const item of FLOW_CINEMATIC_DIRECTIVES) {
    const group = groups.get(item.group) ?? [];
    group.push(item);
    groups.set(item.group, group);
  }
  return Array.from(groups.entries())
    .map(([group, items]) => `${group}: ${items.map((item) => `${item.command}=${item.instruction}`).join("; ")}`)
    .join("\n");
}

export const FLOW_DIRECTIVE_PLANNER_RULES =
  "Các slash-token chỉ là từ vựng prompt, không phải lệnh UI. Với mỗi shot hãy chọn 1 góc/framing, tối đa 1 chuyển động, và 1–3 lệnh ánh sáng/màu/nhịp phù hợp; không nhồi toàn bộ danh sách, không bịa token ngoài allowlist. Luôn viết thêm diễn giải tự nhiên sau token.";
