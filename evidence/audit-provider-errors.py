"""Read-only provider audit; persist recognized error codes and metadata only."""
import importlib.util
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True
project = Path(__file__).resolve().parent.parent
helper = project.parents[1] / "归档" / "ssh154hop.py"
spec = importlib.util.spec_from_file_location("assistant_provider_audit_ssh", helper)
hop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hop)
client, bridge = hop.connect()
rows = []
try:
    command = "docker logs --tail 12000 reachai-model 2>&1"
    _, stdout, stderr = client.exec_command(command, timeout=30)
    raw = stdout.read().decode("utf-8", "replace")
    if stdout.channel.recv_exit_status() != 0:
        raise RuntimeError("Read-only provider log query failed")
    for line in raw.splitlines():
        match = re.search(r"^(\S+).*Model instance (5e30cb57-167d-4c2f-b953-6e6b5bd500b1) (stream )?call failed: HTTP (\d{3}) body=(.*)$", line)
        if not match:
            continue
        if not "2026-10-22T21:51:00" <= match[1] <= "2026-10-22T21:55:00":
            continue
        try:
            code = json.loads(match[5]).get("error", {}).get("code")
        except (ValueError, AttributeError):
            code = None
        rows.append({"at": match[1], "instanceId": match[2], "streaming": bool(match[3]), "status": int(match[4]),
                     "code": code if code in {"upstream_web_verification"} else "unclassified"})
finally:
    client.close()
    if bridge:
        bridge.close()

diagnostics = [json.loads(line) for line in (project / "runtime/logs/model-requests.jsonl").read_text(encoding="utf-8").splitlines()]
diagnostics = [row for row in diagnostics if "2026-10-22T13:53:38Z" < row["at"] < "2026-10-22T13:54:06Z"]
report = {"at": datetime.now(timezone.utc).isoformat(), "scope": "read-only ReachAI provider logs and local model metadata; no raw bodies, conversations, audio, keys or provider URLs saved",
          "selectedInstance": "5e30cb57-167d-4c2f-b953-6e6b5bd500b1", "providerErrors": rows,
          "localRequests": diagnostics, "finding": "upstream_web_verification" if any(row["code"] == "upstream_web_verification" for row in rows) else "unresolved"}
output = project / ("evidence/microphone-20261022/provider-error-audit-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + ".json")
if output.exists():
    raise RuntimeError("Evidence already exists; preserve it rather than overwriting")
output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"output": str(output), "providerErrors": len(rows), "verificationFailures": sum(row["code"] == "upstream_web_verification" for row in rows), "localAttempts": len(diagnostics)}, ensure_ascii=False))
