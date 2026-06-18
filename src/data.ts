import type {
  AppData,
  DeepDiveSite,
  Manifest,
  OverviewMetrics,
  SiteDailySummary,
  SourceStatus,
} from "./types";
import { APP_NAME, DATASET_URL, fetchJson, intervalLabels } from "./utils";

const defaultFiles: Manifest["files"] = {
  overview: "data/overview.json",
  dailyVolume: "data/daily-volume.json",
  regionSummary: "data/region-summary.json",
  detectorRegionSummary: "data/detector-region-summary.json",
  siteSummary: "data/site-summary.json",
  siteDailySummary: "data/site-daily-summary.json",
  topSites: "data/top-sites.json",
  qualitySummary: "data/quality-summary.json",
  weekdayWeekend: "data/weekday-weekend.json",
  heatmapGlobal: "data/heatmap-global.json",
  deepDiveIndex: "data/deep-dive-index.json",
};

export function emptyOverview(): OverviewMetrics {
  return {
    rowCount: 0,
    siteCount: 0,
    detectorCount: 0,
    regionCount: 0,
    totalVolume: 0,
    alarmCount: 0,
    zeroVolumeRows: 0,
    incompleteRows: 0,
    negativeTotalRows: 0,
    negativeIntervalRows: 0,
    missingValueRows: 0,
    unusualDailyTotalDays: 0,
    matchedSites: 0,
    unmatchedSites: 0,
    matchRate: 0,
  };
}

export function emptyManifest(status: SourceStatus = "none"): Manifest {
  return {
    generatedAt: new Date().toISOString(),
    appName: APP_NAME,
    datasetUrl: DATASET_URL,
    sourceStatus: status,
    processedFiles: 0,
    rawFileCount: 0,
    dateRange: { start: "", end: "" },
    dates: [],
    regions: [],
    sites: [],
    detectors: [],
    intervalLabels,
    labels: {},
    files: defaultFiles,
    deepDiveSiteCount: 0,
  };
}

export async function loadGeneratedData(): Promise<AppData> {
  const manifest = await fetchJson<Manifest>("data/manifest.json");
  const files = { ...defaultFiles, ...manifest.files };

  const [
    overview,
    dailyVolume,
    regionSummary,
    detectorRegionSummary,
    siteSummary,
    siteDailySummary,
    topSites,
    qualitySummary,
    weekdayWeekend,
    heatmapGlobal,
    deepDiveIndex,
  ] = await Promise.all([
    fetchJson<AppData["overview"]>(files.overview),
    fetchJson<AppData["dailyVolume"]>(files.dailyVolume),
    fetchJson<AppData["regionSummary"]>(files.regionSummary),
    fetchJson<AppData["detectorRegionSummary"]>(files.detectorRegionSummary),
    fetchJson<AppData["siteSummary"]>(files.siteSummary),
    fetchJson<AppData["siteDailySummary"] | PackedRows<SiteDailySummary>>(files.siteDailySummary),
    fetchJson<AppData["topSites"]>(files.topSites),
    fetchJson<AppData["qualitySummary"]>(files.qualitySummary),
    fetchJson<AppData["weekdayWeekend"]>(files.weekdayWeekend),
    fetchJson<AppData["heatmapGlobal"]>(files.heatmapGlobal),
    fetchJson<AppData["deepDiveIndex"]>(files.deepDiveIndex),
  ]);

  return {
    manifest: {
      ...manifest,
      sourceStatus: "generated",
      files,
    },
    overview,
    dailyVolume,
    regionSummary,
    detectorRegionSummary,
    siteSummary,
    siteDailySummary: unpackRows(siteDailySummary),
    topSites,
    qualitySummary,
    weekdayWeekend,
    heatmapGlobal,
    deepDiveIndex,
  };
}

export async function loadDeepDiveSite(file: string): Promise<DeepDiveSite> {
  return fetchJson<DeepDiveSite>(file);
}

interface PackedRows<T> {
  columns: Array<keyof T>;
  rows: unknown[][];
}

function unpackRows<T>(data: T[] | PackedRows<T>): T[] {
  if (Array.isArray(data)) return data;
  return data.rows.map((row) => {
    const output: Record<string, unknown> = {};
    data.columns.forEach((column, index) => {
      output[String(column)] = row[index];
    });
    return output as T;
  });
}
