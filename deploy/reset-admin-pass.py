#!/usr/bin/env python3
"""Reset ADMIN_PASS in backend/.env and verify /api/admin/login."""
from pathlib import Path
import json
import secrets
import string
import urllib.request
import urllib.error

env_path = Path("/var/www/moviestream/backend/.env")
alphabet = string.ascii_letters + string.digits
new_pass = "Fn!" + "".join(secrets.choice(alphabet) for _ in range(12))

lines = env_path.read_text(encoding="utf-8").splitlines()
out = []
seen_user = seen_pass = False
for line in lines:
    if line.startswith("ADMIN_USER="):
        out.append("ADMIN_USER=admin")
        seen_user = True
    elif line.startswith("ADMIN_PASS="):
        out.append(f"ADMIN_PASS={new_pass}")
        seen_pass = True
    else:
        out.append(line)
if not seen_user:
    out.append("ADMIN_USER=admin")
if not seen_pass:
    out.append(f"ADMIN_PASS={new_pass}")
env_path.write_text("\n".join(out) + "\n", encoding="utf-8")

# Login handler reloads dotenv on each request, so no pm2 restart required —
# but restart anyway so other code paths see it.
import subprocess
subprocess.run(["pm2", "restart", "moviestream", "--update-env"], check=False)

import time
time.sleep(2)

body = json.dumps({"username": "admin", "password": new_pass}).encode()
req = urllib.request.Request(
    "http://127.0.0.1:3001/api/admin/login",
    data=body,
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read().decode())
        ok = bool(data.get("success"))
except Exception as e:
    ok = False
    data = str(e)

print("RESET_OK" if ok else "RESET_FAIL")
print("USERNAME=admin")
print(f"PASSWORD={new_pass}")
print("VERIFY=", data if isinstance(data, str) else data.get("success"))
