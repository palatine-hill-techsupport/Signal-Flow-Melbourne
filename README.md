# Signal Flow Melbourne

Signal Flow Melbourne is a browser-native civic dashboard for exploring Victorian SCATS traffic signal volume data. It replaces the earlier local Streamlit dashboard with a static Vite, React, and TypeScript app that can be hosted on GitHub Pages without a Python server or backend runtime.

The dashboard keeps the original information architecture: sidebar filters, tabbed sections, overview metrics, site locations, data quality checks, traffic-pattern charts, site deep dives, and CSV exports.

## Data Sources

Primary source:

- Victorian Government DataVic Traffic Signal Volume Data: https://opendata.transport.vic.gov.au/dataset/traffic-signal-volume-data

Lookup and enrichment inputs:

- `data/victorian_traffic_signals.csv`, when available, is treated as the preferred official site lookup.
- `data/SCATSSiteListingSpreadsheet.xls`, when available and parseable, is used as an older fallback/cross-reference.
- Raw SCATS site IDs remain visible when no lookup match is available.

The generated static data currently covers the latest local 14 daily CSV files found during preprocessing. Re-run the data build with `--days`, `--from`, `--to`, or `--all` to change that window.

## What The App Includes

- Overview metrics for rows, sites, detectors, regions, traffic volume, alarms, and lookup match rate
- Date, region, site, detector, search, coordinate, and data-quality filters
- Site lookup enrichment with official lookup preference and spreadsheet fallback
- Match-rate and unmatched-site visibility
- Leaflet map where coordinates are available
- Data quality warnings for missing values, zero-volume rows, incomplete records, alarms, negative totals, negative interval values, and unusual daily totals using an IQR rule
- Daily volume, regional volume, average detector volume, top-site, weekday/weekend, and interval heatmap charts
- Lazy-loaded site and detector deep dives for generated top-volume site slices
- Browser CSV upload fallback for local `VSDATA_*.csv` files
- CSV exports for filtered summaries, daily totals, regions, site totals, lookup rows, and unmatched sites
- Light and dark themes with a calm transport dashboard palette

## Local Development

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Build the static site:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Data Refresh

Put raw daily CSV files in `data/` with names like:

```text
data/VSDATA_20260601.csv
data/VSDATA_20260602.csv
```

Generate app-ready static data:

```bash
npm run data:build
```

Useful options:

```bash
npm run data:build -- --days 30
npm run data:build -- --from 2026-06-01 --to 2026-06-12
npm run data:build -- --all
npm run data:build -- --days 30 --deep-sites 100
```

The preprocessing script writes compact dashboard files to `public/data/`, including:

- `manifest.json`
- overview metrics
- daily volume totals
- regional totals
- average detector volumes by region
- data quality summaries
- site lookup and enrichment table
- map-ready site coordinates and traffic metrics
- top sites by volume
- weekday/weekend comparison
- global 15-minute interval heatmap
- lazy deep-dive files under `public/data/deep-dive/`

Optional DataVic download:

```bash
npm run data:download
npm run data:build
```

The downloader uses the known DataVic ZIP URL from the original project. If DataVic changes the resource URL, pass a replacement:

```bash
npm run data:download -- --url "https://example.com/current-traffic-signal-volume-data.zip"
```

## Static Hosting And Fallback Strategy

GitHub Pages is static hosting, so the app does not fetch, parse, and analyse every raw CSV row on first page load. The normal flow is:

1. Build or refresh static summaries in `public/data/`.
2. Deploy the Vite build output from `dist/`.
3. Let the browser load compact generated summaries and lazy deep-dive slices.

If generated static files are unavailable, the app shows `No usable data source found` and allows local CSV upload in the browser. Uploaded CSVs are parsed client-side and treated as `Using local fallback data`.

The app also links to the DataVic dataset, but it does not depend only on live DataVic browser access because CORS, ZIP handling, file size, or network performance can make that fragile.

## GitHub Pages Deployment

The app is configured for the repository path:

```text
/Signal-Flow-Melbourne/
```

`vite.config.ts` sets:

```ts
base: "/Signal-Flow-Melbourne/"
```

The workflow in `.github/workflows/deploy.yml` installs dependencies, runs `npm run build`, and publishes the built `dist/` folder to the `gh-pages` branch.

To deploy:

1. Commit the app and generated `public/data/` files.
2. Push to `main` on `palatine-hill-techsupport/Signal-Flow-Melbourne`.
3. In GitHub Pages settings, choose `Deploy from a branch`.
4. Set the branch to `gh-pages` and the folder to `/root`.
5. The workflow updates `gh-pages` whenever `main` changes.

Do not point GitHub Pages at `main / root`. That serves the Vite source `index.html`, which is only for local development and will show a blank screen on Pages.

## Design Palette

The UI uses semantic colour rather than raw source-field colour:

- Traffic volume: transport blue
- Site, location, and enrichment: teal/green
- Missing, suspicious, or incomplete data: amber
- Alarms and invalid values: restrained red
- Dark mode: deep charcoal/navy surfaces
- Light mode: soft grey and white surfaces

Charts are themed for both light and dark modes.

## Limitations

Signal Flow Melbourne is an exploratory civic data dashboard, not an official traffic reporting tool. It preserves cautious interpretation: suspicious rows are flagged as reliability warnings, not automatically corrected.

Generated summaries are designed for static hosting and responsive exploration. Exact row-level detector analysis is available in uploaded local data and in generated lazy deep-dive slices; broader site-day summaries are intentionally compact so the app remains practical on GitHub Pages.
