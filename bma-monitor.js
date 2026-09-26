(function () {
  "use strict";

  const API = "https://floodbangkok.bangkok.go.th/bkk/dds/services/api/floods/v1/items/";
  const OVERPASS = "https://overpass-api.de/api/interpreter";
  const REFRESH_MS = 3 * 60 * 1000;
  const GEOM_CACHE_KEY = "bma-monitor-geom-v1";
  const CHUNK_SIZE = 18;
  const CHUNK_CONCURRENCY = 1;
  const SEG_HALF_LEN_M = 90; // draw ~180m of road centered on each sensor

  // ---------- translation helpers ----------

  function translateDistrict(th) {
    return DISTRICT_EN[th] || th;
  }

  function translateRoad(th) {
    if (!th) return "Unnamed road";
    const t = th.trim();
    if (ROAD_EN[t]) return ROAD_EN[t];
    const m = t.match(/^(.*?)(\s*\d[\d/]*)$/);
    if (m && ROAD_EN[m[1].trim()]) return ROAD_EN[m[1].trim()] + " " + m[2].trim();
    return t;
  }

  function roadCore(th) {
    return (th || "").replace(/^(ถนน|ถ\.|ซอย|ซ\.)\s*/, "").trim();
  }

  function translateLocation(name, roadTh) {
    if (!name) return "";
    let s = name;
    const core = roadCore(roadTh);
    if (core) {
      s = s.replace(new RegExp("^(ถนน|ถ\\.|ซอย|ซ\\.)?\\s*" + core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "").trim();
    }
    for (const [th, en] of PHRASE_EN) {
      s = s.split(th).join(" " + en + " ");
    }
    return s.replace(/\s+/g, " ").replace(/^[\s:,-]+/, "").trim();
  }

  // ---------- severity ----------

  function severityOf(cm) {
    if (cm === null || cm === undefined || isNaN(cm)) return "normal";
    if (cm >= 15) return "severe";
    if (cm >= 10) return "flood";
    if (cm >= 5) return "slight";
    return "normal";
  }
  const SEV_LABEL = { severe: "Severe", flood: "Flooded", slight: "Slight", normal: "Clear" };
  const SEV_COLOR = { severe: "#e0536a", flood: "#f0784f", slight: "#f0b93b", normal: "#34d399" };
  const SEV_WEIGHT = { severe: 8, flood: 6, slight: 5, normal: 3 };
  const SEV_RANK = { severe: 3, flood: 2, slight: 1, normal: 0 };
  const SOURCE_LABEL = { bma: "BMA sensor", itic: "Agency / iTIC report", traffy: "Citizen report (Traffy, unverified)" };

  // ---------- BMA data fetch ----------

  async function fetchJSON(url, timeoutMs) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs || 20000);
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" }, signal: ctl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (e) {
      throw new Error(e.name === "AbortError" ? "timed out" : e.message || "network error");
    } finally {
      clearTimeout(t);
    }
  }

  async function loadSensorData() {
    try {
      const [sensorsRes, notifRes] = await Promise.all([
        fetchJSON(API + "sensor_profile?limit=-1"),
        fetchJSON(
          API +
            "flood_notification?limit=1500&page=0&sort=-date_created&fields=sensor_profile,value,heighest_value,date_created"
        ),
      ]);
      const sensors = sensorsRes.data || [];
      const notifs = notifRes.data || [];

      const latestBySensor = new Map();
      for (const n of notifs) {
        if (!latestBySensor.has(n.sensor_profile)) latestBySensor.set(n.sensor_profile, n);
      }

      let latestTs = null;
      const points = sensors
        .filter((s) => (s.code || "").startsWith("FL.") && s.lat && s.long)
        .map((s) => {
          const latest = latestBySensor.get(s.id);
          const cm = latest ? parseFloat(latest.value) : 0;
          if (latest && latest.date_created) {
            if (!latestTs || latest.date_created > latestTs) latestTs = latest.date_created;
          }
          return {
            id: s.id,
            code: s.code,
            roadTh: s.road,
            road: translateRoad(s.road),
            districtTh: s.district,
            district: translateDistrict(s.district),
            location: translateLocation(s.name, s.road),
            lat: s.lat,
            lng: s.long,
            cm: isNaN(cm) ? 0 : cm,
            sev: severityOf(isNaN(cm) ? 0 : cm),
            source: "bma",
          };
        });

      return { points, latestTs, ok: true };
    } catch (err) {
      console.warn("BMA sensor feed unavailable", err);
      return { points: [], latestTs: null, ok: false, error: err };
    }
  }

  // ---------- fallback sources: agency/iTIC flood reports + Traffy Fondue citizen reports ----------
  // Same public feeds this repo's original map (longdo-live-map.html / app.js) uses. Kept live here
  // too so the page still shows *something* when BMA's own sensor API is down (as it often is during
  // an active flood event, when it's under the most load).

  const FALLBACK_URLS = {
    events: "https://event.longdo.com/feed/json",
    traffy: "https://publicapi.traffy.in.th/share/teamchadchart/search?limit=500",
  };
  const BKK_AREA_BOX = { s: 13.45, n: 14.15, w: 100.25, e: 100.95 };
  const inBkkArea = (la, lo) => la >= BKK_AREA_BOX.s && la <= BKK_AREA_BOX.n && lo >= BKK_AREA_BOX.w && lo <= BKK_AREA_BOX.e;
  const SEV_FROM_LEVEL = { red: "severe", yellow: "flood", green: "normal" };

  function classifyReportText(text) {
    const t = String(text || "");
    const out = { level: "yellow", cm: null, reason: "Flooding reported; depth not stated" };
    let maxcm = null;
    const re = /(\d{1,3})(?:\s*[-–~ถึง]+\s*(\d{1,3}))?\s*(?:ซ\.?\s?ม\.?|ซม|เซน(?:ติเมตร)?|cm)/gi;
    let m;
    while ((m = re.exec(t))) {
      const v = Math.max(+m[1], m[2] ? +m[2] : 0);
      if (v > 0 && v < 300) maxcm = Math.max(maxcm || 0, v);
    }
    if (/ผ่านไม่ได้|ไม่สามารถผ่าน|ไม่สามารถสัญจร|สัญจรไม่ได้|ผ่านไม่สะดวก|ปิดการจราจร|ปิดถนน|impassable|not passable/i.test(t))
      return Object.assign(out, { level: "red", cm: maxcm, reason: "Reported not passable" + (maxcm ? ` (~${maxcm} cm)` : "") });
    if (/น้ำลด(ลง)?แล้ว|ระบายแล้ว|ระบายเสร็จ|แห้งแล้ว|กลับสู่ภาวะปกติ|ผ่านได้ตามปกติ|receded/i.test(t))
      return Object.assign(out, { level: "green", reason: "Source reports water receded / normal" });
    if (maxcm != null)
      return Object.assign(out, maxcm > 20 ? { level: "red", cm: maxcm, reason: `Depth ~${maxcm} cm (over 20 cm)` } : { level: "yellow", cm: maxcm, reason: `Depth ~${maxcm} cm` });
    if (/เข่า|เอว|หน้าอก|หน้าแข้ง|หน้าขา|ต้นขา|ถึงก้น|knee|waist|thigh/i.test(t))
      return Object.assign(out, { level: "red", reason: "Described as shin/knee-deep or more" });
    if (/ข้อเท้า|ตาตุ่ม|ankle/i.test(t)) return Object.assign(out, { level: "yellow", reason: "Described as ankle-deep" });
    return out;
  }

  async function loadEvents() {
    try {
      const d = await fetchJSON(FALLBACK_URLS.events);
      if (!Array.isArray(d)) throw new Error("unexpected iTIC response");
      const now = Date.now();
      const points = d
        .filter((e) => e.type === "6" || e.icon === "flood")
        .map((e, i) => {
          const la = parseFloat(e.latitude), lo = parseFloat(e.longitude);
          const start = bkkDate(e.start), stop = bkkDate(e.stop);
          const c = classifyReportText([e.title, e.description].join(" "));
          return { e, i, la, lo, start, stop, c };
        })
        .filter((x) => x.la && x.lo && inBkkArea(x.la, x.lo) && (!x.stop || x.stop.getTime() >= now) && (!x.start || x.start.getTime() <= now + 36e5) && x.c.level !== "green")
        .map((x) => ({
          code: "ITIC-" + (x.e.id || x.i),
          road: x.e.title.replace(/^น้ำท่วม\s*/, ""),
          district: "",
          location: (x.e.description || "").slice(0, 200) + " — " + x.c.reason,
          lat: x.la,
          lng: x.lo,
          cm: x.c.cm,
          sev: SEV_FROM_LEVEL[x.c.level] || "flood",
          source: "itic",
        }));
      return { points, ok: true };
    } catch (err) {
      console.warn("iTIC/Longdo road-report feed unavailable", err);
      return { points: [], ok: false, error: err };
    }
  }

  async function loadTraffy() {
    try {
      const d = await fetchJSON(FALLBACK_URLS.traffy);
      if (!d || !Array.isArray(d.results)) throw new Error("unexpected Traffy response");
      const cutoff = Date.now() - 3 * 3600 * 1000;
      const floodRe = /ท่วม|น้ำขัง|นำ้ท่วม|น้ำรอระบาย|รอการระบาย|flood/i;
      const points = d.results
        .map((r) => {
          const t = r.timestamp ? new Date(String(r.timestamp).replace(" ", "T").replace(/(\.\d{3})\d*/, "$1").replace(/\+00$/, "Z")) : null;
          const lo = r.coords ? parseFloat(r.coords[0]) : null;
          const la = r.coords ? parseFloat(r.coords[1]) : null;
          return { r, t, la, lo };
        })
        .filter((x) => x.la && x.lo && x.t && !isNaN(x.t) && x.t.getTime() >= cutoff && inBkkArea(x.la, x.lo) && floodRe.test(x.r.description || "") && x.r.state !== "เสร็จสิ้น")
        .map((x) => ({ ...x, c: classifyReportText(x.r.description) }))
        .filter((x) => x.c.level !== "green")
        .map((x) => ({
          code: "TRAFFY-" + x.r.ticket_id,
          road: (x.r.address || x.r.description || "").slice(0, 80),
          district: "",
          location: (x.r.description || "").slice(0, 200) + " — " + x.c.reason + " (unverified citizen report)",
          lat: x.la,
          lng: x.lo,
          cm: x.c.cm,
          sev: SEV_FROM_LEVEL[x.c.level] || "flood",
          source: "traffy",
        }));
      return { points, ok: true };
    } catch (err) {
      console.warn("Traffy Fondue feed unavailable", err);
      return { points: [], ok: false, error: err };
    }
  }

  function groupByRoad(points) {
    const byRoad = new Map();
    for (const p of points) {
      const key = p.road + "|" + p.district;
      if (!byRoad.has(key)) byRoad.set(key, { road: p.road, district: p.district, points: [], sources: new Set() });
      const g = byRoad.get(key);
      g.points.push(p);
      g.sources.add(p.source);
    }
    const roads = [...byRoad.values()].map((r) => {
      r.points.sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev] || (b.cm || 0) - (a.cm || 0));
      r.sev = r.points[0].sev;
      r.peak = r.points[0].cm; // may be null for text-classified (iTIC/Traffy) reports
      return r;
    });
    roads.sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev] || (b.peak || 0) - (a.peak || 0));
    return roads;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- geometry: snap each sensor to a real road segment via Overpass ----------

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000,
      toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1),
      dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // closest point on segment (a-b) to p, all {lat,lon}; planar approx (fine at city scale)
  function closestOnSegment(p, a, b) {
    const ax = a.lon, ay = a.lat, bx = b.lon, by = b.lat, px = p.lon, py = p.lat;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return { lat: cy, lon: cx, t };
  }

  function nearestWayAndSegment(ways, lat, lon) {
    let best = null;
    for (const way of ways) {
      const g = way.geometry;
      if (!g || g.length < 2) continue;
      for (let i = 0; i < g.length - 1; i++) {
        const c = closestOnSegment({ lat, lon }, g[i], g[i + 1]);
        const d = haversine(lat, lon, c.lat, c.lon);
        if (!best || d < best.dist) best = { dist: d, way, segIndex: i, point: c };
      }
    }
    return best;
  }

  // walk outward from the projected point along the way, collecting ~SEG_HALF_LEN_M each side
  function extractSubpolyline(way, segIndex, projPoint) {
    const g = way.geometry;
    const coords = [[projPoint.lat, projPoint.lon]];

    let acc = 0;
    for (let i = segIndex; i >= 0 && acc < SEG_HALF_LEN_M; i--) {
      const from = i === segIndex ? projPoint : g[i + 1];
      const to = g[i];
      const d = haversine(from.lat, from.lon, to.lat, to.lon);
      acc += d;
      coords.unshift([to.lat, to.lon]);
      if (acc >= SEG_HALF_LEN_M) break;
    }
    acc = 0;
    for (let i = segIndex + 1; i < g.length && acc < SEG_HALF_LEN_M; i++) {
      const from = i === segIndex + 1 ? projPoint : g[i - 1];
      const to = g[i];
      const d = haversine(from.lat, from.lon, to.lat, to.lon);
      acc += d;
      coords.push([to.lat, to.lon]);
      if (acc >= SEG_HALF_LEN_M) break;
    }
    return coords;
  }

  function loadGeomCache() {
    try {
      return JSON.parse(localStorage.getItem(GEOM_CACHE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }
  function saveGeomCache(cache) {
    try {
      localStorage.setItem(GEOM_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      /* storage full/unavailable — fine, just skip persistence */
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function fetchOverpassChunk(points, attempt) {
    attempt = attempt || 0;
    const clauses = points.map((p) => `way(around:55,${p.lat},${p.lng})[highway];`).join("");
    const q = `[out:json][timeout:22];(${clauses});out geom;`;
    const res = await fetch(OVERPASS, { method: "POST", body: "data=" + encodeURIComponent(q) });
    if (res.status === 429 || res.status === 504) {
      if (attempt >= 3) throw new Error("overpass HTTP " + res.status + " (gave up after retries)");
      await sleep(4000 * (attempt + 1));
      return fetchOverpassChunk(points, attempt + 1);
    }
    if (!res.ok) throw new Error("overpass HTTP " + res.status);
    const json = await res.json();
    const ways = (json.elements || []).filter((e) => e.type === "way");
    const result = {};
    for (const p of points) {
      const best = nearestWayAndSegment(ways, p.lat, p.lng);
      if (best && best.dist < 55) {
        result[p.code] = extractSubpolyline(best.way, best.segIndex, best.point);
      }
    }
    return result;
  }

  async function loadStaticGeometry() {
    try {
      const res = await fetch("bma-geometry.json", { cache: "no-cache" });
      if (!res.ok) return {};
      return await res.json();
    } catch (e) {
      return {};
    }
  }

  async function loadRoadGeometry(points, onChunkReady) {
    const staticGeom = await loadStaticGeometry();
    if (Object.keys(staticGeom).length) onChunkReady(staticGeom);

    const cache = loadGeomCache();
    const geomByCode = { ...staticGeom };
    const missing = [];
    for (const p of points) {
      if (geomByCode[p.code]) continue;
      if (cache[p.code]) geomByCode[p.code] = cache[p.code];
      else missing.push(p);
    }
    if (Object.keys(cache).length) onChunkReady(Object.fromEntries(Object.entries(cache).filter(([k]) => !staticGeom[k])));
    if (!missing.length) return geomByCode;

    const chunks = [];
    for (let i = 0; i < missing.length; i += CHUNK_SIZE) chunks.push(missing.slice(i, i + CHUNK_SIZE));

    let cursor = 0;
    let dirty = false;
    async function worker() {
      while (cursor < chunks.length) {
        const chunk = chunks[cursor++];
        try {
          const res = await fetchOverpassChunk(chunk);
          Object.assign(geomByCode, res);
          Object.assign(cache, res);
          dirty = true;
          onChunkReady(res);
        } catch (e) {
          console.warn("Overpass chunk failed", e);
        }
        await sleep(1200); // be polite to the shared public Overpass instance
      }
    }
    await Promise.all(Array.from({ length: CHUNK_CONCURRENCY }, worker));
    if (dirty) saveGeomCache(cache);
    return geomByCode;
  }

  // ---------- map ----------

  let map;
  let segLayer, markerLayer;
  const segByCode = new Map(); // code -> Leaflet polyline
  const markerByCode = new Map(); // code -> Leaflet circleMarker

  let radarLayerGroup, rainLayerGroup, wlLayerGroup;
  let baseTileLayer, labelTileLayer;
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";

  function isDarkMode() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function applyBasemap() {
    const dark = isDarkMode();
    if (baseTileLayer) map.removeLayer(baseTileLayer);
    if (labelTileLayer) map.removeLayer(labelTileLayer);
    const base = dark ? "World_Dark_Gray_Base" : "World_Light_Gray_Base";
    const ref = dark ? "World_Dark_Gray_Reference" : "World_Light_Gray_Reference";
    baseTileLayer = L.tileLayer(ESRI + base + "/MapServer/tile/{z}/{y}/{x}", {
      maxNativeZoom: 16, maxZoom: 19,
      attribution: "Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
    }).addTo(map);
    baseTileLayer.bringToBack();
    labelTileLayer = L.tileLayer(ESRI + ref + "/MapServer/tile/{z}/{y}/{x}", {
      pane: "labels", maxNativeZoom: 16, maxZoom: 19,
    }).addTo(map);
  }

  function initMap() {
    map = L.map("map", { zoomControl: true, attributionControl: true }).setView([13.75, 100.55], 12);
    map.createPane("labels").style.zIndex = 450;
    map.getPane("labels").style.pointerEvents = "none";
    applyBasemap();
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyBasemap);
    }
    radarLayerGroup = L.layerGroup().addTo(map); // below sensors
    segLayer = L.layerGroup().addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    rainLayerGroup = L.layerGroup();
    wlLayerGroup = L.layerGroup();
  }

  // ---------- weather: rain radar (RainViewer) + rain gauges & river/canal levels (ThaiWater) ----------

  const TW = "https://api-v3.thaiwater.net/api/v1/thaiwater30/public/";
  const WX_URLS = { rain: TW + "rain_24h", wl: TW + "waterlevel_load", radar: "https://api.rainviewer.com/public/weather-maps.json" };
  const RAIN24 = [[150, "#8b0a1a", ">150"], [90, "#e5383b", "90–150"], [35, "#f26b1d", "35–90"], [10, "#f0b93b", "10–35"], [0.1, "#59c3ea", "0.1–10"], [-1, "#5b6b84", "0"]];
  const WLS = [[100, "#e5383b", ">100 over bank"], [90, "#f26b1d", "90–100 near bank"], [70, "#f0b93b", "70–90 high"], [30, "#34d399", "30–70 normal"], [-1e9, "#5b6b84", "≤30 low"]];
  const pickScale = (sc, v) => { for (const s of sc) if (v > s[0]) return s; return sc[sc.length - 1]; };
  const BKK_BBOX = { s: 13.3, n: 14.2, w: 100.1, e: 101.0 };
  const inBkkBox = (la, lo) => la >= BKK_BBOX.s && la <= BKK_BBOX.n && lo >= BKK_BBOX.w && lo <= BKK_BBOX.e;

  function bkkDate(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?/);
    if (!m) return null;
    const d = new Date(m[1] + "T" + m[2] + (m[3] || ":00") + "+07:00");
    return isNaN(d) ? null : d;
  }
  function fmtBkkTime(d) {
    return d ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "–";
  }

  // -- radar --
  let radarFrames = [], radarIdx = 0, radarTimer = null, radarTiles = {};
  async function loadRadar() {
    try {
      const d = await fetchJSON(WX_URLS.radar);
      const past = d && d.radar && d.radar.past;
      if (!Array.isArray(past) || !past.length) throw new Error("no radar frames");
      radarFrames = past.slice(-7).map((f) => ({ time: new Date(f.time * 1000), url: d.host + f.path + "/256/{z}/{x}/{y}/2/1_1.png" }));
      const last = radarFrames[radarFrames.length - 1];
      stopRadar();
      radarLayerGroup.clearLayers();
      radarTiles = {};
      radarIdx = radarFrames.length - 1;
      showRadarFrame(radarIdx);
      document.getElementById("radarCtl").classList.toggle("hidden", !document.getElementById("lyRadar").checked);
    } catch (e) {
      console.warn("radar unavailable", e);
      document.getElementById("radarCtl").classList.add("hidden");
    }
  }
  function radarTileLayer(i) {
    const f = radarFrames[i];
    if (!radarTiles[f.url]) {
      radarTiles[f.url] = L.tileLayer(f.url, {
        opacity: 0, maxNativeZoom: 7, maxZoom: 19, zIndex: 300,
        attribution: 'Radar &copy; <a href="https://www.rainviewer.com">RainViewer</a>',
      });
    }
    const l = radarTiles[f.url];
    if (!radarLayerGroup.hasLayer(l)) radarLayerGroup.addLayer(l);
    return l;
  }
  function showRadarFrame(i) {
    const l = radarTileLayer(i);
    Object.values(radarTiles).forEach((x) => { if (x !== l) x.setOpacity(0); });
    l.setOpacity(0.5);
    if (radarFrames[i + 1]) radarTileLayer(i + 1);
    document.getElementById("radarTime").textContent =
      fmtBkkTime(radarFrames[i].time) + (i === radarFrames.length - 1 ? " · latest" : "") + " ICT";
  }
  function stopRadar() {
    if (radarTimer) clearInterval(radarTimer);
    radarTimer = null;
    const btn = document.getElementById("radarPlay");
    if (btn) btn.textContent = "▶";
  }

  // -- rain gauges --
  async function loadRain() {
    try {
      const d = await fetchJSON(WX_URLS.rain);
      if (!d || !Array.isArray(d.data)) throw new Error("bad rain response");
      const cutoff = Date.now() - 30 * 3600 * 1000;
      const stations = d.data
        .map((x) => ({
          x,
          t: bkkDate(x.rainfall_datetime),
          lat: parseFloat(x.station && x.station.tele_station_lat),
          lon: parseFloat(x.station && x.station.tele_station_long),
          r24: x.rain_24h != null ? parseFloat(x.rain_24h) : null,
        }))
        .filter((s) => s.lat && s.lon && inBkkBox(s.lat, s.lon) && s.t && s.t.getTime() >= cutoff && s.r24 != null);
      rainLayerGroup.clearLayers();
      for (const s of stations) {
        const p = pickScale(RAIN24, s.r24);
        const name = (s.x.station.tele_station_name && (s.x.station.tele_station_name.en || s.x.station.tele_station_name.th)) || "Rain gauge";
        const html = `<div class="m">Rainfall gauge · ThaiWater</div><h3>${escapeHtml(name)}</h3><div><span class="big">${s.r24}</span> mm / 24h</div><div class="m">Reading ${fmtBkkTime(s.t)} ICT</div>`;
        L.circleMarker([s.lat, s.lon], { radius: s.r24 > 90 ? 8 : 6, color: "#fff", weight: 1.5, fillColor: p[1], fillOpacity: 0.9 })
          .bindPopup(html)
          .addTo(rainLayerGroup);
      }
    } catch (e) {
      console.warn("rain gauges unavailable", e);
    }
  }

  // -- river / canal water levels --
  async function loadWL() {
    try {
      const d = await fetchJSON(WX_URLS.wl);
      const arr = d && d.waterlevel_data && d.waterlevel_data.data;
      if (!Array.isArray(arr)) throw new Error("bad water-level response");
      const stations = arr
        .map((x) => ({
          x,
          t: bkkDate(x.waterlevel_datetime),
          lat: parseFloat(x.station && x.station.tele_station_lat),
          lon: parseFloat(x.station && x.station.tele_station_long),
          pct: x.storage_percent != null ? parseFloat(x.storage_percent) : null,
          msl: x.waterlevel_msl != null ? parseFloat(x.waterlevel_msl) : null,
        }))
        .filter((s) => s.lat && s.lon && inBkkBox(s.lat, s.lon) && s.t);
      wlLayerGroup.clearLayers();
      for (const s of stations) {
        const stale = Date.now() - s.t > 6 * 3600 * 1000;
        const p = s.pct != null ? pickScale(WLS, s.pct) : null;
        const color = stale ? "#5b6b84" : p ? p[1] : "#5b6b84";
        const name = (s.x.station.tele_station_name && (s.x.station.tele_station_name.en || s.x.station.tele_station_name.th)) || "Water-level station";
        const html = `<div class="m">River / canal station · ThaiWater${stale ? " · stale" : ""}</div><h3>${escapeHtml(name)}</h3><div><span class="big">${s.msl != null ? s.msl.toFixed(2) : "–"}</span> m MSL${s.pct != null ? " · " + s.pct.toFixed(0) + "% of bank-full" : ""}</div><div class="m">Reading ${fmtBkkTime(s.t)} ICT</div>`;
        const icon = L.divIcon({
          className: "", iconSize: [14, 14], iconAnchor: [7, 7],
          html: `<div style="width:12px;height:12px;transform:rotate(45deg);border-radius:3px;border:2px solid #fff;background:${color};box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>`,
        });
        L.marker([s.lat, s.lon], { icon }).bindPopup(html).addTo(wlLayerGroup);
      }
    } catch (e) {
      console.warn("water-level stations unavailable", e);
    }
  }

  function wireWeatherControls() {
    const lyRoads = document.getElementById("lyRoads");
    const lyRadar = document.getElementById("lyRadar");
    const lyRain = document.getElementById("lyRain");
    const lyWl = document.getElementById("lyWl");

    lyRoads.addEventListener("change", () => {
      if (lyRoads.checked) { map.addLayer(segLayer); map.addLayer(markerLayer); }
      else { map.removeLayer(segLayer); map.removeLayer(markerLayer); }
    });
    lyRadar.addEventListener("change", () => {
      if (lyRadar.checked) { map.addLayer(radarLayerGroup); document.getElementById("radarCtl").classList.toggle("hidden", !radarFrames.length); }
      else { map.removeLayer(radarLayerGroup); document.getElementById("radarCtl").classList.add("hidden"); }
    });
    const setLoading = (id, on) => {
      const label = document.querySelector(`#${id} + span`);
      if (label) label.textContent = label.textContent.replace(/ \(loading…\)$/, "") + (on ? " (loading…)" : "");
    };
    lyRain.addEventListener("change", () => {
      if (lyRain.checked) {
        map.addLayer(rainLayerGroup);
        if (!rainLayerGroup.getLayers().length) {
          setLoading("lyRain", true);
          loadRain().finally(() => setLoading("lyRain", false));
        }
      } else map.removeLayer(rainLayerGroup);
    });
    lyWl.addEventListener("change", () => {
      if (lyWl.checked) {
        map.addLayer(wlLayerGroup);
        if (!wlLayerGroup.getLayers().length) {
          setLoading("lyWl", true);
          loadWL().finally(() => setLoading("lyWl", false));
        }
      } else map.removeLayer(wlLayerGroup);
    });

    document.getElementById("radarPlay").addEventListener("click", () => {
      const btn = document.getElementById("radarPlay");
      if (radarTimer) { stopRadar(); radarIdx = radarFrames.length - 1; showRadarFrame(radarIdx); return; }
      if (!radarFrames.length) return;
      btn.textContent = "❚❚";
      radarIdx = 0;
      showRadarFrame(0);
      radarTimer = setInterval(() => { radarIdx = (radarIdx + 1) % radarFrames.length; showRadarFrame(radarIdx); }, 800);
    });
  }

  function bootWeather() {
    wireWeatherControls();
    loadRadar();
    setInterval(loadRadar, 5 * 60 * 1000);
    setInterval(() => { if (map.hasLayer(rainLayerGroup)) loadRain(); }, 10 * 60 * 1000);
    setInterval(() => { if (map.hasLayer(wlLayerGroup)) loadWL(); }, 10 * 60 * 1000);
  }

  function depthLabel(p) {
    return p.cm != null && p.cm > 0 ? p.cm.toFixed(0) + " cm" : SEV_LABEL[p.sev];
  }

  function popupHTML(p) {
    return `<strong>${escapeHtml(p.road)}</strong><br>${escapeHtml(p.location) || "—"}<br>${
      p.district ? escapeHtml(p.district) + " · " : ""
    }<strong>${depthLabel(p)}</strong> (${SEV_LABEL[p.sev]})<br><span style="opacity:.6">${escapeHtml(SOURCE_LABEL[p.source] || p.source)} · ${escapeHtml(
      p.code
    )}</span>`;
  }

  function renderMarkersAndSegments(points) {
    segLayer.clearLayers();
    markerLayer.clearLayers();
    segByCode.clear();
    markerByCode.clear();
    for (const p of points) {
      const m = L.circleMarker([p.lat, p.lng], {
        radius: p.sev === "normal" ? 2.5 : 4 + Math.min(p.cm || 12, 40) / 10,
        color: "#04141c",
        weight: p.sev === "normal" ? 0 : 1,
        fillColor: SEV_COLOR[p.sev],
        fillOpacity: p.sev === "normal" ? 0.55 : 0.95,
      });
      m.bindPopup(popupHTML(p));
      m.addTo(markerLayer);
      markerByCode.set(p.code, m);
    }
  }

  function applyGeometry(geomByCode, pointsByCode) {
    for (const code in geomByCode) {
      const p = pointsByCode.get(code);
      if (!p) continue;
      const coords = geomByCode[code];
      const line = L.polyline(coords, {
        color: SEV_COLOR[p.sev],
        weight: SEV_WEIGHT[p.sev],
        opacity: p.sev === "normal" ? 0.55 : 0.9,
        lineCap: "round",
      });
      line.bindPopup(popupHTML(p));
      line.addTo(segLayer);
      segByCode.set(code, line);
      // once a road-hugging segment exists, fade the raw dot down to a thin outline
      const marker = markerByCode.get(code);
      if (marker) marker.setStyle({ radius: 2, weight: 0, fillOpacity: 0.5 });
    }
  }

  function restyleForSeverity(points) {
    for (const p of points) {
      const line = segByCode.get(p.code);
      if (line) {
        line.setStyle({ color: SEV_COLOR[p.sev], weight: SEV_WEIGHT[p.sev], opacity: p.sev === "normal" ? 0.55 : 0.9 });
        line.setPopupContent(popupHTML(p));
      }
      const marker = markerByCode.get(p.code);
      if (marker) {
        marker.setStyle({ fillColor: SEV_COLOR[p.sev] });
        marker.setPopupContent(popupHTML(p));
      }
    }
  }

  function flyToPoint(p) {
    map.flyTo([p.lat, p.lng], 16, { duration: 0.6 });
    const line = segByCode.get(p.code) || markerByCode.get(p.code);
    if (line) setTimeout(() => line.openPopup(), 650);
  }

  // ---------- panel: list, KPIs, filters ----------

  function renderKPIs(points) {
    const counts = { severe: 0, flood: 0, slight: 0, normal: 0 };
    for (const p of points) counts[p.sev]++;
    document.getElementById("kSevere").textContent = counts.severe;
    document.getElementById("kFlood").textContent = counts.flood;
    document.getElementById("kSlight").textContent = counts.slight;
    document.getElementById("kNormal").textContent = counts.normal;
  }

  let roadsData = [];
  function roadCardHTML(r, idx) {
    const sourceTags = [...r.sources].map((s) => `<span class="src-tag src-${s}">${escapeHtml(SOURCE_LABEL[s] || s)}</span>`).join("");
    const peakLabel = r.peak != null && r.peak > 0 ? r.peak.toFixed(0) + " cm" : SEV_LABEL[r.sev];
    return `
    <article class="road-card" style="--sev:${SEV_COLOR[r.sev]}" data-idx="${idx}" data-zone="${DISTRICT_ZONE[r.district] || ""}"
      data-search="${escapeHtml((r.road + " " + r.district).toLowerCase())}" tabindex="0" role="button">
      <div class="rc-top">
        <div class="rc-name">${escapeHtml(r.road)}</div>
        <div class="rc-peak">${peakLabel}</div>
      </div>
      <div class="rc-district">${r.district ? escapeHtml(r.district) + " · " : ""}${r.points.length} report${r.points.length > 1 ? "s" : ""}</div>
      <div class="rc-sources">${sourceTags}</div>
    </article>`;
  }

  function renderList(roads) {
    const wet = roads.filter((r) => r.sev !== "normal");
    roadsData = wet;
    document.getElementById("roadCount").textContent = wet.length ? `(${wet.length})` : "";
    const el = document.getElementById("roadList");
    if (!wet.length) {
      el.innerHTML = '<div class="loading">No roads currently reporting standing water.</div>';
      return;
    }
    el.innerHTML = wet.map(roadCardHTML).join("");
    applyFilters();
  }

  let currentZone = "all";
  function applyFilters() {
    const q = document.getElementById("search").value.trim().toLowerCase();
    document.querySelectorAll(".road-card").forEach((card) => {
      const zoneOk = currentZone === "all" || card.dataset.zone === currentZone;
      const searchOk = !q || card.dataset.search.includes(q);
      card.style.display = zoneOk && searchOk ? "" : "none";
    });
  }

  function wireControls() {
    document.getElementById("search").addEventListener("input", applyFilters);
    document.getElementById("zones").addEventListener("click", (e) => {
      const btn = e.target.closest(".zone-btn");
      if (!btn) return;
      document.querySelectorAll(".zone-btn").forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
      currentZone = btn.dataset.z;
      applyFilters();
    });
    document.getElementById("roadList").addEventListener("click", (e) => {
      const card = e.target.closest(".road-card");
      if (!card) return;
      const r = roadsData[+card.dataset.idx];
      if (r) flyToPoint(r.points[0]);
    });
    const panel = document.getElementById("panel");
    const toggle = document.getElementById("panelToggle");
    toggle.addEventListener("click", () => {
      panel.classList.toggle("collapsed");
      toggle.classList.toggle("collapsed");
      toggle.setAttribute("aria-expanded", String(!panel.classList.contains("collapsed")));
      setTimeout(() => map.invalidateSize(), 240);
    });
  }

  function formatAsOf(iso, geomNote) {
    let s;
    if (!iso) s = "no live reading yet";
    else {
      const bkk = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short",
      }).format(new Date(iso));
      s = `Readings as of ${bkk} ICT`;
    }
    return s;
  }

  // ---------- boot ----------

  async function tick(pointsByCode) {
    const [bmaR, iticR, traffyR] = await Promise.all([loadSensorData(), loadEvents(), loadTraffy()]);
    const points = [...bmaR.points, ...iticR.points, ...traffyR.points];
    const roads = groupByRoad(points);

    const statusParts = [bmaR.ok ? formatAsOf(bmaR.latestTs) : "BMA sensor feed unavailable"];
    if (!iticR.ok) statusParts.push("iTIC feed unavailable");
    if (!traffyR.ok) statusParts.push("Traffy feed unavailable");
    document.getElementById("asOf").textContent = statusParts.join(" · ");

    if (!points.length) {
      document.getElementById("roadList").innerHTML =
        '<div class="loading">All road-flood feeds (BMA, iTIC, Traffy) are unreachable right now. Try reloading in a minute.</div>';
    }
    renderKPIs(points);
    renderList(roads);

    const prevCodes = new Set(pointsByCode.keys());
    pointsByCode.clear();
    for (const p of points) pointsByCode.set(p.code, p);

    if (segByCode.size === 0 && markerByCode.size === 0) {
      renderMarkersAndSegments(points);
    } else {
      restyleForSeverity(points);
      // draw markers for any brand-new reports we haven't seen yet
      for (const p of points) if (!markerByCode.has(p.code)) {
        const m = L.circleMarker([p.lat, p.lng], { radius: 3, color: "#04141c", weight: 0, fillColor: SEV_COLOR[p.sev], fillOpacity: 0.7 });
        m.bindPopup(popupHTML(p));
        m.addTo(markerLayer);
        markerByCode.set(p.code, m);
      }
      // iTIC/Traffy reports can expire between ticks (BMA sensor codes are permanent, so leave those alone)
      for (const code of prevCodes) {
        if (pointsByCode.has(code) || code.startsWith("FL.")) continue;
        const m = markerByCode.get(code);
        if (m) { markerLayer.removeLayer(m); markerByCode.delete(code); }
      }
    }
    return points;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    initMap();
    wireControls();
    bootWeather();
    const pointsByCode = new Map();
    const points = await tick(pointsByCode);

    const geomStatus = document.getElementById("geomStatus");
    if (points.length) {
      geomStatus.textContent = "Snapping sensors to road geometry…";
      loadRoadGeometry(points, (chunkGeom) => {
        applyGeometry(chunkGeom, pointsByCode);
      }).then((full) => {
        const n = Object.keys(full).length;
        geomStatus.textContent = n ? `${n}/${points.length} sensors mapped to roads` : "";
      });
    }

    setInterval(() => tick(pointsByCode), REFRESH_MS);
  });
})();
