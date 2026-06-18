import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Database,
  Download,
  FileUp,
  Filter,
  MapPin,
  Moon,
  RefreshCw,
  Search,
  Sun,
  Table2,
  UploadCloud,
} from "lucide-react";
import type {
  AppData,
  DailyVolume,
  DeepDiveRow,
  DeepDiveSite,
  Filters,
  HeatmapData,
  SiteDailySummary,
  SiteSummary,
  TabName,
  ThemeName,
} from "./types";
import { emptyManifest, emptyOverview, loadDeepDiveSite, loadGeneratedData } from "./data";
import { buildLocalDataFromFiles } from "./upload";
import {
  APP_NAME,
  DATASET_URL,
  TABS,
  aggregateOverview,
  applySiteDailyFilters,
  compactNumber,
  downloadCsv,
  formatNumber,
  formatPercent,
  groupByRegion,
  groupBySite,
  groupDaily,
  groupWeekdayWeekend,
  humanDate,
  intervalLabels,
  lookupSourceLabel,
  sourceLabel,
} from "./utils";

type RowRecord = Record<string, unknown>;
const ChartCore = lazy(() => import("./ChartCore"));
const SiteMap = lazy(() => import("./SiteMap"));

const defaultFilterState: Filters = {
  startDate: "",
  endDate: "",
  region: "All",
  siteId: "All",
  detector: "All",
  search: "",
  includeZeroVolume: true,
  includeIncomplete: true,
  includeAlarmRows: true,
  requireCoordinates: false,
};

function defaultFilters(data: AppData): Filters {
  return {
    ...defaultFilterState,
    startDate: data.manifest.dateRange.start,
    endDate: data.manifest.dateRange.end,
  };
}

function chartPalette(theme: ThemeName) {
  return {
    blue: "#2f80ed",
    teal: "#16a085",
    amber: "#d99016",
    red: "#c94f4f",
    purple: "#8b6dd8",
    cyan: "#25a9c7",
    text: theme === "dark" ? "#e6edf2" : "#18242d",
    muted: theme === "dark" ? "#9fb0bb" : "#64717a",
    grid: theme === "dark" ? "#253744" : "#d8e0e5",
    panel: theme === "dark" ? "#14232d" : "#ffffff",
  };
}

function baseChart(theme: ThemeName) {
  const palette = chartPalette(theme);
  return {
    color: [palette.blue, palette.teal, palette.amber, palette.red, palette.purple, palette.cyan],
    backgroundColor: "transparent",
    textStyle: { color: palette.text, fontFamily: "Inter, system-ui, sans-serif" },
    tooltip: {
      trigger: "axis",
      backgroundColor: palette.panel,
      borderColor: palette.grid,
      textStyle: { color: palette.text },
      valueFormatter: (value: number) => formatNumber(value),
    },
    grid: { left: 52, right: 24, top: 34, bottom: 52, containLabel: true },
    xAxis: {
      axisLine: { lineStyle: { color: palette.grid } },
      axisTick: { lineStyle: { color: palette.grid } },
      axisLabel: { color: palette.muted },
      splitLine: { lineStyle: { color: palette.grid } },
    },
    yAxis: {
      axisLine: { lineStyle: { color: palette.grid } },
      axisTick: { lineStyle: { color: palette.grid } },
      axisLabel: { color: palette.muted },
      splitLine: { lineStyle: { color: palette.grid } },
    },
  };
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="empty-state">
      <AlertTriangle size={20} />
      <span>{message}</span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const isGood = status === "generated" || status === "local-fallback" || status === "live";
  return (
    <div className={`status-pill ${isGood ? "status-good" : "status-warn"}`}>
      {isGood ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
      <span>{sourceLabel(status)}</span>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "neutral" | "blue" | "teal" | "amber" | "red";
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {detail ? <div className="metric-detail">{detail}</div> : null}
    </div>
  );
}

function ChartPanel({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        {caption ? <p>{caption}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Chart({ option, height = 360 }: { option: unknown; height?: number }) {
  return (
    <Suspense fallback={<div className="chart-loading" style={{ height }}>Loading chart</div>}>
      <ChartCore option={option} height={height} />
    </Suspense>
  );
}

function DataTable<T extends RowRecord>({
  rows,
  columns,
  pageSize = 25,
}: {
  rows: T[];
  columns: Array<{ key: string; label: string; render?: (row: T) => React.ReactNode }>;
  pageSize?: number;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(Math.ceil(rows.length / pageSize), 1);
  const safePage = Math.min(page, pageCount - 1);
  const visibleRows = rows.slice(safePage * pageSize, safePage * pageSize + pageSize);

  useEffect(() => {
    setPage(0);
  }, [rows.length, pageSize]);

  if (!rows.length) return <EmptyState message="No rows match the current filters." />;

  return (
    <div className="table-shell">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr key={`${safePage}-${rowIndex}`}>
                {columns.map((column) => (
                  <td key={column.key}>{column.render ? column.render(row) : String(row[column.key] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <span>
          {formatNumber(rows.length)} rows - page {safePage + 1} of {pageCount}
        </span>
        <div className="pagination-actions">
          <button className="icon-button" type="button" onClick={() => setPage(0)} disabled={safePage === 0}>
            First
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => setPage((value) => Math.max(value - 1, 0))}
            disabled={safePage === 0}
          >
            Prev
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => setPage((value) => Math.min(value + 1, pageCount - 1))}
            disabled={safePage >= pageCount - 1}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function dailyLineOption(daily: DailyVolume[], theme: ThemeName) {
  const palette = chartPalette(theme);
  return {
    ...baseChart(theme),
    tooltip: { ...baseChart(theme).tooltip, trigger: "axis" },
    xAxis: { ...baseChart(theme).xAxis, type: "category", data: daily.map((row) => row.date) },
    yAxis: { ...baseChart(theme).yAxis, type: "value", name: "Volume" },
    series: [
      {
        name: "Traffic volume",
        type: "line",
        smooth: true,
        symbolSize: 6,
        lineStyle: { width: 3, color: palette.blue },
        areaStyle: { opacity: 0.12, color: palette.blue },
        data: daily.map((row) => row.totalVolume),
      },
    ],
  };
}

function barOption<T>(
  rows: T[],
  labels: (row: T) => string,
  values: (row: T) => number,
  theme: ThemeName,
  color = chartPalette(theme).blue,
) {
  const chart = baseChart(theme);
  return {
    ...chart,
    tooltip: { ...chart.tooltip, trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { ...chart.xAxis, type: "value" },
    yAxis: {
      ...chart.yAxis,
      type: "category",
      data: rows.map(labels).reverse(),
      axisLabel: { ...chart.yAxis.axisLabel, width: 180, overflow: "truncate" },
    },
    series: [
      {
        name: "Total volume",
        type: "bar",
        data: rows.map(values).reverse(),
        itemStyle: { color, borderRadius: [0, 4, 4, 0] },
      },
    ],
  };
}

function qualityOption(daily: DailyVolume[], theme: ThemeName) {
  const chart = baseChart(theme);
  const palette = chartPalette(theme);
  return {
    ...chart,
    tooltip: { ...chart.tooltip, trigger: "axis" },
    legend: {
      top: 0,
      textStyle: { color: palette.muted },
    },
    grid: { left: 52, right: 24, top: 54, bottom: 52, containLabel: true },
    xAxis: { ...chart.xAxis, type: "category", data: daily.map((row) => row.date) },
    yAxis: { ...chart.yAxis, type: "value", name: "Rows" },
    series: [
      {
        name: "Zero volume",
        type: "bar",
        stack: "quality",
        data: daily.map((row) => row.zeroVolumeRows),
        itemStyle: { color: palette.amber },
      },
      {
        name: "Incomplete",
        type: "bar",
        stack: "quality",
        data: daily.map((row) => row.incompleteRows),
        itemStyle: { color: palette.teal },
      },
      {
        name: "Alarms",
        type: "bar",
        stack: "quality",
        data: daily.map((row) => row.alarmCount),
        itemStyle: { color: palette.red },
      },
      {
        name: "Negative values",
        type: "bar",
        stack: "quality",
        data: daily.map((row) => row.negativeTotalRows + row.negativeIntervalRows),
        itemStyle: { color: palette.purple },
      },
    ],
  };
}

function weekdayOption(rows: ReturnType<typeof groupWeekdayWeekend>, theme: ThemeName) {
  const chart = baseChart(theme);
  const palette = chartPalette(theme);
  return {
    ...chart,
    tooltip: { ...chart.tooltip, trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { ...chart.xAxis, type: "category", data: rows.map((row) => row.dayType) },
    yAxis: { ...chart.yAxis, type: "value", name: "Average volume" },
    series: [
      {
        name: "Average daily volume",
        type: "bar",
        data: rows.map((row) => row.averageDailyVolume),
        itemStyle: { color: palette.teal, borderRadius: [4, 4, 0, 0] },
      },
    ],
  };
}

function heatmapOption(heatmap: HeatmapData, theme: ThemeName) {
  const palette = chartPalette(theme);
  const max = Math.max(...heatmap.values.flat(), 1);
  const points = heatmap.values.flatMap((row, y) => row.map((value, x) => [x, y, value]));
  return {
    ...baseChart(theme),
    tooltip: {
      position: "top",
      backgroundColor: palette.panel,
      borderColor: palette.grid,
      textStyle: { color: palette.text },
      formatter: (params: { data: [number, number, number] }) => {
        const [x, y, value] = params.data;
        return `${heatmap.dates[y]}<br />${heatmap.intervalLabels[x]}<br />${formatNumber(value)}`;
      },
    },
    grid: { left: 72, right: 24, top: 28, bottom: 78, containLabel: false },
    xAxis: {
      type: "category",
      data: heatmap.intervalLabels,
      splitArea: { show: false },
      axisLabel: { color: palette.muted, interval: 7, rotate: 35 },
      axisLine: { lineStyle: { color: palette.grid } },
    },
    yAxis: {
      type: "category",
      data: heatmap.dates,
      splitArea: { show: false },
      axisLabel: { color: palette.muted },
      axisLine: { lineStyle: { color: palette.grid } },
    },
    visualMap: {
      min: 0,
      max,
      orient: "horizontal",
      left: "center",
      bottom: 8,
      calculable: false,
      textStyle: { color: palette.muted },
      inRange: { color: ["#eef4f8", "#88d8cf", "#2f80ed", "#d99016"] },
    },
    series: [
      {
        name: "15-minute interval volumes",
        type: "heatmap",
        data: points,
        emphasis: {
          itemStyle: {
            borderColor: palette.text,
            borderWidth: 1,
          },
        },
      },
    ],
  };
}

function filterHeatmapByDate(heatmap: HeatmapData, filters: Filters): HeatmapData {
  const rows = heatmap.dates
    .map((date, index) => ({ date, values: heatmap.values[index] ?? [] }))
    .filter((row) => row.date >= filters.startDate && row.date <= filters.endDate);
  return {
    dates: rows.map((row) => row.date),
    intervalLabels: heatmap.intervalLabels,
    values: rows.map((row) => row.values),
  };
}

function heatmapFromRows(rows: DeepDiveRow[]): HeatmapData {
  const byDate = new Map<string, number[]>();
  for (const row of rows) {
    const existing = byDate.get(row.date) ?? Array.from({ length: 96 }, () => 0);
    row.intervals.forEach((value, index) => {
      existing[index] += value;
    });
    byDate.set(row.date, existing);
  }
  const dates = [...byDate.keys()].sort();
  return {
    dates,
    intervalLabels,
    values: dates.map((date) => byDate.get(date) ?? []),
  };
}

function profileFromRows(rows: DeepDiveRow[]) {
  const totals = Array.from({ length: 96 }, () => 0);
  rows.forEach((row) => row.intervals.forEach((value, index) => (totals[index] += value)));
  return totals;
}

function profileOption(values: number[], theme: ThemeName) {
  const chart = baseChart(theme);
  const palette = chartPalette(theme);
  return {
    ...chart,
    tooltip: { ...chart.tooltip, trigger: "axis" },
    xAxis: {
      ...chart.xAxis,
      type: "category",
      data: intervalLabels,
      axisLabel: { ...chart.xAxis.axisLabel, interval: 7, rotate: 35 },
    },
    yAxis: { ...chart.yAxis, type: "value", name: "Volume" },
    series: [
      {
        name: "Traffic volume",
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 3, color: palette.blue },
        areaStyle: { opacity: 0.1, color: palette.blue },
        data: values,
      },
    ],
  };
}

function Sidebar({
  data,
  filters,
  setFilters,
  sourceStatus,
  uploadBusy,
  onUpload,
  theme,
  setTheme,
}: {
  data: AppData | null;
  filters: Filters;
  setFilters: (filters: Filters) => void;
  sourceStatus: string;
  uploadBusy: boolean;
  onUpload: (files: File[]) => void;
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const siteOptions = useMemo(() => {
    if (!data) return [];
    const search = filters.search.trim().toLowerCase();
    return data.siteSummary
      .filter((site) => {
        if (!search) return true;
        return (
          site.siteId.toLowerCase().includes(search) ||
          site.displayName.toLowerCase().includes(search) ||
          (site.municipality ?? "").toLowerCase().includes(search)
        );
      })
      .slice(0, 700);
  }, [data, filters.search]);

  const update = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">
          <BarChart3 size={22} />
        </div>
        <div>
          <div className="brand-title">{APP_NAME}</div>
          <div className="brand-subtitle">Victorian signal volume dashboard</div>
        </div>
      </div>

      <section className="filter-group">
        <h2>
          <Database size={16} />
          Data loaded
        </h2>
        <StatusPill status={sourceStatus} />
        <div className="sidebar-facts">
          <span>{data ? `${formatNumber(data.manifest.processedFiles)} files` : "No files"}</span>
          <span>{data?.manifest.dateRange.start ? `${data.manifest.dateRange.start} to ${data.manifest.dateRange.end}` : "No date range"}</span>
        </div>
        <div className="button-row">
          <button className="secondary-button" type="button" onClick={() => fileInput.current?.click()} disabled={uploadBusy}>
            {uploadBusy ? <RefreshCw size={16} className="spin" /> : <FileUp size={16} />}
            Upload CSV
          </button>
          <button
            className="icon-toggle"
            type="button"
            title="Toggle theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".csv"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) onUpload(files);
            event.currentTarget.value = "";
          }}
        />
      </section>

      <section className="filter-group">
        <h2>
          <CalendarDays size={16} />
          Date
        </h2>
        <label>
          Start
          <input
            type="date"
            value={filters.startDate}
            min={data?.manifest.dateRange.start}
            max={data?.manifest.dateRange.end}
            onChange={(event) => update({ startDate: event.target.value })}
          />
        </label>
        <label>
          End
          <input
            type="date"
            value={filters.endDate}
            min={data?.manifest.dateRange.start}
            max={data?.manifest.dateRange.end}
            onChange={(event) => update({ endDate: event.target.value })}
          />
        </label>
      </section>

      <section className="filter-group">
        <h2>
          <MapPin size={16} />
          Location
        </h2>
        <label>
          Region
          <select value={filters.region} onChange={(event) => update({ region: event.target.value })}>
            <option>All</option>
            {data?.manifest.regions.map((region) => (
              <option key={region}>{region}</option>
            ))}
          </select>
        </label>
        <label>
          Site search
          <div className="search-input">
            <Search size={15} />
            <input
              type="search"
              value={filters.search}
              placeholder="Road, site, municipality"
              onChange={(event) => update({ search: event.target.value })}
            />
          </div>
        </label>
        <label>
          SCATS site
          <select value={filters.siteId} onChange={(event) => update({ siteId: event.target.value })}>
            <option value="All">All</option>
            {siteOptions.map((site) => (
              <option key={site.siteId} value={site.siteId}>
                {site.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={filters.requireCoordinates}
            onChange={(event) => update({ requireCoordinates: event.target.checked })}
          />
          Sites with coordinates
        </label>
      </section>

      <section className="filter-group">
        <h2>
          <Filter size={16} />
          Detector
        </h2>
        <label>
          Detector
          <select value={filters.detector} onChange={(event) => update({ detector: event.target.value })}>
            <option>All</option>
            {data?.manifest.detectors.map((detector) => (
              <option key={detector}>{detector}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="filter-group">
        <h2>
          <AlertTriangle size={16} />
          Data quality filters
        </h2>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={filters.includeZeroVolume}
            onChange={(event) => update({ includeZeroVolume: event.target.checked })}
          />
          Include zero-volume rows
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={filters.includeIncomplete}
            onChange={(event) => update({ includeIncomplete: event.target.checked })}
          />
          Include incomplete records
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={filters.includeAlarmRows}
            onChange={(event) => update({ includeAlarmRows: event.target.checked })}
          />
          Include alarm rows
        </label>
      </section>
    </aside>
  );
}

function OverviewTab({
  overview,
  daily,
  regions,
  sites,
  theme,
}: {
  overview: ReturnType<typeof aggregateOverview>;
  daily: DailyVolume[];
  regions: ReturnType<typeof groupByRegion>;
  sites: ReturnType<typeof groupBySite>;
  theme: ThemeName;
}) {
  return (
    <div className="tab-stack">
      <div className="metric-grid">
        <Metric label="Total 24-hour volume" value={compactNumber(overview.totalVolume)} detail="Filtered rows" tone="blue" />
        <Metric label="Rows" value={formatNumber(overview.rowCount)} detail={`${formatNumber(overview.siteCount)} sites`} />
        <Metric label="Regions" value={formatNumber(overview.regionCount)} detail={`${formatNumber(overview.detectorCount)} detectors`} tone="teal" />
        <Metric label="Alarm count" value={formatNumber(overview.alarmCount)} detail="Reliability warning" tone="red" />
        <Metric label="Complete lookup match" value={formatPercent(overview.matchRate)} detail={`${formatNumber(overview.unmatchedSites)} unmatched`} tone="teal" />
        <Metric label="Incomplete records" value={formatNumber(overview.incompleteRows)} detail="CT_RECORDS below 96" tone="amber" />
      </div>
      <div className="grid-two">
        <ChartPanel title="Daily traffic volume" caption="Filtered total 24-hour volume by date.">
          {daily.length ? <Chart option={dailyLineOption(daily, theme)} /> : <EmptyState message="No daily volume data is available." />}
        </ChartPanel>
        <ChartPanel title="Regional volume" caption="Regions ranked by filtered total volume.">
          {regions.length ? (
            <Chart option={barOption(regions.slice(0, 12), (row) => row.region, (row) => row.totalVolume, theme)} />
          ) : (
            <EmptyState message="No regional data is available." />
          )}
        </ChartPanel>
      </div>
      <ChartPanel title="Top SCATS sites by volume" caption="Highest-volume sites in the current filter window.">
        {sites.length ? (
          <Chart
            option={barOption(
              sites.slice(0, 15),
              (row) => row.displayName,
              (row) => row.totalVolume,
              theme,
              chartPalette(theme).teal,
            )}
            height={460}
          />
        ) : (
          <EmptyState message="No site totals are available." />
        )}
      </ChartPanel>
    </div>
  );
}

function SiteLocationsTab({
  sites,
  siteSummary,
  overview,
}: {
  sites: ReturnType<typeof groupBySite>;
  siteSummary: SiteSummary[];
  overview: ReturnType<typeof aggregateOverview>;
}) {
  const siteRows = sites.slice(0, 500).map((site) => ({
    site: site.displayName,
    region: site.region,
    municipality: site.municipality ?? "Not available",
    lookup: lookupSourceLabel(site.lookupSource),
    confidence: String(site.confidence).replace(/_/g, " "),
    volume: site.totalVolume,
    alarms: site.alarmCount,
    coordinates: site.latitude && site.longitude ? `${site.latitude.toFixed(5)}, ${site.longitude.toFixed(5)}` : "Not available",
  }));
  const unmatchedRows = siteSummary
    .filter((site) => site.lookupSource === "unmatched")
    .map((site) => ({
      site: site.displayName,
      regions: site.regions.join(", "),
      detectors: site.detectors.length,
      rows: site.rowCount,
    }));

  return (
    <div className="tab-stack">
      <div className="metric-grid">
        <Metric label="Mapped sites" value={formatNumber(sites.filter((site) => site.latitude && site.longitude).length)} tone="teal" />
        <Metric label="Lookup match rate" value={formatPercent(overview.matchRate)} detail={`${formatNumber(overview.matchedSites)} matched`} tone="teal" />
        <Metric label="Unmatched sites" value={formatNumber(overview.unmatchedSites)} tone="amber" />
      </div>
      <ChartPanel title="Site locations" caption="Circle size follows filtered total traffic volume.">
        <Suspense fallback={<div className="chart-loading map-shell">Loading map</div>}>
          <SiteMap sites={sites} />
        </Suspense>
      </ChartPanel>
      <ChartPanel title="Enriched site table" caption="Official lookup values are preferred, with spreadsheet fallback where available.">
        <DataTable
          rows={siteRows}
          columns={[
            { key: "site", label: "Site" },
            { key: "region", label: "Region" },
            { key: "municipality", label: "Municipality" },
            { key: "lookup", label: "Lookup source" },
            { key: "confidence", label: "Confidence" },
            { key: "volume", label: "Total 24-hour volume", render: (row) => formatNumber(Number(row.volume)) },
            { key: "coordinates", label: "Coordinates" },
          ]}
        />
      </ChartPanel>
      <ChartPanel title="Unmatched sites" caption="Sites kept visible when no lookup row is available.">
        <DataTable
          rows={unmatchedRows}
          columns={[
            { key: "site", label: "SCATS site" },
            { key: "regions", label: "Regions" },
            { key: "detectors", label: "Detectors", render: (row) => formatNumber(Number(row.detectors)) },
            { key: "rows", label: "Rows", render: (row) => formatNumber(Number(row.rows)) },
          ]}
        />
      </ChartPanel>
    </div>
  );
}

function DataQualityTab({
  overview,
  daily,
  data,
  theme,
}: {
  overview: ReturnType<typeof aggregateOverview>;
  daily: DailyVolume[];
  data: AppData;
  theme: ThemeName;
}) {
  const unusualRows = daily
    .filter((row) => row.unusualDailyTotal)
    .map((row) => ({
      date: row.date,
      totalVolume: row.totalVolume,
      rows: row.rowCount,
      alarmCount: row.alarmCount,
    }));
  return (
    <div className="tab-stack">
      <div className="metric-grid">
        <Metric label="Zero-volume rows" value={formatNumber(overview.zeroVolumeRows)} tone="amber" />
        <Metric label="Incomplete records" value={formatNumber(overview.incompleteRows)} tone="amber" />
        <Metric label="Rows with alarms" value={formatNumber(overview.alarmCount)} tone="red" />
        <Metric label="Negative totals" value={formatNumber(overview.negativeTotalRows)} tone="red" />
        <Metric label="Negative intervals" value={formatNumber(overview.negativeIntervalRows)} tone="red" />
        <Metric label="Missing-value rows" value={formatNumber(overview.missingValueRows)} tone="amber" />
      </div>
      <ChartPanel title="Data quality by date" caption="Reliability warnings are counted, not automatically corrected.">
        {daily.length ? <Chart option={qualityOption(daily, theme)} height={420} /> : <EmptyState message="No quality data is available." />}
      </ChartPanel>
      <div className="grid-two">
        <ChartPanel title="Missing values by field" caption="Top fields with missing values in generated summaries.">
          <DataTable
            rows={data.qualitySummary.missingColumns.map((row) => ({
              column: data.manifest.labels[row.column] ?? row.column,
              missingRows: row.missingRows,
            }))}
            columns={[
              { key: "column", label: "Field" },
              { key: "missingRows", label: "Missing rows", render: (row) => formatNumber(Number(row.missingRows)) },
            ]}
            pageSize={12}
          />
        </ChartPanel>
        <ChartPanel title="Unusual daily totals" caption="Detected with an IQR rule over processed dates.">
          <DataTable
            rows={unusualRows}
            columns={[
              { key: "date", label: "Date" },
              { key: "totalVolume", label: "Total 24-hour volume", render: (row) => formatNumber(Number(row.totalVolume)) },
              { key: "rows", label: "Rows", render: (row) => formatNumber(Number(row.rows)) },
              { key: "alarmCount", label: "Alarm count", render: (row) => formatNumber(Number(row.alarmCount)) },
            ]}
            pageSize={12}
          />
        </ChartPanel>
      </div>
    </div>
  );
}

function TrafficPatternsTab({
  daily,
  regions,
  sites,
  heatmap,
  theme,
}: {
  daily: DailyVolume[];
  regions: ReturnType<typeof groupByRegion>;
  sites: ReturnType<typeof groupBySite>;
  heatmap: HeatmapData;
  theme: ThemeName;
}) {
  const weekdayWeekend = groupWeekdayWeekend(daily);
  return (
    <div className="tab-stack">
      <div className="grid-two">
        <ChartPanel title="Daily traffic volume trend" caption="A quick read on day-to-day movement.">
          {daily.length ? <Chart option={dailyLineOption(daily, theme)} /> : <EmptyState message="No daily trend data is available." />}
        </ChartPanel>
        <ChartPanel title="Weekday and weekend comparison" caption="Average daily volume by day type.">
          {weekdayWeekend.length ? (
            <Chart option={weekdayOption(weekdayWeekend, theme)} />
          ) : (
            <EmptyState message="Both weekday and weekend dates are needed." />
          )}
        </ChartPanel>
      </div>
      <div className="grid-two">
        <ChartPanel title="Average detector volume by region" caption="Total volume divided by distinct detectors in the filter window.">
          {regions.length ? (
            <Chart
              option={barOption(
                regions.slice(0, 12),
                (row) => row.region,
                (row) => row.averageDetectorVolume,
                theme,
                chartPalette(theme).cyan,
              )}
            />
          ) : (
            <EmptyState message="No detector averages are available." />
          )}
        </ChartPanel>
        <ChartPanel title="Top SCATS sites by volume" caption="Sites ranked within the current filters.">
          {sites.length ? (
            <Chart
              option={barOption(
                sites.slice(0, 12),
                (row) => row.displayName,
                (row) => row.totalVolume,
                theme,
                chartPalette(theme).teal,
              )}
            />
          ) : (
            <EmptyState message="No site volume data is available." />
          )}
        </ChartPanel>
      </div>
      <ChartPanel title="15-minute interval heatmap" caption="Generated static interval totals by date.">
        {heatmap.dates.length ? (
          <Chart option={heatmapOption(heatmap, theme)} height={Math.min(720, Math.max(360, heatmap.dates.length * 26 + 130))} />
        ) : (
          <EmptyState message="No interval heatmap data is available for the selected dates." />
        )}
      </ChartPanel>
    </div>
  );
}

function DeepDiveTab({
  data,
  filters,
  theme,
}: {
  data: AppData;
  filters: Filters;
  theme: ThemeName;
}) {
  const [siteId, setSiteId] = useState("");
  const [detector, setDetector] = useState("");
  const [date, setDate] = useState("");
  const [deepDive, setDeepDive] = useState<DeepDiveSite | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const localSites = useMemo(() => {
    if (!data.localDeepDiveRows) return [];
    const seen = new Map<string, { siteId: string; displayName: string; region: string; totalVolume: number }>();
    const siteMap = new Map(data.siteSummary.map((site) => [site.siteId, site]));
    for (const row of data.localDeepDiveRows) {
      const site = seen.get(row.siteId) ?? {
        siteId: row.siteId,
        displayName: siteMap.get(row.siteId)?.displayName ?? `Site ${row.siteId}`,
        region: row.region,
        totalVolume: 0,
      };
      site.totalVolume += row.totalVolume;
      seen.set(row.siteId, site);
    }
    return [...seen.values()].sort((a, b) => b.totalVolume - a.totalVolume);
  }, [data.localDeepDiveRows, data.siteSummary]);

  const deepSites = data.localDeepDiveRows ? localSites : data.deepDiveIndex.sites;
  const selectedDeepSite = deepSites.find((site) => site.siteId === siteId);

  useEffect(() => {
    if (!deepSites.length) {
      setSiteId("");
      return;
    }
    if (filters.siteId !== "All" && deepSites.some((site) => site.siteId === filters.siteId)) {
      setSiteId(filters.siteId);
      return;
    }
    if (!siteId || !deepSites.some((site) => site.siteId === siteId)) {
      setSiteId(deepSites[0].siteId);
    }
  }, [deepSites, filters.siteId, siteId]);

  useEffect(() => {
    if (!siteId || data.localDeepDiveRows) {
      setDeepDive(null);
      return;
    }
    const item = data.deepDiveIndex.sites.find((site) => site.siteId === siteId);
    if (!item) {
      setDeepDive(null);
      return;
    }
    setLoading(true);
    setError("");
    loadDeepDiveSite(item.file)
      .then(setDeepDive)
      .catch((loadError: Error) => {
        setDeepDive(null);
        setError(loadError.message);
      })
      .finally(() => setLoading(false));
  }, [data, siteId]);

  const deepRows = useMemo(() => {
    const rows = data.localDeepDiveRows
      ? data.localDeepDiveRows.filter((row) => row.siteId === siteId)
      : deepDive?.rows ?? [];
    return rows.filter((row) => {
      if (row.date < filters.startDate || row.date > filters.endDate) return false;
      if (filters.region !== "All" && row.region !== filters.region) return false;
      if (!filters.includeAlarmRows && row.alarmCount > 0) return false;
      if (!filters.includeIncomplete && row.records < 96) return false;
      if (!filters.includeZeroVolume && row.totalVolume === 0) return false;
      return true;
    });
  }, [data.localDeepDiveRows, deepDive, filters, siteId]);

  const detectorOptions = useMemo(() => [...new Set(deepRows.map((row) => row.detector))].sort((a, b) => Number(a) - Number(b)), [deepRows]);
  useEffect(() => {
    if (!detectorOptions.length) {
      setDetector("");
      return;
    }
    if (filters.detector !== "All" && detectorOptions.includes(filters.detector)) {
      setDetector(filters.detector);
      return;
    }
    if (!detector || !detectorOptions.includes(detector)) setDetector(detectorOptions[0]);
  }, [detectorOptions, detector, filters.detector]);

  const detectorRows = deepRows.filter((row) => !detector || row.detector === detector);
  const dateOptions = [...new Set(detectorRows.map((row) => row.date))].sort();
  useEffect(() => {
    if (!dateOptions.length) {
      setDate("");
      return;
    }
    if (!date || !dateOptions.includes(date)) setDate(dateOptions[dateOptions.length - 1]);
  }, [dateOptions, date]);

  const selectedDateRows = detectorRows.filter((row) => row.date === date);
  const profile = profileFromRows(selectedDateRows);
  const heatmap = heatmapFromRows(detectorRows);
  const peakValue = Math.max(...profile, 0);
  const peakIndex = profile.findIndex((value) => value === peakValue);

  return (
    <div className="tab-stack">
      <section className="panel">
        <div className="deep-controls">
          <label>
            SCATS site
            <select value={siteId} onChange={(event) => setSiteId(event.target.value)}>
              {deepSites.map((site) => (
                <option key={site.siteId} value={site.siteId}>
                  {site.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Detector
            <select value={detector} onChange={(event) => setDetector(event.target.value)}>
              {detectorOptions.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Date
            <select value={date} onChange={(event) => setDate(event.target.value)}>
              {dateOptions.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {loading ? <EmptyState message="Loading selected site interval slice." /> : null}
      {error ? <EmptyState message={error} /> : null}
      {!deepSites.length ? <EmptyState message="No deep-dive interval slices are available." /> : null}
      {selectedDeepSite && !deepRows.length && !loading ? (
        <EmptyState message="No rows are available for that site under the current filters." />
      ) : null}

      {selectedDeepSite && deepRows.length ? (
        <>
          <div className="metric-grid">
            <Metric label="Selected site" value={selectedDeepSite.siteId} detail={selectedDeepSite.region} tone="teal" />
            <Metric label="Rows" value={formatNumber(deepRows.length)} detail={`${formatNumber(detectorOptions.length)} detectors`} />
            <Metric label="Selected date volume" value={formatNumber(selectedDateRows.reduce((sum, row) => sum + row.totalVolume, 0))} tone="blue" />
            <Metric
              label="Peak interval"
              value={peakIndex >= 0 ? intervalLabels[peakIndex] : "Not available"}
              detail={peakIndex >= 0 ? formatNumber(peakValue) : undefined}
              tone="amber"
            />
          </div>
          <div className="grid-two">
            <ChartPanel title="Selected-day interval profile" caption="15-minute interval volumes for the chosen site and detector.">
              <Chart option={profileOption(profile, theme)} height={390} />
            </ChartPanel>
            <ChartPanel title="Selected site heatmap" caption="Daily interval pattern for the chosen detector.">
              {heatmap.dates.length ? (
                <Chart option={heatmapOption(heatmap, theme)} height={390} />
              ) : (
                <EmptyState message="No heatmap rows are available." />
              )}
            </ChartPanel>
          </div>
          <ChartPanel title="Deep-dive rows" caption="Rows loaded only for the selected site slice.">
            <DataTable
              rows={deepRows.map((row) => ({
                date: row.date,
                detector: row.detector,
                region: row.region,
                records: row.records,
                volume: row.totalVolume,
                alarms: row.alarmCount,
              }))}
              columns={[
                { key: "date", label: "Date" },
                { key: "detector", label: "Detector" },
                { key: "region", label: "Region" },
                { key: "records", label: "Complete 15-minute records", render: (row) => formatNumber(Number(row.records)) },
                { key: "volume", label: "Total 24-hour volume", render: (row) => formatNumber(Number(row.volume)) },
                { key: "alarms", label: "Alarm count", render: (row) => formatNumber(Number(row.alarms)) },
              ]}
            />
          </ChartPanel>
        </>
      ) : null}
    </div>
  );
}

function ExportsTab({
  filteredRows,
  daily,
  regions,
  sites,
  data,
}: {
  filteredRows: SiteDailySummary[];
  daily: DailyVolume[];
  regions: ReturnType<typeof groupByRegion>;
  sites: ReturnType<typeof groupBySite>;
  data: AppData;
}) {
  const siteLookupRows = data.siteSummary.map((site) => ({
    siteId: site.siteId,
    displayName: site.displayName,
    officialName: site.officialName,
    spreadsheetName: site.spreadsheetName,
    municipality: site.municipality,
    signalType: site.signalType,
    latitude: site.latitude,
    longitude: site.longitude,
    melwayReference: site.melwayReference,
    lookupSource: site.lookupSource,
    confidence: site.confidence,
  }));
  const unmatchedRows = siteLookupRows.filter((row) => row.lookupSource === "unmatched");
  const exportButtons = [
    {
      label: "Filtered site-day summary",
      rows: filteredRows as unknown as RowRecord[],
      filename: "signal-flow-melbourne-filtered-site-days.csv",
    },
    {
      label: "Daily traffic summary",
      rows: daily as unknown as RowRecord[],
      filename: "signal-flow-melbourne-daily-summary.csv",
    },
    {
      label: "Regional summary",
      rows: regions as unknown as RowRecord[],
      filename: "signal-flow-melbourne-regions.csv",
    },
    {
      label: "Site totals",
      rows: sites as unknown as RowRecord[],
      filename: "signal-flow-melbourne-sites.csv",
    },
    {
      label: "Enriched site lookup",
      rows: siteLookupRows,
      filename: "signal-flow-melbourne-site-lookup.csv",
    },
    {
      label: "Unmatched sites",
      rows: unmatchedRows,
      filename: "signal-flow-melbourne-unmatched-sites.csv",
    },
  ];

  return (
    <div className="tab-stack">
      <section className="export-grid">
        {exportButtons.map((item) => (
          <button
            className="export-button"
            type="button"
            key={item.filename}
            onClick={() => downloadCsv(item.filename, item.rows)}
            disabled={!item.rows.length}
          >
            <Download size={18} />
            <span>{item.label}</span>
            <small>{formatNumber(item.rows.length)} rows</small>
          </button>
        ))}
      </section>
      <ChartPanel title="Filtered export preview" caption="Site-day summary rows currently selected by the sidebar filters.">
        <DataTable
          rows={filteredRows.slice(0, 1000).map((row) => ({
            date: row.date,
            site: row.siteId,
            region: row.region,
            detectors: row.detectors.join(", "),
            volume: row.totalVolume,
            rows: row.rowCount,
            alarms: row.alarmCount,
          }))}
          columns={[
            { key: "date", label: "Date" },
            { key: "site", label: "SCATS site" },
            { key: "region", label: "Region" },
            { key: "detectors", label: "Detector" },
            { key: "volume", label: "Total 24-hour volume", render: (row) => formatNumber(Number(row.volume)) },
            { key: "rows", label: "Rows", render: (row) => formatNumber(Number(row.rows)) },
            { key: "alarms", label: "Alarm count", render: (row) => formatNumber(Number(row.alarms)) },
          ]}
        />
      </ChartPanel>
    </div>
  );
}

function App() {
  const [theme, setTheme] = useState<ThemeName>(() => (localStorage.getItem("signal-flow-theme") as ThemeName) || "dark");
  const [data, setData] = useState<AppData | null>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilterState);
  const [activeTab, setActiveTab] = useState<TabName>("Overview");
  const [sourceStatus, setSourceStatus] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("signal-flow-theme", theme);
  }, [theme]);

  useEffect(() => {
    loadGeneratedData()
      .then((generated) => {
        setData(generated);
        setFilters(defaultFilters(generated));
        setSourceStatus("generated");
      })
      .catch((error: Error) => {
        setLoadError(error.message);
        setSourceStatus("none");
        setData(null);
      });
  }, []);

  const siteMap = useMemo(() => new Map((data?.siteSummary ?? []).map((site) => [site.siteId, site])), [data]);
  const filteredRows = useMemo(() => {
    if (!data) return [];
    const rows = applySiteDailyFilters(data.siteDailySummary, filters);
    if (!filters.requireCoordinates) return rows;
    return rows.filter((row) => {
      const site = siteMap.get(row.siteId);
      return Number.isFinite(site?.latitude) && Number.isFinite(site?.longitude);
    });
  }, [data, filters, siteMap]);
  const unusualDates = useMemo(() => new Set((data?.dailyVolume ?? []).filter((row) => row.unusualDailyTotal).map((row) => row.date)), [data]);
  const daily = useMemo(() => groupDaily(filteredRows, unusualDates), [filteredRows, unusualDates]);
  const overview = useMemo(() => {
    const computed = aggregateOverview(filteredRows, siteMap);
    computed.unusualDailyTotalDays = daily.filter((row) => row.unusualDailyTotal).length;
    return computed;
  }, [daily, filteredRows, siteMap]);
  const regions = useMemo(() => groupByRegion(filteredRows), [filteredRows]);
  const sites = useMemo(() => groupBySite(filteredRows, siteMap), [filteredRows, siteMap]);
  const heatmap = useMemo(() => {
    if (!data) return { dates: [], intervalLabels, values: [] };
    return filterHeatmapByDate(data.heatmapGlobal, filters);
  }, [data, filters]);

  async function handleUpload(files: File[]) {
    setUploadBusy(true);
    setLoadError("");
    try {
      const localData = await buildLocalDataFromFiles(files, data?.siteSummary ?? []);
      setData(localData);
      setFilters(defaultFilters(localData));
      setSourceStatus("local-fallback");
      setActiveTab("Overview");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
      if (!data) {
        setData(null);
        setSourceStatus("none");
      }
    } finally {
      setUploadBusy(false);
    }
  }

  const shellManifest = data?.manifest ?? emptyManifest(sourceStatus === "loading" ? "loading" : "none");
  const metricOverview = data ? overview : emptyOverview();

  return (
    <div className="app-shell">
      <Sidebar
        data={data}
        filters={filters}
        setFilters={setFilters}
        sourceStatus={sourceStatus}
        uploadBusy={uploadBusy}
        onUpload={handleUpload}
        theme={theme}
        setTheme={setTheme}
      />
      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Exploratory civic traffic dashboard</p>
            <h1>{APP_NAME}</h1>
            <p className="subtitle">
              Victorian SCATS traffic signal volume data - {shellManifest.dateRange.start ? `${humanDate(shellManifest.dateRange.start)} to ${humanDate(shellManifest.dateRange.end)}` : "no generated date range"}
            </p>
          </div>
          <div className="topbar-actions">
            <a className="text-link" href={DATASET_URL} target="_blank" rel="noreferrer">
              DataVic source
            </a>
            <StatusPill status={sourceStatus} />
          </div>
        </header>

        {loadError ? (
          <div className="banner banner-warning">
            <AlertTriangle size={18} />
            <span>{loadError}</span>
          </div>
        ) : null}
        {data?.qualitySummary.generatedWarnings.map((warning) => (
          <div className="banner" key={warning}>
            <AlertTriangle size={18} />
            <span>{warning}</span>
          </div>
        ))}

        {!data ? (
          <section className="no-data">
            <UploadCloud size={34} />
            <h2>No usable data source found</h2>
            <p>Upload one or more local `VSDATA_*.csv` files, or run the data refresh script to generate static files.</p>
            <button className="primary-button" type="button" onClick={() => document.querySelector<HTMLInputElement>('input[type="file"]')?.click()}>
              <FileUp size={18} />
              Upload CSV files
            </button>
          </section>
        ) : (
          <>
            <nav className="tabs" aria-label="Dashboard sections">
              {TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={activeTab === tab ? "active" : ""}
                  onClick={() => setActiveTab(tab as TabName)}
                >
                  {tab}
                </button>
              ))}
            </nav>

            <section className="summary-strip" aria-label="Filtered summary">
              <div>
                <span>Total volume</span>
                <strong>{compactNumber(metricOverview.totalVolume)}</strong>
              </div>
              <div>
                <span>Rows</span>
                <strong>{formatNumber(metricOverview.rowCount)}</strong>
              </div>
              <div>
                <span>Sites</span>
                <strong>{formatNumber(metricOverview.siteCount)}</strong>
              </div>
              <div>
                <span>Alarms</span>
                <strong>{formatNumber(metricOverview.alarmCount)}</strong>
              </div>
            </section>

            {activeTab === "Overview" ? (
              <OverviewTab overview={overview} daily={daily} regions={regions} sites={sites} theme={theme} />
            ) : null}
            {activeTab === "Site locations" ? (
              <SiteLocationsTab sites={sites} siteSummary={data.siteSummary} overview={overview} />
            ) : null}
            {activeTab === "Data quality" ? (
              <DataQualityTab overview={overview} daily={daily} data={data} theme={theme} />
            ) : null}
            {activeTab === "Traffic patterns" ? (
              <TrafficPatternsTab daily={daily} regions={regions} sites={sites} heatmap={heatmap} theme={theme} />
            ) : null}
            {activeTab === "Site deep dive" ? <DeepDiveTab data={data} filters={filters} theme={theme} /> : null}
            {activeTab === "Exports" ? (
              <ExportsTab filteredRows={filteredRows} daily={daily} regions={regions} sites={sites} data={data} />
            ) : null}
          </>
        )}

        <footer className="footer">
          <Table2 size={16} />
          <span>Exploratory dashboard only. Use source systems for official traffic reporting.</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
