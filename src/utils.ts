import type { DailyVolume, Filters, SiteDailySummary, SiteSummary } from "./types";

export const APP_NAME = "Signal Flow Melbourne";
export const DATASET_URL =
  "https://opendata.transport.vic.gov.au/dataset/traffic-signal-volume-data";

export const TABS = [
  "Overview",
  "Site locations",
  "Data quality",
  "Traffic patterns",
  "Site deep dive",
  "Exports",
] as const;

export const RAW_LABELS: Record<string, string> = {
  QT_VOLUME_24HOUR: "Total 24-hour volume",
  CT_RECORDS: "Complete 15-minute records",
  CT_ALARM_24HOUR: "Alarm count",
  NB_SCATS_SITE: "SCATS site",
  NB_DETECTOR: "Detector",
  NM_REGION: "Region",
  "V00-V95": "15-minute interval volumes",
};

export const intervalLabels = Array.from({ length: 96 }, (_, index) => {
  const startMinutes = index * 15;
  const endMinutes = (index + 1) * 15;
  const start = `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(
    startMinutes % 60,
  ).padStart(2, "0")}`;
  const end =
    endMinutes >= 24 * 60
      ? "00:00"
      : `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(
          endMinutes % 60,
        ).padStart(2, "0")}`;
  return `${start}-${end}`;
});

export function assetUrl(path: string) {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}${path.replace(/^\/+/, "")}`;
}

export async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(assetUrl(path), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load ${path}: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function formatNumber(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "Not available";
  return new Intl.NumberFormat("en-AU", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "Not available";
  return new Intl.NumberFormat("en-AU", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

export function compactNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return new Intl.NumberFormat("en-AU", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function inDateRange(date: string, startDate: string, endDate: string) {
  return date >= startDate && date <= endDate;
}

export function detectorMatches(detectors: string[], detector: string) {
  return detector === "All" || detectors.includes(detector);
}

export function applySiteDailyFilters(rows: SiteDailySummary[], filters: Filters) {
  return rows.filter((row) => {
    if (!inDateRange(row.date, filters.startDate, filters.endDate)) return false;
    if (filters.region !== "All" && row.region !== filters.region) return false;
    if (filters.siteId !== "All" && row.siteId !== filters.siteId) return false;
    if (!detectorMatches(row.detectors, filters.detector)) return false;
    if (!filters.includeZeroVolume && row.zeroVolumeRows > 0) return false;
    if (!filters.includeIncomplete && row.incompleteRows > 0) return false;
    if (!filters.includeAlarmRows && row.alarmCount > 0) return false;
    return true;
  });
}

export function groupDaily(rows: SiteDailySummary[], unusualDates = new Set<string>()): DailyVolume[] {
  const byDate = new Map<string, DailyVolume>();
  for (const row of rows) {
    const existing =
      byDate.get(row.date) ??
      ({
        date: row.date,
        totalVolume: 0,
        rowCount: 0,
        alarmCount: 0,
        zeroVolumeRows: 0,
        incompleteRows: 0,
        negativeTotalRows: 0,
        negativeIntervalRows: 0,
        missingValueRows: 0,
        unusualDailyTotal: unusualDates.has(row.date),
      } satisfies DailyVolume);
    existing.totalVolume += row.totalVolume;
    existing.rowCount += row.rowCount;
    existing.alarmCount += row.alarmCount;
    existing.zeroVolumeRows += row.zeroVolumeRows;
    existing.incompleteRows += row.incompleteRows;
    existing.negativeTotalRows += row.negativeTotalRows;
    existing.negativeIntervalRows += row.negativeIntervalRows;
    existing.missingValueRows += row.missingValueRows;
    byDate.set(row.date, existing);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function groupByRegion(rows: SiteDailySummary[]) {
  const byRegion = new Map<
    string,
    {
      region: string;
      totalVolume: number;
      rowCount: number;
      alarmCount: number;
      siteIds: Set<string>;
      detectors: Set<string>;
      recordsTotal: number;
    }
  >();
  for (const row of rows) {
    const region = row.region || "Unknown";
    const existing =
      byRegion.get(region) ??
      {
        region,
        totalVolume: 0,
        rowCount: 0,
        alarmCount: 0,
        siteIds: new Set<string>(),
        detectors: new Set<string>(),
        recordsTotal: 0,
      };
    existing.totalVolume += row.totalVolume;
    existing.rowCount += row.rowCount;
    existing.alarmCount += row.alarmCount;
    existing.recordsTotal += row.recordsTotal;
    existing.siteIds.add(row.siteId);
    row.detectors.forEach((detector) => existing.detectors.add(detector));
    byRegion.set(region, existing);
  }

  return [...byRegion.values()]
    .map((region) => ({
      region: region.region,
      totalVolume: region.totalVolume,
      rowCount: region.rowCount,
      alarmCount: region.alarmCount,
      siteCount: region.siteIds.size,
      detectorCount: region.detectors.size,
      averageDetectorVolume: region.detectors.size
        ? region.totalVolume / Math.max(region.detectors.size, 1)
        : 0,
      completeRecordRate: region.rowCount
        ? region.recordsTotal / Math.max(region.rowCount * 96, 1)
        : 0,
    }))
    .sort((a, b) => b.totalVolume - a.totalVolume);
}

export function groupBySite(rows: SiteDailySummary[], sites: Map<string, SiteSummary>) {
  const bySite = new Map<
    string,
    {
      siteId: string;
      region: string;
      totalVolume: number;
      rowCount: number;
      alarmCount: number;
      detectors: Set<string>;
      dates: Set<string>;
    }
  >();

  for (const row of rows) {
    const existing =
      bySite.get(row.siteId) ??
      {
        siteId: row.siteId,
        region: row.region,
        totalVolume: 0,
        rowCount: 0,
        alarmCount: 0,
        detectors: new Set<string>(),
        dates: new Set<string>(),
      };
    existing.totalVolume += row.totalVolume;
    existing.rowCount += row.rowCount;
    existing.alarmCount += row.alarmCount;
    row.detectors.forEach((detector) => existing.detectors.add(detector));
    existing.dates.add(row.date);
    bySite.set(row.siteId, existing);
  }

  return [...bySite.values()]
    .map((site) => {
      const lookup = sites.get(site.siteId);
      return {
        siteId: site.siteId,
        displayName: lookup?.displayName ?? `Site ${site.siteId}`,
        region: site.region,
        totalVolume: site.totalVolume,
        rowCount: site.rowCount,
        alarmCount: site.alarmCount,
        detectorCount: site.detectors.size,
        dateCount: site.dates.size,
        latitude: lookup?.latitude ?? null,
        longitude: lookup?.longitude ?? null,
        municipality: lookup?.municipality ?? null,
        lookupSource: lookup?.lookupSource ?? "unmatched",
        confidence: lookup?.confidence ?? "raw_site_id",
      };
    })
    .sort((a, b) => b.totalVolume - a.totalVolume);
}

export function aggregateOverview(rows: SiteDailySummary[], sites: Map<string, SiteSummary>) {
  const siteIds = new Set<string>();
  const detectors = new Set<string>();
  const regions = new Set<string>();
  let totalVolume = 0;
  let rowCount = 0;
  let alarmCount = 0;
  let zeroVolumeRows = 0;
  let incompleteRows = 0;
  let negativeTotalRows = 0;
  let negativeIntervalRows = 0;
  let missingValueRows = 0;

  for (const row of rows) {
    totalVolume += row.totalVolume;
    rowCount += row.rowCount;
    alarmCount += row.alarmCount;
    zeroVolumeRows += row.zeroVolumeRows;
    incompleteRows += row.incompleteRows;
    negativeTotalRows += row.negativeTotalRows;
    negativeIntervalRows += row.negativeIntervalRows;
    missingValueRows += row.missingValueRows;
    siteIds.add(row.siteId);
    regions.add(row.region);
    row.detectors.forEach((detector) => detectors.add(detector));
  }

  let matchedSites = 0;
  let unmatchedSites = 0;
  for (const siteId of siteIds) {
    const lookup = sites.get(siteId);
    if (lookup && lookup.lookupSource !== "unmatched") matchedSites += 1;
    else unmatchedSites += 1;
  }

  return {
    rowCount,
    siteCount: siteIds.size,
    detectorCount: detectors.size,
    regionCount: regions.size,
    totalVolume,
    alarmCount,
    zeroVolumeRows,
    incompleteRows,
    negativeTotalRows,
    negativeIntervalRows,
    missingValueRows,
    unusualDailyTotalDays: 0,
    matchedSites,
    unmatchedSites,
    matchRate: siteIds.size ? matchedSites / siteIds.size : 0,
  };
}

export function dayType(date: string): "Weekday" | "Weekend" {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6 ? "Weekend" : "Weekday";
}

export function groupWeekdayWeekend(daily: DailyVolume[]) {
  const grouped = new Map<
    "Weekday" | "Weekend",
    { dayType: "Weekday" | "Weekend"; totalVolume: number; dateCount: number }
  >();
  for (const row of daily) {
    const type = dayType(row.date);
    const existing = grouped.get(type) ?? { dayType: type, totalVolume: 0, dateCount: 0 };
    existing.totalVolume += row.totalVolume;
    existing.dateCount += 1;
    grouped.set(type, existing);
  }
  return [...grouped.values()].map((row) => ({
    ...row,
    averageDailyVolume: row.dateCount ? row.totalVolume / row.dateCount : 0,
  }));
}

export function toCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  const escapeCell = (value: unknown) => {
    if (value === null || value === undefined) return "";
    const text = Array.isArray(value) ? value.join("; ") : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.join(","), ...rows.map((row) => columns.map((column) => escapeCell(row[column])).join(","))].join(
    "\n",
  );
}

export function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
}

export function sourceLabel(status: string) {
  switch (status) {
    case "live":
      return "Using live DataVic source";
    case "generated":
      return "Using generated static data";
    case "local-fallback":
      return "Using local fallback data";
    case "none":
      return "No usable data source found";
    default:
      return "Loading data source";
  }
}

export function lookupSourceLabel(value: string) {
  switch (value) {
    case "both_sources":
      return "Official and spreadsheet";
    case "official_lookup":
      return "Official lookup";
    case "old_spreadsheet":
      return "Old spreadsheet";
    default:
      return "Unmatched";
  }
}

export function humanDate(date: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}
