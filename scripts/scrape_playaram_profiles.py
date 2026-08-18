#!/usr/bin/env python3
"""Save PlayARAM match summaries and Overview details for manifest profiles.

This talks only to playaram.gg's public profile/action URLs. It never connects to
the League client, LCU, Riot game process, or local game ports.
"""

from __future__ import annotations

import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".vendor"))
from bs4 import BeautifulSoup  # noqa: E402

BASE = "https://playaram.gg"
PROFILE_DIR = ROOT / "data" / "playaram-profiles"
MANIFEST_PATH = PROFILE_DIR / "index.json"
PRIMARY_PATH = PROFILE_DIR / "playaram-local.json"
MAX_MATCHES = 2000
WORKERS = 10
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
}


def number(value: str | None) -> int:
    cleaned = re.sub(r"[^0-9.-]", "", value or "")
    try:
        return int(float(cleaned))
    except ValueError:
        return 0


def text(node) -> str:
    return node.get_text(" ", strip=True) if node else ""


def alts(node, selector: str) -> list[str]:
    return [img.get("alt", "") for img in node.select(selector) if img.get("alt")]


def normalize_relative_time(value: str) -> str:
    value = value.strip()
    if re.search(r"\d+\s*(?:mo|w|d|h|m)\s+ago", value, re.I):
        return value
    match = re.search(r"(\d+)\s*(tháng|tuần|ngày|giờ|phút)\s*trước", value, re.I)
    if match:
        unit = {"tháng": "mo", "tuần": "w", "ngày": "d", "giờ": "h", "phút": "m"}[match.group(2).lower()]
        return f"{match.group(1)}{unit} ago"
    return value


def normalize_duration(value: str) -> str:
    return re.sub(r"^(\d+)p\s*(\d+)s$", r"\1m \2s", value.strip(), flags=re.I)


def get_html(url: str, retries: int = 4) -> str:
    last_error = None
    for attempt in range(retries):
        try:
            req = Request(url, headers=HEADERS)
            with urlopen(req, timeout=35) as response:
                return response.read().decode("utf-8", errors="replace")
        except (HTTPError, URLError, TimeoutError) as exc:
            last_error = exc
            time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"request failed: {url}: {last_error}")


def parse_summary(item) -> dict:
    kda = [number(x.get_text()) for x in item.select(".mr-kda strong")]
    teams = []
    team_profiles = []
    for team in item.select(".mr-team"):
        profiles = [
            {"name": text(a), "href": a.get("href", "")}
            for a in team.select(".mr-mate__name")
        ]
        team_profiles.append(profiles)
        teams.append([p["name"] for p in profiles])
    result_node = item.select_one(".mr-meta__result")
    row = item.select_one(".match-row")
    result_code = "win" if row and "is-win" in (row.get("class") or []) else "loss"
    raw_map = text(item.select_one(".mr-meta__map"))
    return {
        "gameId": number(item.get("data-game-id")),
        "map": "ARAM" if raw_map.strip().upper() == "ARAM" else "ARAM: Mayhem",
        "result": "Victory" if result_code == "win" else "Defeat",
        "resultCode": result_code,
        "relativeTime": normalize_relative_time(text(item.select_one(".mr-meta__ago"))),
        "durationText": normalize_duration(text(item.select_one(".mr-meta__dur"))),
        "champion": (item.select_one(".mr-champ .champion-icon") or {}).get("alt", ""),
        "level": number(text(item.select_one(".mr-champ__lvl"))),
        "spells": alts(item, ".mr-body .spell-icon"),
        "augments": alts(item, ".mr-body .core-icon[alt]"),
        "items": alts(item, ".mr-items .item-icon"),
        "kills": kda[0] if len(kda) > 0 else 0,
        "deaths": kda[1] if len(kda) > 1 else 0,
        "assists": kda[2] if len(kda) > 2 else 0,
        "cs": number(text(item.select_one(".mr-cs"))),
        "badges": [text(x) for x in item.select(".mr-badge")],
        "teams": teams,
        "teamProfiles": team_profiles,
    }


def parse_overview(game_id: int, html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    overview = soup.select_one(".mdp-overview")
    if not overview:
        raise ValueError(f"Overview missing for {game_id}")
    teams = []
    for team in overview.select(".mdp-team"):
        players = []
        for row in team.select("tbody tr"):
            cells = row.select("td")
            kda_text = text(row.select_one(".mdp-kda"))
            kda_parts = [number(x) for x in kda_text.split("/")]
            damage = [number(text(x)) for x in row.select(".mdp-dmg b")]
            try:
                kda_ratio = float(text(row.select_one(".mdp-num em, .mdp-kda em")) or 0)
            except ValueError:
                kda_ratio = 0.0
            players.append({
                "name": text(row.select_one(".mdp-player__name")),
                "champion": (row.select_one(".champion-icon") or {}).get("alt", ""),
                "level": number(text(row.select_one(".mdp-player__lvl"))),
                "spells": alts(row, ".spell-icon"),
                "augments": alts(row, ".core-icon[alt]"),
                "kills": kda_parts[0] if len(kda_parts) > 0 else 0,
                "deaths": kda_parts[1] if len(kda_parts) > 1 else 0,
                "assists": kda_parts[2] if len(kda_parts) > 2 else 0,
                "kda": kda_ratio,
                "damageDealt": damage[0] if len(damage) > 0 else 0,
                "damageTaken": damage[1] if len(damage) > 1 else 0,
                "gold": number(text(cells[4])) if len(cells) > 4 else 0,
                "cs": number(text(cells[5])) if len(cells) > 5 else 0,
                "items": alts(row, ".item-icon"),
                "rawCells": [text(x) for x in cells[2:6]],
            })
        teams.append({
            "side": text(team.select_one(".mdp-team__side")),
            "result": text(team.select_one(".mdp-team__result")),
            "kills": number(text(team.select_one(".mdp-team__kills"))),
            "players": players,
        })
    overview_text = overview.get_text("\n", strip=True)
    return {"gameId": game_id, "overview": {"teams": teams, "text": overview_text}}


def load_profile_matches(target: dict) -> tuple[dict, list[dict], bool]:
    profile_html = get_html(target["source"])
    soup = BeautifulSoup(profile_html, "html.parser")
    profile = soup.select_one(".profile")
    if not profile:
        raise RuntimeError(f"profile element missing: {target['riotId']}")
    meta = {
        "server": profile.get("data-server", target.get("region", "jp")),
        "name": profile.get("data-name", target["riotId"]),
        "selfPuuid": profile.get("data-self-puuid", ""),
    }
    summaries = [parse_summary(x) for x in soup.select(".match-item")]
    seen = {x["gameId"] for x in summaries}
    skip = 20
    has_more = True
    with ThreadPoolExecutor(max_workers=WORKERS) as list_pool:
        while has_more and len(summaries) < MAX_MATCHES:
            skips = list(range(skip, min(MAX_MATCHES, skip + 20 * WORKERS), 20))
            urls = {
                current_skip: BASE + "/_l5e/action/loadMoreMatches_bc6c?" + urlencode({
                    "puuid": meta["selfPuuid"], "skip": str(current_skip), "server": meta["server"]
                }) for current_skip in skips
            }
            futures = {list_pool.submit(get_html, url): current_skip for current_skip, url in urls.items()}
            pages = {futures[future]: future.result() for future in as_completed(futures)}
            for current_skip in sorted(pages):
                more = BeautifulSoup(pages[current_skip], "html.parser")
                items = more.select(".match-item")
                if not items:
                    has_more = False
                    break
                added = 0
                for item in items:
                    parsed = parse_summary(item)
                    if parsed["gameId"] not in seen:
                        summaries.append(parsed)
                        seen.add(parsed["gameId"])
                        added += 1
                        if len(summaries) >= MAX_MATCHES:
                            break
                root = more.select_one("[data-has-more]")
                if not added or (root and root.get("data-has-more") != "true"):
                    has_more = False
                    break
                if len(summaries) >= MAX_MATCHES:
                    break
            skip += 20 * WORKERS
            print(f"  list {target['riotId']}: {len(summaries)} matches", flush=True)
    return meta, summaries[:MAX_MATCHES], has_more and len(summaries) >= MAX_MATCHES


def detail_url(meta: dict, game_id: int) -> str:
    return BASE + "/_l5e/action/loadMatchDetail_bc6c?" + urlencode({
        "gameId": str(game_id), "self": meta["selfPuuid"],
        "server": meta["server"], "name": meta["name"],
    })


def save_profile(target: dict, summaries: list[dict], details: list[dict], pending: list[int], capped: bool):
    payload = {
        "source": target["source"],
        "profile": {
            "riotId": target["riotId"], "region": target.get("region", "jp"),
            "name": target["name"], "partyCountWithPrimary": target.get("partyCountWithPrimary", target.get("partyCountWithAkita0")),
            "partyCountWithDoss": target.get("partyCount"),
        },
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "summaryCount": len(summaries), "detailCount": len(details),
        "completed": not pending, "capped": capped,
        "summaries": summaries, "details": details, "pendingGameIds": pending,
    }
    out = PROFILE_DIR / target["file"]
    temp = out.with_suffix(".json.tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(out)


def main():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    cache: dict[int, dict] = {}
    for path in [PRIMARY_PATH, *PROFILE_DIR.glob("playaram-*.json")]:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            for detail in data.get("details", []):
                cache[number(str(detail.get("gameId")))] = detail
        except (OSError, json.JSONDecodeError):
            pass
    print(f"Overview cache: {len(cache)}", flush=True)

    for target in manifest["profiles"]:
        existing_path = PROFILE_DIR / target["file"]
        if target.get("status") in {"complete", "unavailable"} and existing_path.exists():
            print(f"[skip] {target['riotId']} ({target.get('status')})", flush=True)
            continue
        print(f"[{target['index']}/{len(manifest['profiles'])}] {target['riotId']}", flush=True)
        meta, summaries, capped = load_profile_matches(target)
        details = [cache[s["gameId"]] for s in summaries if s["gameId"] in cache]
        have = {d["gameId"] for d in details}
        pending = [s["gameId"] for s in summaries if s["gameId"] not in have]
        save_profile(target, summaries, details, pending, capped)
        print(f"  details cached={len(details)} pending={len(pending)}", flush=True)

        completed_since_save = 0
        failures: list[int] = []
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(get_html, detail_url(meta, game_id)): game_id for game_id in pending}
            for future in as_completed(futures):
                game_id = futures[future]
                try:
                    detail = parse_overview(game_id, future.result())
                    details.append(detail)
                    cache[game_id] = detail
                    have.add(game_id)
                    completed_since_save += 1
                except Exception as exc:
                    failures.append(game_id)
                    print(f"  detail failed {game_id}: {exc}", flush=True)
                if completed_since_save >= 50:
                    remaining = [s["gameId"] for s in summaries if s["gameId"] not in have]
                    save_profile(target, summaries, details, remaining, capped)
                    completed_since_save = 0
                    print(f"  details {len(details)}/{len(summaries)}", flush=True)

        remaining = [s["gameId"] for s in summaries if s["gameId"] not in have]
        save_profile(target, summaries, details, remaining, capped)
        target.update({
            "status": "complete" if not remaining else "partial",
            "summaryCount": len(summaries), "detailCount": len(details),
            "completed": not remaining, "capped": capped,
        })
        manifest["generatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  saved details={len(details)} remaining={len(remaining)} capped={capped}", flush=True)


if __name__ == "__main__":
    main()
