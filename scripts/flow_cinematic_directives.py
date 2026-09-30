"""Allowlisted cinematic prompt vocabulary shared by the local shot planner.

The slash tokens are prompt annotations from the user's Flow reference sheets.
They are never browser actions and must not be interpreted as UI commands.
"""

from __future__ import annotations

import re
from typing import Any


# command, group, Vietnamese explanation
FLOW_CINEMATIC_DIRECTIVES: tuple[tuple[str, str, str], ...] = (
    ("/groundlevel", "camera_angle", "đặt máy sát đất để chủ thể trông quyền lực và bề thế"),
    ("/birdseye", "camera_angle", "nhìn từ trên cao để nhấn sự đơn độc và lẻ loi"),
    ("/skyview", "camera_angle", "góc nhìn cao, bao quát và mở rộng không gian"),
    ("/straightdown", "camera_angle", "nhìn vuông góc từ trên xuống, rõ ràng và gọn"),
    ("/firstperson", "camera_angle", "đưa khán giả vào vị trí người trong cuộc"),
    ("/secondview", "camera_angle", "khung hình đối thoại tự nhiên cho hai người"),
    ("/openingshot", "camera_angle", "cảnh mở màn để thiết lập bối cảnh"),
    ("/focusswap", "camera_angle", "chuyển điểm chú ý trong khung hình"),
    ("/fullscene", "framing", "cho thấy không gian và quy mô"),
    ("/vastview", "framing", "tạo cảm giác hoành tráng và quy mô lớn"),
    ("/closecrop", "framing", "tập trung trọn vẹn vào chủ thể"),
    ("/tightframe", "framing", "cận chi tiết để làm nổi bật chủ thể và cảm xúc"),
    ("/extremeclose", "framing", "làm lộ những chi tiết và bề mặt ẩn"),
    ("/thirdgrid", "framing", "cân bằng hình ảnh theo tỉ lệ một phần ba"),
    ("/innerframe", "framing", "dùng cảnh vật để tôn chủ thể"),
    ("/midpoint", "framing", "đặt trọng tâm ngay chính giữa khung hình"),
    ("/allclear", "framing", "giữ toàn cảnh rõ nét"),
    ("/pushin", "camera_movement", "máy quay tiến dần vào để tăng cảm giác kịch tính"),
    ("/pullback", "camera_movement", "máy quay lùi ra để hé lộ và mở rộng bối cảnh"),
    ("/followshot", "camera_movement", "bám theo chủ thể đang di chuyển"),
    ("/circleshot", "camera_movement", "quay vòng quanh chủ thể để làm nổi bật đối tượng"),
    ("/hheld", "camera_movement", "rung máy tự nhiên"),
    ("/glidecam", "camera_movement", "chuyển động mượt mà"),
    ("/liftup", "camera_movement", "hé lộ không gian rộng lớn hơn"),
    ("/settledown", "camera_movement", "tạo cảm giác gần gũi"),
    ("/sprintmode", "action", "hành động giàu năng lượng"),
    ("/strollmode", "action", "chuyển động tự nhiên"),
    ("/spinreveal", "action", "hiện sản phẩm hoặc chủ thể 360 độ"),
    ("/unveil", "action", "màn hé lộ đầy kịch tính"),
    ("/firstlook", "action", "màn xuất hiện mạnh mẽ"),
    ("/lastlook", "action", "kết cảnh giàu cảm xúc"),
    ("/weightless", "action", "chuyển động nhẹ như mơ"),
    ("/dropshot", "action", "cú rơi gấp gáp, mạnh mẽ"),
    ("/timestretch", "time_speed", "làm chậm chuyển động để tạo hiệu ứng điện ảnh"),
    ("/fastforward", "time_speed", "tăng tốc thời gian để thể hiện sự trôi nhanh"),
    ("/hypershot", "time_speed", "chuyển động cực nhanh, tạo cảm giác lao qua không gian"),
    ("/timestop", "time_speed", "đóng băng khoảnh khắc cao trào"),
    ("/speedshift", "time_speed", "chuyển từ nhanh sang chậm"),
    ("/matrixtime", "time_speed", "hiệu ứng thời gian kiểu bullet time"),
    ("/speedblur", "time_speed", "thể hiện tốc độ bằng motion blur có kiểm soát"),
    ("/sunsetglow", "lighting", "ánh sáng giờ vàng ấm áp"),
    ("/duskhour", "lighting", "không khí chạng vạng mát lành"),
    ("/neonpulse", "lighting", "ánh sáng neon rực rỡ"),
    ("/darkmood", "lighting", "ánh sáng tối, tương phản kịch tính"),
    ("/softbox", "lighting", "ánh sáng studio mềm mại"),
    ("/edgelight", "lighting", "viền sáng nổi bật quanh chủ thể"),
    ("/shadowform", "lighting", "bóng silhouette mạnh mẽ"),
    ("/spotbeam", "lighting", "luồng sáng tập trung"),
    ("/lightrays", "lighting", "tia sáng tạo chiều sâu không khí"),
    ("/glowbehind", "lighting", "ánh sáng ngược mơ màng"),
    ("/nightcity", "lighting", "khung cảnh thành phố đêm điện ảnh"),
    ("/glowskin", "portrait_focus", "da sáng đẹp tự nhiên, tôn nét mặt"),
    ("/softbackdrop", "portrait_focus", "hậu cảnh mờ nhẹ, loại bỏ chi tiết gây xao nhãng"),
    ("/crispsubject", "portrait_focus", "độ nét chân dung chân thực, rõ từng chi tiết"),
    ("/macroeyes", "portrait_focus", "cận cảnh ánh mắt"),
    ("/headtotoe", "portrait_focus", "thể hiện đầy đủ dáng vóc nhân vật"),
    ("/blurback", "portrait_focus", "độ sâu trường ảnh nông, nền mờ"),
    ("/isolatefocus", "portrait_focus", "tách chủ thể khỏi hậu cảnh"),
    ("/gazepoint", "portrait_focus", "tập trung vào đôi mắt"),
    ("/coresharp", "portrait_focus", "lấy nét sắc ở trung tâm"),
    ("/darkedges", "detail_emphasis", "tạo hiệu ứng tập trung kiểu đường hầm"),
    ("/layerstack", "detail_emphasis", "nhiều điểm lấy nét"),
    ("/dropdetail", "detail_emphasis", "làm nổi bật chi tiết rất nhỏ"),
    ("/precisefocus", "detail_emphasis", "kiểm soát điểm lấy nét chính xác"),
    ("/lightshapes", "detail_emphasis", "tạo bokeh theo hình tùy chỉnh"),
    ("/burstzoom", "detail_emphasis", "hiệu ứng zoom mạnh, kịch tính"),
    ("/spinblur", "detail_emphasis", "làm mờ xoay hướng tâm"),
    ("/filmlook", "film_look", "màu sắc và tương phản như phim chiếu rạp"),
    ("/singletone", "film_look", "đơn sắc kinh điển, cảm xúc hoài niệm"),
    ("/oldfilm", "film_look", "cảm giác phim cổ điển"),
    ("/duotone", "film_look", "phối màu hai tông"),
    ("/grayscale", "film_look", "đen trắng giàu kịch tính"),
    ("/amberlook", "film_look", "ấm áp, hoài niệm"),
    ("/icylook", "film_look", "mát lạnh, sạch và yên tĩnh"),
    ("/highcontrast", "film_look", "hình ảnh điện ảnh tương phản mạnh"),
    ("/brightbalance", "film_look", "phơi sáng sạch, chuyên nghiệp"),
    ("/colorpop", "color_effect", "làm màu sắc sống động hơn"),
    ("/mutedtone", "color_effect", "tông màu dịu, mang chất nghệ thuật"),
    ("/gradeflat", "color_effect", "màu phim mượt, chín chu"),
    ("/orangeteal", "color_effect", "phong cách màu bom tấn cam xanh"),
    ("/boldcolor", "color_effect", "màu sắc nổi bật, thu hút ánh nhìn"),
    ("/purebw", "color_effect", "đen trắng thanh lịch, vượt thời gian"),
    ("/neonwash", "color_effect", "phong cách neon tương lai mạnh mẽ"),
    ("/softdots", "color_effect", "bokeh mềm mại, mơ màng"),
    ("/sunflare", "color_effect", "lóa sáng ống kính điện ảnh"),
    ("/edgefade", "color_effect", "làm tối viền khung hình"),
    ("/rainbowsplit", "color_effect", "hiệu ứng tách sáng lăng kính"),
    ("/digitalglitch", "color_effect", "hiệu ứng kỹ thuật số có chủ đích"),
)

FLOW_DIRECTIVE_BY_COMMAND = {command: (group, instruction) for command, group, instruction in FLOW_CINEMATIC_DIRECTIVES}


def normalize_flow_directives(value: Any, maximum: int = 8) -> list[str]:
    values = value if isinstance(value, list) else value.split(";") if isinstance(value, str) else []
    result: list[str] = []
    for raw in values:
        if not isinstance(raw, str):
            continue
        command = raw.strip().lower().replace(" ", "").rstrip(":")
        if command and not command.startswith("/"):
            command = f"/{command}"
        if command in FLOW_DIRECTIVE_BY_COMMAND and command not in result:
            result.append(command)
        if len(result) >= maximum:
            break
    return result


def extract_flow_directives(*values: str) -> list[str]:
    """Extract explicit user tokens without accepting arbitrary slash commands."""
    candidates: list[str] = []
    for value in values:
        if isinstance(value, str):
            candidates.extend(re.findall(r"/[a-z][a-z ]{1,24}", value.lower()))
    return normalize_flow_directives(candidates, maximum=8)


def describe_flow_directives(value: Any) -> str:
    commands = normalize_flow_directives(value)
    return "; ".join(f"{command} — {FLOW_DIRECTIVE_BY_COMMAND[command][1]}" for command in commands) or "camera tự nhiên và nhất quán"


def flow_directive_vocabulary() -> str:
    groups: dict[str, list[str]] = {}
    for command, group, instruction in FLOW_CINEMATIC_DIRECTIVES:
        groups.setdefault(group, []).append(f"{command}={instruction}")
    return "\n".join(f"{group}: {'; '.join(items)}" for group, items in groups.items())


# A bounded, repeatable starter pattern. The model may replace these only with
# allowlisted commands; the natural-language explanation remains authoritative.
DEFAULT_FLOW_DIRECTIVES_BY_SHOT: tuple[tuple[str, ...], ...] = (
    ("/openingshot", "/vastview", "/pullback", "/filmlook", "/brightbalance"),
    ("/groundlevel", "/fullscene", "/followshot", "/strollmode", "/sunsetglow"),
    ("/closecrop", "/pushin", "/focusswap", "/spotbeam", "/coresharp"),
    ("/thirdgrid", "/glidecam", "/unveil", "/edgelight", "/highcontrast"),
    ("/innerframe", "/circleshot", "/spinreveal", "/lightrays", "/colorpop"),
    ("/headtotoe", "/liftup", "/weightless", "/glowbehind", "/filmlook"),
    ("/tightframe", "/burstzoom", "/speedshift", "/darkmood", "/crispsubject"),
    ("/vastview", "/pullback", "/lastlook", "/timestop", "/amberlook"),
)


def default_flow_directives(shot_index: int) -> list[str]:
    if shot_index < 1:
        shot_index = 1
    return list(DEFAULT_FLOW_DIRECTIVES_BY_SHOT[(shot_index - 1) % len(DEFAULT_FLOW_DIRECTIVES_BY_SHOT)])
