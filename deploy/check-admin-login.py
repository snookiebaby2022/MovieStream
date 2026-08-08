#!/usr/bin/env python3
from pathlib import Path
import json
import urllib.request
import urllib.error

env = {}
for line in Path("/var/www/moviestream/backend/.env").read_text(encoding="utf-8").splitlines():
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    env[k] = v

for k in ("ADMIN_USER", "ADMIN_PASS", "JWT_SECRET", "SITE_URL"):
    v = env.get(k, "")
    print(f"{k}: present={bool(v)} len={len(v)}")
    if k == "ADMIN_USER":
        print("ADMIN_USER_repr=", repr(v))
    if k == "ADMIN_PASS":
        print("ADMIN_PASS_endswith_bang=", v.endswith("!"))
        print("ADMIN_PASS_has_crlf=", "\r" in v or "\n" in v)

user = env.get("ADMIN_USER", "admin")
pw = env.get("ADMIN_PASS", "")


def try_login(payload):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        "http://127.0.0.1:3001/api/admin/login",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            data = r.read().decode()
            print("OK", payload.keys(), r.status, data[:180])
    except urllib.error.HTTPError as e:
        print("FAIL", list(payload.keys()), e.code, e.read().decode()[:180])
    except Exception as e:
        print("ERR", list(payload.keys()), e)


try_login({"username": user, "password": pw})
try_login({"username": user.strip(), "password": pw.strip()})
try_login({"username": "admin", "password": pw})
