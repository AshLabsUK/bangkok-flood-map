(function () {
  "use strict";

  const API = "https://floodbangkok.bangkok.go.th/bkk/dds/services/api/floods/v1/items/";
  const REFRESH_MS = 3 * 60 * 1000;

  // ---------- translation helpers ----------

  function translateDistrict(th) {
    return DISTRICT_EN[th] || th;
  }

  function translateRoad(th) {
    if (!th) return "Unnamed road";
    const t = th.trim();
    if (ROAD_EN[t]) return ROAD_EN[t];
    // try without trailing/leading spaces variants already stripped; try soi-number split
    const m = t.match(/^(.*?)(\s*\d[\d/]*)$/);
    if (m && ROAD_EN[m[1].trim()]) return ROAD_EN[m[1].trim()] + " " + m[2].trim();
    return t; // honest fallback: leave the untranslated Thai rather than guess
  }

  function roadCore(th) {
    return (th || "").replace(/^(ถนน|ถ\.|ซอย|ซ\.)\s*/, "").trim();
  }

  function translateLocation(name, roadTh) {
    if (!name) return "";
    let s = name;
    const core = roadCore(roadTh);
    if (core) {
      // strip a leading "ถ./ซ./ถนน/ซอย <core>" mention of the same road, any abbreviation style
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
  const SEV_LABEL = { severe: "Severe", flood: "Flooded", slight: "Slight", normal: "Normal" };
  const SEV_RANK = { severe: 3, flood: 2, slight: 1, normal: 0 };

  // ---------- data fetch ----------

  async function fetchJSON(url) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function loadData() {
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
      .filter((s) => (s.code || "").startsWith("FL."))
      .map((s) => {
        const latest = latestBySensor.get(s.id);
        const cm = latest ? parseFloat(latest.value) : 0;
        if (latest && latest.date_created) {
          if (!latestTs || latest.date_created > latestTs) latestTs = latest.date_created;
        }
        return {
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
      })
      .filter((p) => p.lat && p.lng);

    return { points, latestTs };
  }

  // ---------- grouping ----------

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

  // ---------- rendering ----------

  let map, layerGroup;
  function initMap() {
    map = L.map("map", { scrollWheelZoom: false }).setView([13.75, 100.55], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    layerGroup = L.layerGroup().addTo(map);
  }

  const SEV_COLOR = { severe: "#e0536a", flood: "#f0784f", slight: "#f0b93b", normal: "#34d399" };

  function renderMap(points) {
    layerGroup.clearLayers();
    for (const p of points) {
      if (p.sev === "normal") continue; // keep the map focused on active water
      const m = L.circleMarker([p.lat, p.lng], {
        radius: 6 + Math.min(p.cm, 40) / 6,
        color: SEV_COLOR[p.sev],
        fillColor: SEV_COLOR[p.sev],
        fillOpacity: 0.75,
        weight: 1,
      });
      m.bindPopup(
        `<strong>${escapeHtml(p.road)}</strong><br>${escapeHtml(p.location)}<br>${escapeHtml(
          p.district
        )} · <strong>${p.cm.toFixed(0)} cm</strong> (${SEV_LABEL[p.sev]})<br><span style="opacity:.6">${escapeHtml(
          p.code
        )}</span>`
      );
      m.addTo(layerGroup);
    }
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderKPIs(points) {
    const counts = { severe: 0, flood: 0, slight: 0, normal: 0 };
    for (const p of points) counts[p.sev]++;
    document.getElementById("kSevere").textContent = counts.severe;
    document.getElementById("kFlood").textContent = counts.flood;
    document.getElementById("kSlight").textContent = counts.slight;
    document.getElementById("kNormal").textContent = counts.normal;
  }

  function roadCardHTML(r) {
    const mapsUrl = `https://www.google.com/maps?q=${r.points[0].lat},${r.points[0].lng}`;
    const ptsHtml = r.points
      .map(
        (p) => `
      <div class="pt sev-${p.sev}">
        <span class="pt-loc"><span class="pt-code">${escapeHtml(p.code)}</span>${escapeHtml(p.location) || "—"}</span>
        <span class="pt-val">${p.cm > 0 ? p.cm.toFixed(0) + " cm" : "normal"}</span>
      </div>`
      )
      .join("");
    return `
    <article class="road-card" style="--sev:${SEV_COLOR[r.sev]}" data-zone="${DISTRICT_ZONE[r.district] || ""}" data-search="${escapeHtml(
      (r.road + " " + r.district).toLowerCase()
    )}">
      <div class="rc-top">
        <div>
          <div class="rc-name">${escapeHtml(r.road)}</div>
          <div class="rc-district">${escapeHtml(r.district)} · ${r.points.length} sensor${r.points.length > 1 ? "s" : ""}</div>
        </div>
        <div class="rc-peak">${r.peak > 0 ? r.peak.toFixed(0) + " cm" : SEV_LABEL.normal}</div>
      </div>
      <div class="rc-points">${ptsHtml}</div>
      <a class="rc-link" href="${mapsUrl}" target="_blank" rel="noopener">View position on Google Maps →</a>
    </article>`;
  }

  function renderList(roads) {
    const wet = roads.filter((r) => r.sev !== "normal");
    document.getElementById("kRoads").textContent = wet.length;
    const el = document.getElementById("roadList");
    if (!wet.length) {
      el.innerHTML = '<div class="loading">No roads currently reporting standing water.</div>';
      return;
    }
    el.innerHTML = wet.map(roadCardHTML).join("");
    applyFilters();
  }

  // ---------- filters ----------

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
  }

  function formatAsOf(iso) {
    if (!iso) return "no live reading yet";
    const d = new Date(iso);
    const bkk = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "short",
    }).format(d);
    return `readings as of ${bkk} ICT`;
  }

  // ---------- boot ----------

  async function tick() {
    try {
      const { points, latestTs } = await loadData();
      const roads = groupByRoad(points);
      document.getElementById("asOf").textContent = formatAsOf(latestTs);
      renderKPIs(points);
      renderMap(points);
      renderList(roads);
    } catch (err) {
      document.getElementById("asOf").textContent = "feed unavailable";
      document.getElementById("roadList").innerHTML =
        '<div class="loading">Could not reach the BMA sensor feed right now. It may be temporarily down — try reloading in a minute.</div>';
      console.error(err);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initMap();
    wireControls();
    tick();
    setInterval(tick, REFRESH_MS);
  });
})();
