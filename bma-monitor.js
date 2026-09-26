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

  // ---------- BMA data fetch ----------

  async function fetchJSON(url) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function loadSensorData() {
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
        };
      });

    return { points, latestTs };
  }

  function groupByRoad(points) {
    const byRoad = new Map();
    for (const p of points) {
      const key = p.road + "|" + p.district;
      if (!byRoad.has(key)) byRoad.set(key, { road: p.road, district: p.district, points: [] });
      byRoad.get(key).points.push(p);
    }
    const roads = [...byRoad.values()].map((r) => {
      r.points.sort((a, b) => b.cm - a.cm);
      r.peak = r.points[0].cm;
      r.sev = severityOf(r.peak);
      return r;
    });
    roads.sort((a, b) => b.peak - a.peak);
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

  function initMap() {
    map = L.map("map", { zoomControl: true, attributionControl: true }).setView([13.75, 100.55], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    segLayer = L.layerGroup().addTo(map);
    markerLayer = L.layerGroup().addTo(map);
  }

  function popupHTML(p) {
    return `<strong>${escapeHtml(p.road)}</strong><br>${escapeHtml(p.location) || "—"}<br>${escapeHtml(
      p.district
    )} · <strong>${p.cm > 0 ? p.cm.toFixed(0) + " cm" : "clear"}</strong> (${SEV_LABEL[p.sev]})<br><span style="opacity:.6">${escapeHtml(
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
        radius: p.sev === "normal" ? 2.5 : 4 + Math.min(p.cm, 40) / 10,
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
    return `
    <article class="road-card" style="--sev:${SEV_COLOR[r.sev]}" data-idx="${idx}" data-zone="${DISTRICT_ZONE[r.district] || ""}"
      data-search="${escapeHtml((r.road + " " + r.district).toLowerCase())}" tabindex="0" role="button">
      <div class="rc-top">
        <div class="rc-name">${escapeHtml(r.road)}</div>
        <div class="rc-peak">${r.peak > 0 ? r.peak.toFixed(0) + " cm" : SEV_LABEL.normal}</div>
      </div>
      <div class="rc-district">${escapeHtml(r.district)} · ${r.points.length} sensor${r.points.length > 1 ? "s" : ""}</div>
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
    try {
      const { points, latestTs } = await loadSensorData();
      const roads = groupByRoad(points);
      document.getElementById("asOf").textContent = formatAsOf(latestTs);
      renderKPIs(points);
      renderList(roads);

      pointsByCode.clear();
      for (const p of points) pointsByCode.set(p.code, p);

      if (segByCode.size === 0) {
        renderMarkersAndSegments(points);
      } else {
        restyleForSeverity(points);
        // draw markers for any brand-new sensors we haven't seen yet
        for (const p of points) if (!markerByCode.has(p.code)) {
          const m = L.circleMarker([p.lat, p.lng], { radius: 3, color: "#04141c", weight: 0, fillColor: SEV_COLOR[p.sev], fillOpacity: 0.7 });
          m.bindPopup(popupHTML(p));
          m.addTo(markerLayer);
          markerByCode.set(p.code, m);
        }
      }
      return points;
    } catch (err) {
      document.getElementById("asOf").textContent = "feed unavailable";
      document.getElementById("roadList").innerHTML =
        '<div class="loading">Could not reach the BMA sensor feed right now. It may be temporarily down — try reloading in a minute.</div>';
      console.error(err);
      return [];
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    initMap();
    wireControls();
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
