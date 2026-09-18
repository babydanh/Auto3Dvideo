#!/usr/bin/env python3
"""Static + loopback fake-MCP regression test for Nano Banana worker."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


PNG_1X1 = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082")


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    worker = root / "scripts" / "nanobanana_mcp_worker.py"
    text = worker.read_text(encoding="utf-8")
    for marker in ["initialize", "tools/list", "tools/call", "FLOW_OUTPUT_DIR", "succeeded_needs_review"]:
        assert marker in text, marker
    with tempfile.TemporaryDirectory(prefix="auto3dvideo-nanobanana-test-") as temp:
        temp_root = Path(temp)
        server = temp_root / "fake_mcp_server.js"
        server.write_text(
            """const readline = require('node:readline');\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082','hex');\nconst rl = readline.createInterface({input: process.stdin});\nrl.on('line', line => { let m; try { m = JSON.parse(line); } catch { return; } if (m.method === 'initialize') return console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-03-26',serverInfo:{name:'fake-nano',version:'1'},capabilities:{}}})); if (m.method === 'tools/list') return console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'generate_image',inputSchema:{type:'object'}}]}})); if (m.method === 'tools/call') { const file = path.join(process.env.FLOW_OUTPUT_DIR, 'fake-output.png'); fs.mkdirSync(process.env.FLOW_OUTPUT_DIR,{recursive:true}); fs.writeFileSync(file,png); return console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:file}]}})); } });\n""",
            encoding="utf-8",
        )
        workspace = temp_root / "workspace"
        workspace.mkdir()
        output_dir = ".auto3dvideo/runs/test/nano"
        spec = temp_root / "job.json"
        spec.write_text(json.dumps({"schemaVersion":"1.0.0","jobType":"image.generate","provider":"nano_banana_mcp","mode":"flow_browser","projectId":"project-test","runId":"run-test","serverEntry":str(server),"flowCdpUrl":"http://127.0.0.1:9222","toolName":"generate_image","outputDirectory":output_dir,"tasks":[{"assetId":"nano-shot-001-reference","shotId":"SHOT-001","title":"Nano test","prompt":"cinematic 3D tiger in a prehistoric valley","width":1024,"height":576,"role":"composition","rightsStatus":"pending"}]}), encoding="utf-8")
        node = os.environ.get("NODE_EXE") or shutil.which("node") or shutil.which("node.exe")
        assert node, "Node.js is required for the fake MCP protocol test"
        result = subprocess.run([sys.executable, str(worker), "--workspace", str(workspace), "--spec", str(spec), "--output-dir", output_dir, "--node", node], capture_output=True, text=True, timeout=30)
        assert result.returncode == 0, result.stderr
        report = json.loads((workspace / output_dir / "nanobanana-image-report.json").read_text(encoding="utf-8"))
        assert report["status"] == "succeeded_needs_review", report
        assert report["outputs"][0]["status"] == "ready", report
        assert (workspace / report["outputs"][0]["relativePath"]).is_file()
    print("NANOBANANA_MCP_WORKER_STATIC_AND_LOOPBACK_TEST_VALID")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
