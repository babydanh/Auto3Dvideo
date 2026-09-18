"""Static and deterministic fixture checks for PLAN-023 Slice 2."""

from __future__ import annotations

import ast
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "scripts" / "true3d_multishot_worker.py"
SPEC = ROOT / "examples" / "plan023-true3d" / "multishot-spec.json"
CONTRACT = ROOT / "contracts" / "multi-shot-continuity.schema.json"


def main() -> None:
    worker_text = WORKER.read_text(encoding="utf-8")
    ast.parse(worker_text)
    lowered = worker_text.lower()
    for forbidden in ("subprocess", "socket", "requests", "os.system", "eval(", "exec("):
        assert forbidden not in lowered, f"forbidden capability marker: {forbidden}"
    for marker in ("assetHashesUnchanged", "driftFindings", "baseline_asset_library", "rerun_shot", "animation=True"):
        assert marker in worker_text, f"missing continuity marker: {marker}"
    contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    assert contract["additionalProperties"] is False
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    assert spec["jobType"] == "multishot.continuity"
    shots = spec["shots"]
    assert len(shots) == 8
    assert [shot["shotId"] for shot in shots] == sorted(shot["shotId"] for shot in shots)
    required = {"tiger-giant", "trex", "screen_direction_left_to_right", "jungle_blue_rim", "same_time_of_day", "scale_locked_meters"}
    assert all(required.issubset(set(shot["continuityAnchors"])) for shot in shots)
    assert len({json.dumps(shot, sort_keys=True) for shot in shots}) == 8
    print("TRUE3D_MULTISHOT_WORKER_STATIC_VALID")


if __name__ == "__main__":
    main()
