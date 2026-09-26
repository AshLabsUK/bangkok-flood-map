# Bangkok Flood Monitor (unofficial)

Live, static, client-side flood monitoring map for Bangkok and surrounding provinces (Nonthaburi, Pathum Thani, Samut Prakan).

**Live page:** https://piyaster11.github.io/bangkok-flood-map/

All data is fetched live in the visitor's browser from public, no-login feeds (no server, no API keys, no cached/mock data):

| Layer | Source | Cadence |
|---|---|---|
| Rain radar (last ~1 h, animated) | [RainViewer public API](https://www.rainviewer.com/api.html) | ~10 min |
| Rainfall stations (1 h / 24 h) | [ThaiWater / HII](https://www.thaiwater.net) `rain_24h` (HII, RID, TMD, BMA… stations) | 10 min – daily |
| Water level stations, Chao Phraya key stations | ThaiWater `waterlevel_load` | 10 min – hourly |
| Flooded roads (red / yellow / green) | [Longdo Traffic / iTIC](https://traffic.longdo.com) event feed (DOH, BMA Drainage & Sewerage Dept. via iTIC, iTIC users) | real-time |
| Citizen flood reports (unverified) | [Traffy Fondue](https://fondue.traffy.in.th) public API (last 3 h) | real-time |
| Traffic cameras (live HLS video) | Longdo camera feed / iTIC Foundation (DOH & iTIC cameras) | live |

Road colours are derived only from the text of each report: **red** = “ผ่านไม่ได้”/not passable or depth > 20 cm (or knee/shin-deep), **yellow** = passable / ≤ 20 cm / depth not stated, **green** = source explicitly says water receded. Roads without a report are not coloured.

Not affiliated with any agency. Follow official warnings from BMA, TMD and DDPM. BMA hotline **1555**.
