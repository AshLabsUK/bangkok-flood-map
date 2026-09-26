"""
Precompute road-hugging line segments for every BMA flood sensor.

For each sensor point (lat, lng), finds the nearest OpenStreetMap road (via the
Overpass API) and extracts ~180m of that road's actual geometry centered on the
sensor, so the map can draw a real road segment instead of just a dot -- without
making every visitor's browser hammer the public Overpass server at page load.

Output: bma-geometry.json, keyed by sensor code -> [[lat,lon], ...]
"""
import json
import math
import time
import urllib.request
import urllib.parse
import sys

SENSOR_API = "https://floodbangkok.bangkok.go.th/bkk/dds/services/api/floods/v1/items/sensor_profile?limit=-1"
OVERPASS = "https://overpass-api.de/api/interpreter"
CHUNK_SIZE = 8
SEG_HALF_LEN_M = 90
OUT_PATH = "bma-geometry.json"


def fetch_json(url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))


def haversine(lat1, lon1, lat2, lon2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def closest_on_segment(p, a, b):
    ax, ay, bx, by, px, py = a["lon"], a["lat"], b["lon"], b["lat"], p[1], p[0]
    dx, dy = bx - ax, by - ay
    len2 = dx * dx + dy * dy
    t = 0.0 if len2 == 0 else ((px - ax) * dx + (py - ay) * dy) / len2
    t = max(0.0, min(1.0, t))
    return {"lat": ay + t * dy, "lon": ax + t * dx}


def nearest_way_and_segment(ways, lat, lon):
    best = None
    for way in ways:
        g = way.get("geometry")
        if not g or len(g) < 2:
            continue
        for i in range(len(g) - 1):
            c = closest_on_segment((lat, lon), g[i], g[i + 1])
            d = haversine(lat, lon, c["lat"], c["lon"])
            if best is None or d < best["dist"]:
                best = {"dist": d, "way": way, "seg_index": i, "point": c}
    return best


def extract_subpolyline(way, seg_index, proj):
    g = way["geometry"]
    coords = [[proj["lat"], proj["lon"]]]

    acc = 0.0
    i = seg_index
    frm = proj
    while i >= 0 and acc < SEG_HALF_LEN_M:
        to = g[i]
        d = haversine(frm["lat"], frm["lon"], to["lat"], to["lon"])
        acc += d
        coords.insert(0, [to["lat"], to["lon"]])
        frm = to
        i -= 1

    acc = 0.0
    i = seg_index + 1
    frm = proj
    while i < len(g) and acc < SEG_HALF_LEN_M:
        to = g[i]
        d = haversine(frm["lat"], frm["lon"], to["lat"], to["lon"])
        acc += d
        coords.append([to["lat"], to["lon"]])
        frm = to
        i += 1

    return coords


def overpass_chunk(points, attempt=0):
    clauses = "".join(f"way(around:55,{p['lat']},{p['long']})[highway];" for p in points)
    q = f"[out:json][timeout:25];({clauses});out geom;"
    body = ("data=" + urllib.parse.quote(q)).encode("utf-8")
    try:
        req = urllib.request.Request(
            OVERPASS, data=body, headers={"User-Agent": "bangkok-flood-map-geometry-builder/1.0"}
        )
        with urllib.request.urlopen(req, timeout=40) as r:
            raw = r.read().decode("utf-8")
        j = json.loads(raw)
    except urllib.error.HTTPError as e:
        if e.code in (429, 504) and attempt < 4:
            wait = 5 * (attempt + 1)
            print(f"    HTTP {e.code}, retrying in {wait}s...", file=sys.stderr)
            time.sleep(wait)
            return overpass_chunk(points, attempt + 1)
        raise

    ways = [el for el in j.get("elements", []) if el.get("type") == "way"]
    result = {}
    for p in points:
        best = nearest_way_and_segment(ways, p["lat"], p["long"])
        if best and best["dist"] < 55:
            result[p["code"]] = extract_subpolyline(best["way"], best["seg_index"], best["point"])
    return result


def main():
    print("Fetching sensor list...", file=sys.stderr)
    sensors = fetch_json(SENSOR_API)["data"]
    points = [s for s in sensors if (s.get("code") or "").startswith("FL.") and s.get("lat") and s.get("long")]
    print(f"{len(points)} sensor points", file=sys.stderr)

    try:
        with open(OUT_PATH, "r", encoding="utf-8") as f:
            geometry = json.load(f)
    except FileNotFoundError:
        geometry = {}

    missing = [p for p in points if p["code"] not in geometry]
    print(f"{len(missing)} missing from cache", file=sys.stderr)

    chunks = [missing[i : i + CHUNK_SIZE] for i in range(0, len(missing), CHUNK_SIZE)]
    for idx, chunk in enumerate(chunks):
        print(f"  chunk {idx + 1}/{len(chunks)} ({len(chunk)} points)...", file=sys.stderr)
        try:
            res = overpass_chunk(chunk)
            geometry.update(res)
            print(f"    -> {len(res)}/{len(chunk)} matched", file=sys.stderr)
        except Exception as e:
            print(f"    chunk failed: {e}", file=sys.stderr)
        with open(OUT_PATH, "w", encoding="utf-8") as f:
            json.dump(geometry, f, ensure_ascii=False, separators=(",", ":"))
        time.sleep(1.5)

    print(f"Done. {len(geometry)}/{len(points)} sensors have road geometry -> {OUT_PATH}", file=sys.stderr)


if __name__ == "__main__":
    main()
