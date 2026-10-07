# Flood Center web v2

React (Create React App) dashboard for **floodcenter-backend-v2**. Same map + modal chart as v1, with history from daily rollups, Metric/US units, custom ranges, an alert banner, and a canal-height forecast line.

**Do not point this app at `floodcenter-backend` (production).** `src/firebase.js` reads the Firebase web config from `REACT_APP_*` env vars and refuses to start if the project id is `floodcenter-backend`. Hosting deploys to the default site of the v2 project (`https://floodcenter-backend-v2.web.app`).

## What changed vs v1

| Area | v1 | v2 |
| --- | --- | --- |
| Water level history | Paginated `sensorData_7` | `waterLevel_daily` (5‑min maxes) |
| Current level / last update | Last raw uplink | `waterLevel_latest` (map updates live) |
| Rain | Client-side OpenWeather calls | `rainfall_data` written by the backend |
| Alerts | Threshold lines only | `alerts/{deviceId}` yellow/red banner (rain rule) |
| Forecast | None | Dashed 6 h line from `canal_forecasts` on Day and short custom views |
| Views | 2 Weeks first | Day → Week → 2 Weeks → Month → Year → Custom |
| Units | ft markers, mm chart | Metric (m / mm) or US (ft / in), remembered per browser |
| Firebase config | Hard-coded prod | `REACT_APP_*` env → v2 project |

## Setup

```powershell
cd C:\Users\kapur\OneDrive\Documents\floodcenter-web-v2
copy .env.example .env.local
# Fill in the Firebase web config for floodcenter-backend-v2 and the Maps key
npm install
npm start
```

| Variable | Notes |
| --- | --- |
| `REACT_APP_FIREBASE_*` | Web app config from the v2 Firebase console. |
| `REACT_APP_GOOGLE_MAPS_API_KEY` | Maps JavaScript API key. |
| `REACT_APP_GOOGLE_MAPS_ID` | Vector map ID (advanced markers need one). Blank uses `DEMO_MAP_ID`. |
| `REACT_APP_DEFAULT_MAP_LAT` / `_LNG` | Initial map center. |
| `REACT_APP_REQUIRE_LOGIN` | `true` shows the Google sign-in page before the map. Default `false` (public, like v1). |
| `REACT_APP_DEBUG_MODE` | `true` logs query details to the console. |

## Tests

```powershell
npm test -- --watchAll=false
```

Covers unit conversion and the chart data transforms (`src/units.test.js`, `src/waterLevelQuery.test.js`).

## Deploy hosting

```powershell
firebase use floodcenter-backend-v2
npm run build
firebase deploy --only hosting --project floodcenter-backend-v2
```

CI (`.github/workflows/deploy-hosting.yml`) runs tests, builds and deploys hosting on pushes to `main`. It needs:

- secrets: `FIREBASE_TOKEN`, `REACT_APP_FIREBASE_API_KEY`, `REACT_APP_GOOGLE_MAPS_API_KEY`
- variables: `REACT_APP_FIREBASE_MESSAGING_SENDER_ID`, `REACT_APP_FIREBASE_APP_ID`
- optional variables: `FIREBASE_PROJECT_ID` (default `floodcenter-backend-v2`), `REACT_APP_FIREBASE_MEASUREMENT_ID`, `REACT_APP_GOOGLE_MAPS_ID`, `REACT_APP_DEFAULT_MAP_LAT`, `REACT_APP_DEFAULT_MAP_LNG`, `REACT_APP_REQUIRE_LOGIN`

## Code layout

| File | Role |
| --- | --- |
| `src/App.js` | Loads `sensor_locations`, holds the unit choice, optional login gate. |
| `src/SensorMap.js` | Google map; markers coloured by `waterLevel_latest` vs yellow/red heights. Grey = no reading in 6 h. |
| `src/SensorDashboard.js` | Modal: alert banner, stats, view/unit controls, Chart.js chart with zoom. |
| `src/sensorData.js` | All Firestore reads. |
| `src/waterLevelQuery.js` | View ranges and pure transforms (bucketing, rain de-duplication, forecast). |
| `src/units.js` | mm → m/ft and mm → mm/in. All state stays in mm. |

## Data the dashboard reads

- `sensor_locations/{deviceId}` — position and `yellow_height` / `red_height` (mm) threshold lines.
- `waterLevel_daily` — chart history. One doc per device per UTC day; `maxMm` holds the highest level per 5‑minute bucket. The chart thins these to 15 min (Day), 30 min (Week), 1 h (2 Weeks), 3 h (Month) or 1 day (Year), always keeping the bucket maximum. Gaps over 3 buckets break the line.
- `waterLevel_latest/{deviceId}` — `levelMm` and `at` for Current Level, Last Update and the map markers.
- `rainfall_data` — rain bars. `timestamp` is the **end** of the accumulation window (`accumulationMinutes`, 60 observed or 180 forecast), so each amount is spread evenly over its window before bucketing. Rows fetched after their window closed are observed rain ("Rainfall"); rows fetched before are forecasts ("Rain forecast", lighter bars, only after now). Each 3‑hour forecast issue writes its own copy of a slot, so only the newest issue is drawn, and only if it is under 3.5 h old. "Rainfall (visible)" sums observed rain only. The Year view hides the bars, as in the mockup.
- `alerts/{deviceId}` — yellow/red banner with the scorer's reason text (rain amounts converted to the selected unit). Hidden when `level` is `none`.
- `canal_forecasts/{deviceId}` — dashed forecast line for the next 6 h on Day view and custom ranges that end today and span under 2 days. Hidden if `issuedAt` is over 2 h old.

The chart refreshes every 5 minutes while open. Ctrl + drag or Ctrl + scroll zooms, Shift + drag pans, Reset Zoom restores the view.

Backend sync and scorers live in `floodcenter_backend_v2`.
