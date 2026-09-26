/* Bangkok Flood Monitor – live client-side map. No mock data: every value comes from a public feed at load time. */
(function () {
  'use strict';
  const TZ = 'Asia/Bangkok';
  const PROVINCES = { '10': 'Bangkok', '11': 'Samut Prakan', '12': 'Nonthaburi', '13': 'Pathum Thani' };
  const BBOX = { s: 13.45, n: 14.15, w: 100.25, e: 100.95 };
  const FAST_MS = 5 * 60 * 1000, SLOW_MS = 10 * 60 * 1000;
  const TRAFFY_WINDOW_H = 3;
  const TW = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/';
  const URLS = {
    rain: TW + 'rain_24h',
    wl: TW + 'waterlevel_load',
    events: 'https://event.longdo.com/feed/json',
    traffy: 'https://publicapi.traffy.in.th/share/teamchadchart/search?limit=500',
    cams: 'https://camera.longdo.com/feed/?command=json',
    radar: 'https://api.rainviewer.com/public/weather-maps.json'
  };
  const C = { red: '#e5383b', yellow: '#f4b400', green: '#2eb872' };

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inBox = (la, lo) => la >= BBOX.s && la <= BBOX.n && lo >= BBOX.w && lo <= BBOX.e;
  const fmtT = (d) => d ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d) : '–';
  const fmtDT = (d) => d ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d) : '–';
  const bkkDate = (s) => { if (!s) return null; const m = String(s).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?/); if (!m) return null; const d = new Date(m[1] + 'T' + m[2] + (m[3] || ':00') + '+07:00'); return isNaN(d) ? null : d; };
  const utcDate = (s) => { if (!s) return null; const d = new Date(String(s).replace(' ', 'T').replace(/(\.\d{3})\d*/, '$1').replace(/\+00$/, 'Z')); return isNaN(d) ? null : d; };
  const fmtRep = (d) => { if (!d) return '–'; const hm = fmtT(d); return hm === '00:00' ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' }).format(d) + ' (daily report)' : fmtDT(d); };
  const ago = (d) => { if (!d) return ''; const m = Math.round((Date.now() - d) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.floor(m / 60); if (h < 48) return h + ' h ' + (m % 60) + ' min ago'; return Math.floor(h / 24) + ' days ago'; };
  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  const nm = (o) => o ? (o.th || o.en || '') : '';
  function dist(a, b, c, d) { const R = 6371, r = Math.PI / 180, x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r; return Math.sqrt(x * x + y * y) * R; }
  async function getJSON(url, ms) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms || 60000);
    try { const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
    catch (e) { throw new Error(e.name === 'AbortError' ? 'timed out' : (e.message || 'network error')); }
    finally { clearTimeout(t); }
  }

  // ---------- feeds status ----------
  const FEEDS = {
    radar: { name: 'Rain radar – RainViewer', link: 'https://www.rainviewer.com/api.html', cadence: '~10 min' },
    events: { name: 'Flooded roads – Longdo Traffic / iTIC (DOH, BMA Drainage Dept., iTIC)', link: 'https://traffic.longdo.com', cadence: 'real-time' },
    traffy: { name: 'Citizen flood reports – Traffy Fondue (BMA)', link: 'https://fondue.traffy.in.th', cadence: 'real-time' },
    rain: { name: 'Rainfall stations – ThaiWater (HII, RID, TMD, BMA…)', link: 'https://www.thaiwater.net', cadence: '10 min – daily' },
    wl: { name: 'Water level stations – ThaiWater (HII, RID…)', link: 'https://www.thaiwater.net', cadence: '10 min – hourly' },
    cams: { name: 'Traffic cameras – iTIC Foundation via Longdo (DOH & iTIC cameras)', link: 'https://camera.longdo.com', cadence: 'live video, list re-checked hourly' },
    gistda: { name: 'Satellite flood extent – GISTDA', link: 'https://disaster.gistda.or.th', cadence: 'daily', status: 'fail', msg: 'Not embedded: GISTDA API/WMS requires an API key. Open the official viewer.' }
  };
  function setFeed(k, status, msg, dataTime) { Object.assign(FEEDS[k], { status, msg, dataTime, fetched: status === 'ok' ? new Date() : FEEDS[k].fetched }); renderFeeds(); }
  function renderFeeds() {
    $('feeds').innerHTML = Object.values(FEEDS).map((f) => {
      const st = f.status || 'loading';
      let s = st === 'ok' ? 'OK · fetched ' + fmtT(f.fetched) + (f.dataTime ? ' · latest data ' + fmtDT(f.dataTime) : '') : st === 'loading' ? 'Loading…' : 'Feed unavailable – ' + esc(f.msg || '');
      if (st === 'ok' && f.msg) s += ' · ' + esc(f.msg);
      return `<div class="feed ${st}"><span class="st"></span><div><a href="${f.link}" target="_blank" rel="noopener">${esc(f.name)}</a><div class="fs">${s} · updates ${esc(f.cadence)}</div></div></div>`;
    }).join('');
  }

  // ---------- map ----------
  const isMobile = matchMedia('(max-width:820px)').matches;
  const map = L.map('map', { zoomControl: !isMobile, preferCanvas: true, minZoom: 8, maxZoom: 18 }).setView([13.76, 100.56], isMobile ? 10 : 11);
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
  L.tileLayer(ESRI + 'World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 16, maxZoom: 19, attribution: 'Basemap © Esri, HERE, Garmin, © OpenStreetMap contributors' }).addTo(map);
  map.createPane('labels').style.zIndex = 450; map.getPane('labels').style.pointerEvents = 'none';
  L.tileLayer(ESRI + 'World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { pane: 'labels', maxNativeZoom: 16, maxZoom: 19 }).addTo(map);
  const canvas = L.canvas({ padding: 0.3 });
  const layers = {
    radar: L.layerGroup().addTo(map),
    roads: L.layerGroup().addTo(map),
    traffy: L.layerGroup().addTo(map),
    rain: L.layerGroup().addTo(map),
    wl: L.layerGroup().addTo(map),
    cams: L.layerGroup().addTo(map)
  };
  map.createPane('roadsPane').style.zIndex = 640;
  L.control.layers(null, {
    'Rain radar': layers.radar,
    '<b style="color:#e5383b">■</b><b style="color:#f4b400">■</b> Flooded roads (agency / iTIC)': layers.roads,
    '○ Citizen flood reports (Traffy, last 3 h)': layers.traffy,
    'Rainfall stations': layers.rain,
    'Water level stations': layers.wl,
    '▶ Traffic cameras (live)': layers.cams
  }, { collapsed: isMobile, position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

  // ---------- scales ----------
  const RAIN24 = [[150, '#8b0a1a', '>150'], [90, '#e5383b', '90–150'], [35, '#f26b1d', '35–90'], [10, '#f4b400', '10–35'], [0.1, '#3a8ee6', '0.1–10'], [-1, '#b8c2cf', '0']];
  const RAIN1 = [[40, '#8b0a1a', '>40'], [20, '#e5383b', '20–40'], [10, '#f26b1d', '10–20'], [5, '#f4b400', '5–10'], [0.1, '#3a8ee6', '0.1–5'], [-1, '#b8c2cf', '0']];
  const WLS = [[100, '#e5383b', '>100 over bank'], [90, '#f26b1d', '90–100 near bank'], [70, '#f4b400', '70–90 high'], [30, '#2eb872', '30–70 normal'], [-1e9, '#8aa0b8', '≤30 low']];
  const pick = (sc, v) => { for (const s of sc) if (v > s[0]) return s; return sc[sc.length - 1]; };
  let rainKey = '24';
  function renderScales() {
    const sc = rainKey === '24' ? RAIN24 : RAIN1;
    $('rainScale').innerHTML = sc.slice().reverse().map((s) => `<span style="background:${s[1]}">${s[2]}</span>`).join('') + `<span style="background:none;color:var(--mut)">(${rainKey} h)</span>`;
    $('wlScale').innerHTML = WLS.slice().reverse().map((s) => `<span style="background:${s[1]}">${s[2]}</span>`).join('') + '<span style="background:#fff;color:#8aa0b8;border:1px dashed #8aa0b8">stale &gt;6 h</span>';
  }

  // ---------- road flood classification (from report text only) ----------
  function classify(text) {
    const t = String(text || '');
    const out = { level: 'yellow', depth: null, reason: 'Flooding reported; depth not stated' };
    let maxcm = null; const re = /(\d{1,3})(?:\s*[-–~ถึง]+\s*(\d{1,3}))?\s*(?:ซ\.?\s?ม\.?|ซม|เซน(?:ติเมตร)?|cm)/gi; let m;
    while ((m = re.exec(t))) { const v = Math.max(+m[1], m[2] ? +m[2] : 0); if (v > 0 && v < 300) { maxcm = Math.max(maxcm || 0, v); out.depth = m[0].trim(); } }
    if (/ผ่านไม่ได้|ไม่สามารถผ่าน|ไม่สามารถสัญจร|สัญจรไม่ได้|ผ่านไม่สะดวก|ปิดการจราจร|ปิดถนน|impassable|not passable/i.test(t)) return Object.assign(out, { level: 'red', reason: 'Reported not passable' + (out.depth ? ' · ' + out.depth : '') });
    if (/น้ำลด(ลง)?แล้ว|ระบายแล้ว|ระบายเสร็จ|แห้งแล้ว|กลับสู่ภาวะปกติ|ผ่านได้ตามปกติ|receded/i.test(t)) return Object.assign(out, { level: 'green', reason: 'Source reports water receded / normal' });
    if (/ผ่านได้/.test(t)) return Object.assign(out, { level: 'yellow', reason: 'Reported passable' + (out.depth ? ' · ' + out.depth : '') });
    if (maxcm != null) return Object.assign(out, maxcm > 20 ? { level: 'red', reason: 'Depth ' + out.depth + ' (>20 cm – unsafe for small cars)' } : { level: 'yellow', reason: 'Depth ' + out.depth + ' (≤20 cm)' });
    if (/เข่า|เอว|หน้าอก|หน้าแข้ง|หน้าขา|ต้นขา|ถึงก้น|knee|waist|thigh/i.test(t)) return Object.assign(out, { level: 'red', reason: 'Described as shin/knee-deep or more' });
    if (/ข้อเท้า|ตาตุ่ม|ankle/i.test(t)) return Object.assign(out, { level: 'yellow', reason: 'Described as ankle-deep' });
    return out;
  }
  function roadIcon(level, hollow) {
    const c = C[level];
    return L.divIcon({ className: '', iconSize: [22, 12], iconAnchor: [11, 6], popupAnchor: [0, -6],
      html: hollow ? `<div style="width:10px;height:10px;margin:1px 6px;border-radius:50%;border:2.5px solid ${c};background:rgba(255,255,255,.9);box-shadow:0 0 0 1px rgba(255,255,255,.8)"></div>`
                   : `<div class="roadicon" style="width:22px;height:12px;background:${c}"></div>` });
  }

  // ---------- state ----------
  const S = { events: null, traffy: null, rain: null, wl: null, cams: null };

  // ---------- road events (Longdo / iTIC) ----------
  async function loadEvents() {
    setFeed('events', 'loading');
    try {
      const d = await getJSON(URLS.events, 45000);
      if (!Array.isArray(d)) throw new Error('unexpected response');
      const now = Date.now(); let latest = null;
      const list = d.filter((e) => (e.type === '6' || e.icon === 'flood')).map((e) => {
        const la = num(e.latitude), lo = num(e.longitude); const start = bkkDate(e.start), stop = bkkDate(e.stop);
        return { e, la, lo, start, stop, c: classify([e.title, e.description].join(' ')) };
      }).filter((x) => x.la && x.lo && inBox(x.la, x.lo) && (!x.stop || x.stop.getTime() >= now) && (!x.start || x.start.getTime() <= now + 36e5));
      list.forEach((x) => { if (x.start && (!latest || x.start > latest)) latest = x.start; });
      S.events = list; setFeed('events', 'ok', list.length + ' active flood reports in view area', latest);
    } catch (err) { S.events = null; setFeed('events', 'fail', err.message); }
    drawRoads(); drawCamsNear();
  }
  function drawRoads() {
    layers.roads.clearLayers();
    if (!S.events) { $('kRed').textContent = $('kYellow').textContent = $('kGreen').textContent = '–'; $('roadList').innerHTML = '<div class="muted">Road report feed unavailable – no road status shown.</div>'; updateRoadNote(); return; }
    const cnt = { red: 0, yellow: 0, green: 0 };
    const order = { red: 0, yellow: 1, green: 2 };
    S.events.sort((a, b) => order[a.c.level] - order[b.c.level] || (b.start || 0) - (a.start || 0));
    S.events.forEach((x) => {
      cnt[x.c.level]++;
      const e = x.e;
      const src = /สำนักการระบายน้ำ|Drainage and Sewerage/i.test(e.description + e.description_en) ? 'BMA Drainage & Sewerage Dept. via iTIC' : e.contributor === 'DOH Admin' ? 'Department of Highways (DOH) via iTIC' : 'iTIC / Longdo Traffic user report';
      const html = `<div class="pp"><span class="tag" style="background:${C[x.c.level]}">${x.c.level.toUpperCase()}</span>
        <h3 style="margin-top:6px">${esc(e.title)}</h3>
        <div>${esc(e.description).replace(/\n/g, '<br>').slice(0, 600)}</div>
        <div class="m" style="margin-top:6px">${esc(x.c.reason)}<br>Reported ${fmtRep(x.start)} · until ${fmtDT(x.stop)}<br>Source: ${esc(src)}</div></div>`;
      x.marker = L.marker([x.la, x.lo], { icon: roadIcon(x.c.level, false), pane: 'roadsPane', zIndexOffset: x.c.level === 'red' ? 1000 : 500 }).bindPopup(html, { maxWidth: 320 }).addTo(layers.roads);
    });
    $('kRed').textContent = cnt.red; $('kYellow').textContent = cnt.yellow; $('kGreen').textContent = cnt.green;
    $('roadList').innerHTML = S.events.length ? S.events.slice(0, 12).map((x, i) => `<div class="row" data-i="${i}"><span class="b" style="background:${C[x.c.level]}"></span><div class="t"><div>${esc(x.e.title.replace(/^น้ำท่วม\s*/, ''))}</div><div class="s">${esc(x.c.reason)} · ${fmtRep(x.start)}</div></div></div>`).join('') + (S.events.length > 12 ? `<div class="muted small">+${S.events.length - 12} more on the map</div>` : '') : '<div class="muted">No active agency / iTIC flood reports in the Bangkok area.</div>';
    $('roadList').querySelectorAll('.row').forEach((r) => r.onclick = () => { const x = S.events[+r.dataset.i]; map.setView([x.la, x.lo], 15); x.marker.openPopup(); collapsePanel(); });
    updateRoadNote();
  }
  function updateRoadNote() {
    let s = 'Counts = agency / iTIC reports (DOH, BMA Drainage Dept., iTIC users). ';
    if (S.traffy) { const t = { red: 0, yellow: 0 }; S.traffy.forEach((x) => { if (t[x.c.level] != null) t[x.c.level]++; }); s += `Plus citizen reports last ${TRAFFY_WINDOW_H} h (Traffy, unverified): ${t.red} red · ${t.yellow} yellow. `; }
    s += 'Roads without a report are not coloured – no report ≠ confirmed dry.';
    $('roadNote').textContent = s;
  }

  // ---------- Traffy citizen reports ----------
  const FLOOD_RE = /ท่วม|น้ำขัง|นำ้ท่วม|น้ำรอระบาย|รอการระบาย|flood/i;
  async function loadTraffy() {
    setFeed('traffy', 'loading');
    try {
      const d = await getJSON(URLS.traffy, 60000);
      if (!d || !Array.isArray(d.results)) throw new Error('unexpected response');
      const cutoff = Date.now() - TRAFFY_WINDOW_H * 36e5; let latest = null;
      const list = d.results.map((r) => ({ r, t: utcDate(r.timestamp), lo: num(r.coords && r.coords[0]), la: num(r.coords && r.coords[1]) }))
        .filter((x) => x.la && x.lo && x.t && x.t.getTime() >= cutoff && inBox(x.la, x.lo) && r_isFlood(x.r) && x.r.state !== 'เสร็จสิ้น')
        .map((x) => Object.assign(x, { c: classify(x.r.description) }))
        .filter((x) => x.c.level !== 'green');
      list.forEach((x) => { if (!latest || x.t > latest) latest = x.t; });
      const oldest = d.results.length ? utcDate(d.results[d.results.length - 1].timestamp) : null;
      S.traffy = list;
      setFeed('traffy', 'ok', list.length + ` flood-related open reports in last ${TRAFFY_WINDOW_H} h` + (oldest && oldest.getTime() > cutoff ? ` (feed window only reaches back to ${fmtT(oldest)})` : ''), latest);
    } catch (err) { S.traffy = null; setFeed('traffy', 'fail', err.message); }
    drawTraffy(); updateRoadNote();
  }
  function r_isFlood(r) { return FLOOD_RE.test(r.description || '') || /น้ำท่วม/.test(r.type || ''); }
  function drawTraffy() {
    layers.traffy.clearLayers(); if (!S.traffy) return;
    S.traffy.forEach((x) => {
      const r = x.r;
      const html = `<div class="pp"><span class="tag" style="background:${C[x.c.level]}">${x.c.level.toUpperCase()}</span> <span class="m">Citizen report · unverified</span>
        <div style="margin-top:6px">${esc((r.description || '').slice(0, 320))}${(r.description || '').length > 320 ? '…' : ''}</div>
        ${r.photo_url ? `<img class="ph" loading="lazy" src="${esc(r.photo_url)}" alt="report photo" referrerpolicy="no-referrer">` : ''}
        <div class="m" style="margin-top:6px">${esc(x.c.reason)}<br>${esc(r.address || '')}<br>Reported ${fmtDT(x.t)} (${ago(x.t)}) · status: ${esc(r.state || '')}<br>
        <a href="https://share.traffy.in.th/teamchadchart/${encodeURIComponent(r.ticket_id)}" target="_blank" rel="noopener">Traffy Fondue ticket ${esc(r.ticket_id)}</a></div></div>`;
      L.marker([x.la, x.lo], { icon: roadIcon(x.c.level, true), zIndexOffset: x.c.level === 'red' ? 200 : 0 }).bindPopup(html, { maxWidth: 300 }).addTo(layers.traffy);
    });
  }

  // ---------- ThaiWater rainfall ----------
  async function loadRain() {
    setFeed('rain', 'loading');
    try {
      const d = await getJSON(URLS.rain, 120000);
      if (!d || !Array.isArray(d.data)) throw new Error('unexpected response');
      const cutoff = Date.now() - 30 * 36e5; let latest = null;
      const list = d.data.filter((x) => x.geocode && PROVINCES[x.geocode.province_code]).map((x) => ({ x, t: bkkDate(x.rainfall_datetime), la: num(x.station && x.station.tele_station_lat), lo: num(x.station && x.station.tele_station_long), r24: num(x.rain_24h), r1: num(x.rain_1h) }))
        .filter((s) => s.la && s.lo && s.t && s.t.getTime() >= cutoff && s.r24 != null);
      list.forEach((s) => { if (!latest || s.t > latest) latest = s.t; });
      S.rain = list; setFeed('rain', 'ok', list.length + ' stations in BKK + 3 provinces', latest);
    } catch (err) { S.rain = null; setFeed('rain', 'fail', err.message); }
    drawRain();
  }
  function drawRain() {
    layers.rain.clearLayers();
    if (!S.rain) { $('rainTop').innerHTML = '<div class="muted">Rainfall feed unavailable.</div>'; return; }
    const key = rainKey === '24' ? 'r24' : 'r1', sc = rainKey === '24' ? RAIN24 : RAIN1;
    S.rain.forEach((s) => {
      const v = s[key]; const p = v == null ? null : pick(sc, v);
      const html = `<div class="pp"><div class="m">Rainfall station · ${esc(s.x.agency && s.x.agency.agency_shortname ? s.x.agency.agency_shortname.en : '')}</div><h3>${esc(nm(s.x.station.tele_station_name))}</h3>
        <div><span class="big">${s.r24 != null ? s.r24 : '–'}</span> mm / 24 h &nbsp; <b>${s.r1 != null ? s.r1 : '–'}</b> mm / 1 h</div>
        <div class="m">${esc(nm(s.x.geocode.amphoe_name))}, ${esc(PROVINCES[s.x.geocode.province_code])}<br>Reading ${fmtDT(s.t)} (${ago(s.t)})</div></div>`;
      s.marker = L.circleMarker([s.la, s.lo], { renderer: canvas, radius: v != null && v > (rainKey === '24' ? 90 : 20) ? 8 : 6, color: '#fff', weight: 1.5, fillColor: p ? p[1] : '#d5dae1', fillOpacity: p ? 0.95 : 0.6 }).bindPopup(html).addTo(layers.rain);
    });
    const top = S.rain.filter((s) => s[key] != null).sort((a, b) => b[key] - a[key]).slice(0, 8);
    $('rainTop').innerHTML = top.length ? top.map((s, i) => `<div class="row" data-i="${S.rain.indexOf(s)}"><span class="b" style="background:${pick(sc, s[key])[1]}"></span><div class="t"><div>${esc(nm(s.x.station.tele_station_name))}</div><div class="s">${esc(PROVINCES[s.x.geocode.province_code])} · ${fmtDT(s.t)}</div></div><span class="n">${s[key]} mm</span></div>`).join('') : `<div class="muted">No ${rainKey} h readings.</div>`;
    $('rainTop').querySelectorAll('.row').forEach((r) => r.onclick = () => { const s = S.rain[+r.dataset.i]; map.setView([s.la, s.lo], 14); s.marker.openPopup(); collapsePanel(); });
  }

  // ---------- ThaiWater water levels ----------
  const CPY = [
    ['C.13', 'Chao Phraya Dam (downstream), Chai Nat – release'],
    ['C.35', 'Ban Pom, Ayutthaya'],
    ['CPY014', 'Nuanchawee Bridge, Nonthaburi'],
    ['C.12', 'RID Sam Sen, Bangkok'],
    ['CPY015', 'Krung Thep Bridge, Bangkok']
  ];
  async function loadWL() {
    setFeed('wl', 'loading');
    try {
      const d = await getJSON(URLS.wl, 120000);
      const arr = d && d.waterlevel_data && d.waterlevel_data.data; if (!Array.isArray(arr)) throw new Error('unexpected response');
      const all = arr.map((x) => ({ x, code: x.station && x.station.tele_station_oldcode, t: bkkDate(x.waterlevel_datetime), la: num(x.station && x.station.tele_station_lat), lo: num(x.station && x.station.tele_station_long), pct: num(x.storage_percent), msl: num(x.waterlevel_msl), prev: num(x.waterlevel_msl_previous), bank: num(x.station && x.station.min_bank), q: num(x.discharge) }));
      const local = all.filter((s) => s.x.geocode && PROVINCES[s.x.geocode.province_code] && s.la && s.lo && s.t);
      let latest = null; local.forEach((s) => { if (!latest || s.t > latest) latest = s.t; });
      S.wl = local; S.cpy = CPY.map(([code, label]) => ({ label, s: all.find((s) => s.code === code) }));
      setFeed('wl', 'ok', local.length + ' stations in BKK + 3 provinces', latest);
    } catch (err) { S.wl = null; S.cpy = null; setFeed('wl', 'fail', err.message); }
    drawWL();
  }
  const stale = (s) => !s.t || Date.now() - s.t > 6 * 36e5;
  function trend(s) { if (s.msl == null || s.prev == null) return ''; const d = s.msl - s.prev; return Math.abs(d) < 0.005 ? '→ steady' : d > 0 ? `↑ +${d.toFixed(2)} m` : `↓ ${d.toFixed(2)} m`; }
  function wlPopup(s, title) {
    const p = s.pct != null ? pick(WLS, s.pct) : null;
    return `<div class="pp"><div class="m">Water level station · ${esc(s.x.agency && s.x.agency.agency_shortname ? s.x.agency.agency_shortname.en : '')} · ${esc(s.code || '')}</div><h3>${esc(title || nm(s.x.station.tele_station_name))}</h3>
      ${p ? `<span class="tag" style="background:${stale(s) ? '#8aa0b8' : p[1]}">${s.pct.toFixed(0)}% of bank-full</span>` : ''}
      <div style="margin-top:4px"><span class="big">${s.msl != null ? s.msl.toFixed(2) : '–'}</span> m MSL ${trend(s) ? '<span class="m">' + trend(s) + ' vs prev.</span>' : ''}</div>
      <div class="m">Bank (lowest) ${s.bank != null ? s.bank.toFixed(2) + ' m MSL' : '–'}${s.x.diff_wl_bank ? ' · ' + esc(s.x.diff_wl_bank_text || 'diff') + ' ' + esc(s.x.diff_wl_bank) + ' m' : ''}${s.q != null ? '<br>Discharge ' + s.q.toLocaleString() + ' m³/s' : ''}<br>
      ${esc(nm(s.x.geocode.amphoe_name))}, ${esc(s.x.geocode.province_name ? s.x.geocode.province_name.en : '')}<br>Reading ${fmtDT(s.t)} (${ago(s.t)})${stale(s) ? ' – <b>stale</b>' : ''}</div></div>`;
  }
  function drawWL() {
    layers.wl.clearLayers();
    if (!S.wl) { $('wlTop').innerHTML = $('cpy').innerHTML = '<div class="muted">Water level feed unavailable.</div>'; return; }
    S.wl.forEach((s) => {
      const p = s.pct != null ? pick(WLS, s.pct) : null; const st = stale(s);
      const icon = L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: `<div style="width:14px;height:14px;transform:rotate(45deg);border-radius:3px;border:2px solid ${st ? '#8aa0b8' : '#fff'};background:${st ? '#fff' : (p ? p[1] : '#b8c2cf')};box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>` });
      s.marker = L.marker([s.la, s.lo], { icon }).bindPopup(wlPopup(s)).addTo(layers.wl);
    });
    const hi = S.wl.filter((s) => !stale(s) && s.pct != null && s.pct >= 90).sort((a, b) => b.pct - a.pct);
    $('wlTop').innerHTML = hi.length ? hi.map((s) => `<div class="row" data-i="${S.wl.indexOf(s)}"><span class="b" style="background:${pick(WLS, s.pct)[1]}"></span><div class="t"><div>${esc(nm(s.x.station.tele_station_name))}</div><div class="s">${esc(s.x.geocode.province_name.en)} · ${trend(s)} · ${fmtDT(s.t)}</div></div><span class="n">${s.pct.toFixed(0)}%</span></div>`).join('') : '<div class="muted">No station with a fresh reading (&lt;6 h) at ≥90% of bank-full.</div>';
    $('wlTop').querySelectorAll('.row').forEach((r) => r.onclick = () => { const s = S.wl[+r.dataset.i]; map.setView([s.la, s.lo], 14); s.marker.openPopup(); collapsePanel(); });
    $('cpy').innerHTML = S.cpy.map((c, i) => {
      const s = c.s; if (!s) return `<div class="row"><span class="b" style="background:#d5dae1"></span><div class="t"><div>${esc(c.label)}</div><div class="s">No reading in feed</div></div></div>`;
      const p = s.pct != null ? pick(WLS, s.pct) : null;
      const right = s.q != null && c.label.includes('release') ? s.q.toLocaleString() + ' m³/s' : (s.pct != null ? s.pct.toFixed(0) + '%' : '–');
      return `<div class="row" data-i="${i}"><span class="b" style="background:${stale(s) ? '#8aa0b8' : (p ? p[1] : '#d5dae1')}"></span><div class="t"><div>${esc(c.label)}</div><div class="s">${s.msl != null ? s.msl.toFixed(2) + ' m MSL' : ''}${s.bank != null ? ' / bank ' + s.bank.toFixed(2) : ''}${s.pct != null ? ' · ' + s.pct.toFixed(0) + '% bank' : ''}${s.q != null ? ' · ' + s.q.toLocaleString() + ' m³/s' : ''} · ${fmtDT(s.t)}${stale(s) ? ' (stale)' : ''}</div></div><span class="n">${right}</span></div>`;
    }).join('') + '<div class="muted small">Lower Chao Phraya levels in Bangkok are tide-affected; % = share of bank-full height (ThaiWater).</div>';
    $('cpy').querySelectorAll('.row[data-i]').forEach((r) => r.onclick = () => { const s = S.cpy[+r.dataset.i].s; if (!s || !s.la) return; map.setView([s.la, s.lo], 13); L.popup().setLatLng([s.la, s.lo]).setContent(wlPopup(s, S.cpy[+r.dataset.i].label)).openOn(map); collapsePanel(); });
  }

  // ---------- cameras ----------
  // Only iTIC's camerai1 HTTPS relay was verified to play in browsers on this page (CORS *, valid live HLS).
  // Each camera is re-checked in the visitor's browser (playlist + live segment + freshness) before it is shown,
  // and a camera whose stream fails when opened is removed from the map.
  const CAM_HOSTS = ['camerai1.iticfoundation.org'];
  let activeHls = null;
  async function probeCam(url) {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 12000);
    try {
      const rd = async (u) => { const r = await fetch(u, { signal: ctl.signal, cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); };
      let u = url, txt = await rd(u); if (!/^#EXTM3U/.test(txt.trim())) return false;
      let segs = txt.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l[0] !== '#');
      if (segs.length && /\.m3u8(\?|$)/.test(segs[0])) { u = new URL(segs[0], u).href; txt = await rd(u); segs = txt.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l[0] !== '#'); }
      if (!segs.length) return false;
      const r = await fetch(new URL(segs[segs.length - 1], u).href, { signal: ctl.signal, cache: 'no-store' }); if (!r.ok || !r.body) return false;
      const lm = r.headers.get('Last-Modified');
      const reader = r.body.getReader(); const { value } = await reader.read(); reader.cancel().catch(() => {});
      if (!value || value[0] !== 0x47) return false; // MPEG-TS sync byte
      if (lm && Date.now() - new Date(lm) > 10 * 60 * 1000) return false; // stream stuck (segment older than 10 min)
      return true;
    } catch (e) { return false; } finally { clearTimeout(tm); }
  }
  async function loadCams() {
    setFeed('cams', 'loading');
    try {
      const d = await getJSON(URLS.cams, 45000); if (!Array.isArray(d)) throw new Error('unexpected response');
      const cand = d.map((c) => ({ c, la: num(c.latitude), lo: num(c.longitude) })).filter((x) => x.la && x.lo && inBox(x.la, x.lo) && /^https:\/\//.test(x.c.hls_url || '') && CAM_HOSTS.includes(new URL(x.c.hls_url).host));
      const ok = await Promise.all(cand.map((x) => probeCam(x.c.hls_url)));
      const list = cand.filter((x, i) => ok[i]);
      if (!list.length) throw new Error('no camera stream responded');
      S.cams = list; setFeed('cams', 'ok', list.length + ' live streams verified in your browser (offline cameras hidden)', new Date());
    } catch (err) { S.cams = null; setFeed('cams', 'fail', err.message); }
    drawCams(); drawCamsNear();
  }
  const camIcon = L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -8], html: '<div class="camicon" style="width:18px;height:18px">▶</div>' });
  function camHtml(x) {
    const c = x.c;
    return `<div class="pp" style="width:300px;max-width:100%"><div class="m">${esc(c.organization || '')} camera · ${esc(c.camid)}</div><h3>${esc(c.title)}</h3>
      <video muted autoplay playsinline controls></video>
      <div class="m camstatus">Connecting to live stream…</div>
      <div class="m">Live video from ${esc(c.sponsertext || c.organization || 'iTIC')} via iTIC Foundation / Longdo.</div></div>`;
  }
  function stopHls() { if (activeHls) { try { activeHls.destroy(); } catch (e) {} activeHls = null; } }
  function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; $('mapwrap').appendChild(t); setTimeout(() => t.remove(), 4000); }
  function dropCam(x) { // stream failed in this browser: hide the camera instead of showing an error
    stopHls(); if (x.marker) { x.marker.closePopup(); layers.cams.removeLayer(x.marker); }
    if (S.cams) { S.cams = S.cams.filter((y) => y !== x); setFeed('cams', 'ok', S.cams.length + ' live streams verified in your browser (offline cameras hidden)', new Date()); }
    drawCamsNear(); toast('That camera stopped streaming and was hidden.');
  }
  function startStream(el, x) {
    stopHls();
    const v = el.querySelector('video'), st = el.querySelector('.camstatus'), url = x.c.hls_url;
    let playing = false; const ok = () => { playing = true; st.textContent = 'LIVE · streaming'; };
    const guard = setTimeout(() => { if (!playing && el.isConnected) dropCam(x); }, 20000);
    if (window.Hls && Hls.isSupported()) {
      const h = new Hls({ lowLatencyMode: true, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 1, fragLoadingMaxRetry: 1 }); activeHls = h;
      h.on(Hls.Events.ERROR, (e, data) => { if (data.fatal) { clearTimeout(guard); dropCam(x); } });
      h.on(Hls.Events.FRAG_BUFFERED, ok);
      h.loadSource(url); h.attachMedia(v); v.play().catch(() => {});
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = url; v.addEventListener('playing', ok, { once: true }); v.addEventListener('error', () => { clearTimeout(guard); dropCam(x); }, { once: true }); v.play().catch(() => {});
    } else { clearTimeout(guard); st.textContent = 'This browser cannot play live video.'; }
  }
  function drawCams() {
    layers.cams.clearLayers(); if (!S.cams) return;
    S.cams.forEach((x) => {
      x.marker = L.marker([x.la, x.lo], { icon: camIcon, zIndexOffset: -100 }).bindPopup(() => camHtml(x), { maxWidth: 320, minWidth: 260 }).addTo(layers.cams);
      x.marker.on('popupopen', (e) => startStream(e.popup.getElement(), x));
      x.marker.on('popupclose', stopHls);
    });
  }
  function drawCamsNear() {
    const el = $('camNear');
    if (!S.cams) { el.innerHTML = '<div class="muted">No verified live camera stream right now.</div>'; return; }
    if (!S.events) { el.innerHTML = '<div class="muted">Waiting for road report feed…</div>'; return; }
    const pairs = []; const seen = new Set();
    S.events.filter((x) => x.c.level !== 'green').forEach((ev) => {
      let best = null; S.cams.forEach((cm) => { const d = dist(ev.la, ev.lo, cm.la, cm.lo); if (d <= 2 && (!best || d < best.d)) best = { cm, d }; });
      if (best && !seen.has(best.cm.c.camid)) { seen.add(best.cm.c.camid); pairs.push({ ev, cm: best.cm, d: best.d }); }
    });
    pairs.sort((a, b) => (a.ev.c.level === 'red' ? 0 : 1) - (b.ev.c.level === 'red' ? 0 : 1) || a.d - b.d);
    el.innerHTML = pairs.length ? pairs.slice(0, 8).map((p, i) => `<div class="row" data-i="${i}"><span class="cam" style="display:inline-flex;width:18px;height:18px;border-radius:5px;background:#1d2330;color:#fff;font-size:9px;align-items:center;justify-content:center">▶</span><div class="t"><div>${esc(p.cm.c.title.replace(/^\([^)]*\)\s*/, ''))}</div><div class="s"><span style="color:${C[p.ev.c.level]}">●</span> ${(p.d * 1000).toFixed(0)} m from: ${esc(p.ev.e.title.replace(/^น้ำท่วม\s*/, ''))}</div></div></div>`).join('') : '<div class="muted">No public camera within 2 km of a current red/yellow agency report.</div>';
    el.querySelectorAll('.row').forEach((r) => r.onclick = () => { const p = pairs[+r.dataset.i]; map.setView([p.cm.la, p.cm.lo], 15); p.cm.marker.openPopup(); collapsePanel(); });
  }

  // ---------- radar ----------
  let radarFrames = [], radarIdx = 0, radarTimer = null, radarLayers = {};
  async function loadRadar() {
    setFeed('radar', 'loading');
    try {
      const d = await getJSON(URLS.radar, 30000);
      const past = d && d.radar && d.radar.past; if (!Array.isArray(past) || !past.length) throw new Error('no frames');
      radarFrames = past.slice(-7).map((f) => ({ time: new Date(f.time * 1000), url: d.host + f.path + '/256/{z}/{x}/{y}/2/1_1.png' }));
      const last = radarFrames[radarFrames.length - 1];
      if (Date.now() - last.time > 2 * 36e5) throw new Error('latest frame too old (' + fmtDT(last.time) + ')');
      stopRadar(); layers.radar.clearLayers(); radarLayers = {};
      radarIdx = radarFrames.length - 1; showRadar(radarIdx);
      $('radarCtl').classList.remove('hidden');
      setFeed('radar', 'ok', '', last.time);
    } catch (err) { stopRadar(); layers.radar.clearLayers(); radarLayers = {}; $('radarCtl').classList.add('hidden'); setFeed('radar', 'fail', err.message); }
  }
  function radarLayer(i) {
    const f = radarFrames[i]; if (!radarLayers[f.url]) radarLayers[f.url] = L.tileLayer(f.url, { opacity: 0, maxNativeZoom: 7, maxZoom: 19, zIndex: 300, attribution: 'Radar © <a href="https://www.rainviewer.com">RainViewer</a>' });
    const l = radarLayers[f.url]; if (!layers.radar.hasLayer(l)) layers.radar.addLayer(l); return l;
  }
  function showRadar(i) {
    const l = radarLayer(i);
    Object.values(radarLayers).forEach((x) => { if (x !== l) x.setOpacity(0); }); l.setOpacity(0.42);
    if (radarFrames[i + 1]) radarLayer(i + 1); // preload next
    $('radarTime').textContent = 'Radar ' + fmtT(radarFrames[i].time) + (i === radarFrames.length - 1 ? ' · latest' : '');
  }
  function stopRadar() { if (radarTimer) { clearInterval(radarTimer); radarTimer = null; } $('radarPlay').textContent = '▶'; }
  $('radarPlay').onclick = () => {
    if (radarTimer) { stopRadar(); radarIdx = radarFrames.length - 1; showRadar(radarIdx); return; }
    $('radarPlay').textContent = '❚❚'; radarIdx = 0; showRadar(0);
    radarTimer = setInterval(() => { radarIdx = (radarIdx + 1) % radarFrames.length; showRadar(radarIdx); }, 800);
  };

  // ---------- UI ----------
  $('rainTabs').querySelectorAll('button').forEach((b) => b.onclick = () => { $('rainTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); rainKey = b.dataset.k; renderScales(); drawRain(); });
  $('grab').onclick = () => $('panel').classList.toggle('collapsed-mobile');
  function collapsePanel() { if (isMobile) $('panel').classList.add('collapsed-mobile'); }
  let lastFast = 0, lastSlow = 0;
  function stamp() { $('updated').innerHTML = `Page data refreshed <b>${fmtT(new Date(Math.max(lastFast, lastSlow) || Date.now()))}</b> Bangkok time (UTC+7) · auto-refresh every 5–10 min`; }
  function refreshFast() { lastFast = Date.now(); Promise.allSettled([loadRadar(), loadEvents(), loadTraffy(), S.cams ? Promise.resolve() : loadCams()]).then(stamp); }
  function refreshSlow() { lastSlow = Date.now(); Promise.allSettled([loadRain(), loadWL()]).then(stamp); }
  renderScales(); renderFeeds();
  refreshFast(); refreshSlow();
  setInterval(refreshFast, FAST_MS); setInterval(refreshSlow, SLOW_MS);
  setInterval(() => { if (S.cams) loadCams(); }, 60 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (Date.now() - lastFast > FAST_MS) refreshFast(); if (Date.now() - lastSlow > SLOW_MS) refreshSlow(); } });
})();
