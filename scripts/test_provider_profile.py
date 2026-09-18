"""Regression checks for the non-secret provider profile contract."""
from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "contracts" / "provider-profile.schema.json"


VALID = [
    "none",
    "env:AUTO3DVIDEO_API_KEY",
    "env:A1_B2",
    "os:auto3dvideo/provider-key",
    "os:WindowsCredential.Manager.v1",
]
INVALID = [
    "",
    "AUTO3DVIDEO_API_KEY",
    "env:auto3dvideo_api_key",
    "env:1AUTO3DVIDEO_KEY",
    "env:AUTO3DVIDEO_API_KEY=value",
    "sk-live-secret",
    "file:C:/secret.txt",
    "os:credential\\\\name",
    "os:credential name",
]


def main() -> int:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    credential_schema = schema["properties"]["credentialRef"]
    pattern = re.compile(credential_schema["pattern"])
    for value in VALID:
        if not pattern.fullmatch(value):
            print(f"PROVIDER_PROFILE_TEST=FAIL valid_value={value}")
            return 1
    for value in INVALID:
        if pattern.fullmatch(value):
            print(f"PROVIDER_PROFILE_TEST=FAIL invalid_value={value}")
            return 1
    if credential_schema.get("type") != ["string", "null"]:
        print("PROVIDER_PROFILE_TEST=FAIL type_shape")
        return 1
    print("PROVIDER_PROFILE_TEST=PASS")
    print("credential_ref_grammar=none_or_env_or_os")
    print("raw_secret_examples=rejected")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
