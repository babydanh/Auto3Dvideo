from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from local_script_worker import infer_scene_mode, prompt_grounding, scene_bible  # noqa: E402
from multishot_scene_builder import grounded_prompt_data  # noqa: E402


PROMPT = (
    "Hổ Bengal đực Hắc Vân được phóng đại 1,6 lần, cao vai khoảng 1,7 mét, "
    "dài toàn thân khoảng 4,6 mét, nặng khoảng 500 kg, xuyên qua vết rách thời gian "
    "và solo với T-Rex trong rừng kỷ Phấn Trắng."
)


def main() -> None:
    assert infer_scene_mode(PROMPT) == "prehistoric_dinosaur"
    grounding = prompt_grounding(PROMPT, "prehistoric_dinosaur", scene_bible("prehistoric_dinosaur"))
    tiger = next(item for item in grounding["characterBibles"] if item["characterId"] == "tiger-giant")
    trex = next(item for item in grounding["characterBibles"] if item["characterId"] == "trex")
    assert tiger["lengthMeters"] == 4.6
    assert tiger["shoulderHeightMeters"] == 1.7
    assert tiger["massKg"] == 500.0
    assert tiger["scaleMultiplier"] == 1.6
    assert trex["heightMeters"] == 12.0
    assert len(grounding["constraints"]) >= 4
    assert grounded_prompt_data({"promptGrounding": grounding}, "prehistoric_dinosaur") == grounding
    print("PROMPT_GROUNDING_TESTS_PASS=8")


if __name__ == "__main__":
    main()
