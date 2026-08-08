#!/usr/bin/env python3
"""Probe adult catalog + ApiBay + RD resolve path (no secrets printed)."""
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

env = {}
for line in Path("/var/www/moviestream/backend/.env").read_text().splitlines():
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    env[k] = v.strip()

tmdb = env.get("TMDB_API_KEY", "")
rd = env.get("REALDEBRID_API_TOKEN", "")
ad = env.get("ALLDEBRID_API_TOKEN", "")


def get_json(url, headers=None, timeout=20):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "FlixNovaAdultProbe/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


print("=== TMDB adult search ===")
adult_items = []
if tmdb:
    q = urllib.parse.urlencode({"api_key": tmdb, "query": "xxx", "include_adult": "true", "page": "1"})
    try:
        d = get_json(f"https://api.themoviedb.org/3/search/movie?{q}")
        results = d.get("results") or []
        adult_flagged = [x for x in results if x.get("adult")]
        print(f"search_xxx total={len(results)} adult_flagged={len(adult_flagged)}")
        q2 = urllib.parse.urlencode(
            {"api_key": tmdb, "include_adult": "true", "sort_by": "popularity.desc", "page": "1"}
        )
        d2 = get_json(f"https://api.themoviedb.org/3/discover/movie?{q2}")
        results2 = d2.get("results") or []
        adult2 = [x for x in results2 if x.get("adult")]
        print(f"discover include_adult total={len(results2)} adult_flagged={len(adult2)}")
        adult_items = adult_flagged or adult2
        if adult_items:
            sample = adult_items[0]
            print(
                "sample:",
                sample.get("id"),
                repr((sample.get("title") or "")[:50]),
                "adult=",
                sample.get("adult"),
            )
        else:
            print("TMDB_ADULT_EMPTY — account may have adult content disabled in TMDB settings")
    except Exception as e:
        print("TMDB_ERR", e)
else:
    print("NO_TMDB")

print("=== ApiBay cat 500 (adult) ===")
try:
    rows = get_json("https://apibay.org/q.php?q=xxx&cat=500")
    if isinstance(rows, dict):
        rows = [rows]
    ok = [r for r in rows if r.get("id") and r.get("id") != "0"]
    print(f"apibay_rows={len(ok)}")
    if ok:
        top = sorted(ok, key=lambda r: int(r.get("seeders") or 0), reverse=True)[0]
        print(
            "top:",
            "seeders=",
            top.get("seeders"),
            "cat=",
            top.get("category"),
            "name=",
            repr((top.get("name") or "")[:60]),
        )
except Exception as e:
    print("APIBAY_ERR", e)
    ok = []

print("=== RD magnet resolve sample ===")
if rd and ok:
    top = sorted(ok, key=lambda r: int(r.get("seeders") or 0), reverse=True)[0]
    info_hash = (top.get("info_hash") or "").lower()
    magnet = f"magnet:?xt=urn:btih:{info_hash}&dn={urllib.parse.quote(top.get('name') or 'x')}"
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
        print("rd_addMagnet", "id=", bool(tid))
        if tid:
            # cleanup — don't leave junk torrents
            del_req = urllib.request.Request(
                f"https://api.real-debrid.com/rest/1.0/torrents/delete/{tid}",
                method="DELETE",
                headers={"Authorization": f"Bearer {rd}"},
            )
            try:
                urllib.request.urlopen(del_req, timeout=15).read()
                print("rd_cleanup=ok")
            except Exception as e:
                print("rd_cleanup_err", e)
    except Exception as e:
        body = ""
        if hasattr(e, "read"):
            try:
                body = e.read().decode()[:200]
            except Exception:
                pass
        print("RD_ERR", getattr(e, "code", ""), body or e)
else:
    print("skip_rd", "rd_set=", bool(rd), "apibay=", bool(ok))

print("=== local /api/discover/adult with forged premium? ===")
# Can't forge JWT easily; hit internal logic via TMDB conclusion only
print("providers:", "RD" if rd else "-", "AD" if ad else "-")
print("VERDICT_HINT:", end=" ")
if not adult_items and not ok:
    print("REMOVE_OR_FIX — neither TMDB adult catalog nor ApiBay returned usable adult results")
elif not adult_items and ok:
    print("PARTIAL — ApiBay/RD path can work, but TMDB XXX catalog is empty (disable or fix TMDB adult)")
elif adult_items and not ok:
    print("PARTIAL — catalog works, torrent/RD adult path broken")
else:
    print("KEEP — catalog + ApiBay look alive; playback still needs entitled premium user test in UI")
