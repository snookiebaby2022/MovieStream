#!/usr/bin/env python3
"""See whether RD/AD will accept adult magnets (no secrets printed)."""
import json
import urllib.parse
import urllib.request
from pathlib import Path

env = {}
for line in Path("/var/www/moviestream/backend/.env").read_text().splitlines():
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    env[k] = v.strip()

rd = env.get("REALDEBRID_API_TOKEN", "")
ad = env.get("ALLDEBRID_API_TOKEN", "")


def get_json(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "FlixNovaAdultProbe/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


rows = get_json("https://apibay.org/q.php?q=adult&cat=500")
if isinstance(rows, dict):
    rows = [rows]
ok = [r for r in rows if r.get("id") and r.get("id") != "0" and r.get("info_hash")]
ok = sorted(ok, key=lambda r: int(r.get("seeders") or 0), reverse=True)[:8]
print(f"candidates={len(ok)}")

rd_ok = rd_fail = 0
ad_ok = ad_fail = 0

for i, top in enumerate(ok[:5]):
    info_hash = (top.get("info_hash") or "").lower()
    name = (top.get("name") or "")[:50]
    magnet = f"magnet:?xt=urn:btih:{info_hash}&dn={urllib.parse.quote(top.get('name') or 'x')}"
    print(f"\n#{i+1} seeders={top.get('seeders')} cat={top.get('category')} name={name!r}")

    if rd:
        data = urllib.parse.urlencode({"magnet": magnet}).encode()
        req = urllib.request.Request(
            "https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
            data=data,
            headers={"Authorization": f"Bearer {rd}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                add = json.loads(r.read().decode())
            tid = add.get("id")
            print("  RD: accepted id=", bool(tid))
            rd_ok += 1
            if tid:
                del_req = urllib.request.Request(
                    f"https://api.real-debrid.com/rest/1.0/torrents/delete/{tid}",
                    method="DELETE",
                    headers={"Authorization": f"Bearer {rd}"},
                )
                try:
                    urllib.request.urlopen(del_req, timeout=15).read()
                except Exception:
                    pass
        except Exception as e:
            body = ""
            code = getattr(e, "code", "?")
            if hasattr(e, "read"):
                try:
                    body = e.read().decode()[:160]
                except Exception:
                    pass
            print(f"  RD: FAIL {code} {body}")
            rd_fail += 1

    if ad:
        # AllDebrid magnet upload
        q = urllib.parse.urlencode({"agent": "FlixNova", "apikey": ad, "magnets[]": magnet})
        req = urllib.request.Request(
            f"https://api.alldebrid.com/v4/magnet/upload?{q}",
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                add = json.loads(r.read().decode())
            status = add.get("status")
            magnets = ((add.get("data") or {}).get("magnets") or [])
            mid = magnets[0].get("id") if magnets else None
            err = magnets[0].get("error") if magnets else add.get("error")
            print(f"  AD: status={status} id={bool(mid)} err={err}")
            if mid:
                ad_ok += 1
                # delete
                dq = urllib.parse.urlencode({"agent": "FlixNova", "apikey": ad, "id": mid})
                try:
                    urllib.request.urlopen(
                        urllib.request.Request(f"https://api.alldebrid.com/v4/magnet/delete?{dq}"),
                        timeout=15,
                    ).read()
                except Exception:
                    pass
            else:
                ad_fail += 1
        except Exception as e:
            print("  AD: FAIL", e)
            ad_fail += 1

print("\n=== SUMMARY ===")
print(f"RD accepted={rd_ok} failed={rd_fail}")
print(f"AD accepted={ad_ok} failed={ad_fail}")
if rd_fail and not rd_ok and ad_fail and not ad_ok:
    print("VERDICT=REMOVE — debrid providers block adult magnets")
elif rd_ok or ad_ok:
    print("VERDICT=KEEP_IF_PROVIDER_WORKS — some adult magnets accepted")
else:
    print("VERDICT=UNCLEAR")
