"""Loopback fake-MCP test for ordered Asset Pack generation and bounded retry."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

from asset_pack_mcp_worker import order_tasks


PNG_1X1 = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082")


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    worker = root / "scripts" / "asset_pack_mcp_worker.py"
    schema_path = root / "contracts" / "asset-generation-report.schema.json"
    with tempfile.TemporaryDirectory(prefix="auto3dvideo-asset-pack-mcp-") as temp:
        temp_root = Path(temp)
        server = temp_root / "fake_mcp_server.js"
        server.write_text(
            """const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082','hex');
const attempts = {};
let output = 0;
const rl = readline.createInterface({input: process.stdin});
rl.on('line', line => { let m; try { m = JSON.parse(line); } catch { return; }
if (m.method === 'initialize') return console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-03-26',serverInfo:{name:'fake-asset-pack',version:'1'},capabilities:{}}}));
if (m.method === 'tools/list') return console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'generate_image',inputSchema:{type:'object'}}]}}));
if (m.method === 'tools/call') { const prompt = m.params.arguments.prompt; attempts[prompt] = (attempts[prompt] || 0) + 1; if (prompt.includes('retry-once') && attempts[prompt] === 1) return console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32000,message:'temporary provider failure'}})); const file = path.join(process.env.FLOW_OUTPUT_DIR, 'generated-' + (++output) + '.png'); fs.mkdirSync(process.env.FLOW_OUTPUT_DIR,{recursive:true}); fs.writeFileSync(file,png); return console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:file}]}})); }
});
""",
            encoding="utf-8",
        )
        workspace = temp_root / "workspace"
        workspace.mkdir()
        spec = temp_root / "asset-pack-job.json"
        tasks = [
            {"assetItemId": "tiger-scale", "title": "Scale", "prompt": "Create a scale reference with the eight meter tiger and a human marker.", "negativePrompt": "No text, logo, watermark or distorted proportions.", "width": 1024, "height": 576, "role": "scale_reference", "rightsStatus": "pending", "dependsOn": ["tiger-identity", "cretaceous-world"]},
            {"assetItemId": "cretaceous-world", "title": "World", "prompt": "Create a Cretaceous valley environment reference with ferns and distant cliffs.", "negativePrompt": "No modern buildings, text, logo or watermark.", "width": 1024, "height": 576, "role": "environment", "rightsStatus": "pending", "dependsOn": ["tiger-identity"]},
            {"assetItemId": "tiger-identity", "title": "Tiger", "prompt": "Create a giant tiger identity reference, retry-once, with fixed stripes and scar.", "negativePrompt": "No extra limbs, text, logo, watermark or identity drift.", "width": 1024, "height": 576, "role": "identity", "rightsStatus": "pending", "dependsOn": []},
        ]
        spec.write_text(json.dumps({"schemaVersion": "1.0.0", "jobType": "asset.pack.generate", "provider": "nano_banana_mcp", "mode": "flow_browser", "projectId": "dinosaur-tiger", "packId": "dinosaur-tiger-pack", "runId": "run-asset-pack-001", "serverEntry": str(server), "flowCdpUrl": "http://127.0.0.1:9222", "toolName": "generate_image", "outputDirectory": ".auto3dvideo/runs/run-asset-pack-001", "maxAttempts": 2, "tasks": tasks}), encoding="utf-8")
        node = os.environ.get("NODE_EXE") or shutil.which("node") or shutil.which("node.exe")
        if not node:
            raise SystemExit("Node.js is required for the fake MCP protocol test")
        result = subprocess.run([sys.executable, str(worker), "--workspace", str(workspace), "--spec", str(spec), "--output-dir", ".auto3dvideo/runs/run-asset-pack-001", "--node", node], capture_output=True, text=True, timeout=45)
        if result.returncode != 0:
            raise SystemExit(f"worker_failed: {result.stderr}")
        report_path = workspace / ".auto3dvideo/runs/run-asset-pack-001/asset-generation-report.json"
        report = json.loads(report_path.read_text(encoding="utf-8"))
        errors = list(Draft202012Validator(json.loads(schema_path.read_text(encoding="utf-8")), format_checker=FormatChecker()).iter_errors(report))
        if errors:
            raise SystemExit("report_schema_invalid: " + "; ".join(error.message for error in errors))
        if report["status"] != "succeeded_needs_review" or report["itemCounts"] != {"total": 3, "succeeded": 3, "failed": 0, "blocked": 0, "needsReview": 3}:
            raise SystemExit(f"unexpected_report_summary: {report}")
        if [item["assetItemId"] for item in report["items"]] != ["tiger-identity", "cretaceous-world", "tiger-scale"]:
            raise SystemExit("dependency_order_not_preserved")
        if len(report["items"][0]["attempts"]) != 2 or report["items"][0]["attempts"][0]["status"] != "failed" or report["items"][0]["attempts"][1]["status"] != "succeeded":
            raise SystemExit("bounded_retry_not_recorded")
        if not all((workspace / item["outputs"][0]["relativePath"]).is_file() for item in report["items"]):
            raise SystemExit("missing_hashed_outputs")
        print("loopback_generation=PASS")
        print("dependency_order=PASS")
        print("bounded_retry=PASS")
        print("output_hash_and_dimensions=PASS")

    try:
        order_tasks([{**tasks[0], "dependsOn": ["cycle-b"]}, {**tasks[1], "dependsOn": ["cycle-a"]}])
    except ValueError:
        print("cycle_rejected=PASS")
    print("ASSET_PACK_MCP_WORKER_TEST=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
