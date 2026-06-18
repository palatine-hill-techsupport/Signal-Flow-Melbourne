import Papa from "papaparse";
import type {
  AppData,
  DeepDiveRow,
  DailyVolume,
  DetectorRegionSummary,
  HeatmapData,
  Manifest,
  RegionSummary,
  SiteDailySummary,
  SiteSummary,
  TopSite,
  WeekdayWeekendSummary,
} from "./types";
import {
  APP_NAME,
  DATASET_URL,
  aggregateOverview,
  dayType,
  groupByRegion,
  groupWeekdayWeekend,
  intervalLabels,
} from "./utils";

const DATE_COLUMN = "QT_INTERVAL_COUNT";
const SITE_COLUMN = "NB_SCATS_SITE";
const DETECTOR_COLUMN = "NB_DETECTOR";
const REGION_COLUMN = "NM_REGION";
const RECORDS_COLUMN = "CT_RECORDS";
const TOTAL_VOLUME_COLUMN = "QT_VOLUME_24HOUR";
const ALARM_COLUMN = "CT_ALARM_24HOUR";
const INTERVAL_COLUMNS = Array.from({ length: 96 }, (_, index) => `V${String(index).padStart(2, "0")}`);

type CsvRow = Record<string, string | undefined>;

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textValue(value: unknown, fallback = "Unknown") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function parseRowsFromFile(file: File): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    const rows: CsvRow[] = [];
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      worker: true,
      step: (result) => {
        rows.push(result.data);
      },
      complete: () => resolve(rows),
      error: (error) => reject(error),
    });
  });
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string) {
  const existing = map.get(key) ?? new Set<string>();
  existing.add(value);
  map.set(key, existing);
}

function dailyIqrFlags(daily: DailyVolume[]) {
  const values = daily.map((row) => row.totalVolume).sort((a, b) => a - b);
  if (values.length < 4) return new Set<string>();
  const q = (position: number) => {
    const index = (values.length - 1) * position;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return values[lower] * (1 - weight) + values[upper] * weight;
  };
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;
  return new Set(daily.filter((row) => row.totalVolume < low || row.totalVolume > high).map((row) => row.date));
}

export async function buildLocalDataFromFiles(files: File[], knownSites: SiteSummary[] = []): Promise<AppData> {
  const knownSiteMap = new Map(knownSites.map((site) => [site.siteId, site]));
  const sourceRows = (await Promise.all(files.map(parseRowsFromFile))).flat();

  const dates = new Set<string>();
  const regions = new Set<string>();
  const sites = new Set<string>();
  const detectors = new Set<string>();
  const siteDetectorSets = new Map<string, Set<string>>();
  const siteDateSets = new Map<string, Set<string>>();
  const siteRegionSets = new Map<string, Set<string>>();
  const siteDailyMap = new Map<string, SiteDailySummary>();
  const detectorRegionMap = new Map<string, DetectorRegionSummary>();
  const heatmapMap = new Map<string, number[]>();
  const missingColumns = new Map<string, number>();
  const deepDiveRows: DeepDiveRow[] = [];

  for (const row of sourceRows) {
    const date = textValue(row[DATE_COLUMN], "");
    const siteId = textValue(row[SITE_COLUMN], "");
    const detector = textValue(row[DETECTOR_COLUMN], "");
    const region = textValue(row[REGION_COLUMN]);
    if (!date || !siteId || !detector) continue;

    const totalVolume = numberValue(row[TOTAL_VOLUME_COLUMN]);
    const records = numberValue(row[RECORDS_COLUMN]);
    const alarmCount = numberValue(row[ALARM_COLUMN]);
    const intervals = INTERVAL_COLUMNS.map((column) => numberValue(row[column]));
    const hasMissingValue = [
      DATE_COLUMN,
      SITE_COLUMN,
      DETECTOR_COLUMN,
      REGION_COLUMN,
      RECORDS_COLUMN,
      TOTAL_VOLUME_COLUMN,
      ALARM_COLUMN,
      ...INTERVAL_COLUMNS,
    ].some((column) => {
      const missing = row[column] === undefined || row[column] === "";
      if (missing) missingColumns.set(column, (missingColumns.get(column) ?? 0) + 1);
      return missing;
    });
    const hasNegativeInterval = intervals.some((value) => value < 0);

    dates.add(date);
    regions.add(region);
    sites.add(siteId);
    detectors.add(detector);
    addToSetMap(siteDetectorSets, siteId, detector);
    addToSetMap(siteDateSets, siteId, date);
    addToSetMap(siteRegionSets, siteId, region);

    const siteDailyKey = `${date}|${siteId}|${region}`;
    const siteDaily =
      siteDailyMap.get(siteDailyKey) ??
      ({
        date,
        siteId,
        region,
        totalVolume: 0,
        rowCount: 0,
        alarmCount: 0,
        zeroVolumeRows: 0,
        incompleteRows: 0,
        negativeTotalRows: 0,
        negativeIntervalRows: 0,
        missingValueRows: 0,
        recordsTotal: 0,
        detectors: [],
      } satisfies SiteDailySummary);
    siteDaily.totalVolume += totalVolume;
    siteDaily.rowCount += 1;
    siteDaily.alarmCount += alarmCount;
    siteDaily.zeroVolumeRows += totalVolume === 0 ? 1 : 0;
    siteDaily.incompleteRows += records < 96 ? 1 : 0;
    siteDaily.negativeTotalRows += totalVolume < 0 ? 1 : 0;
    siteDaily.negativeIntervalRows += hasNegativeInterval ? 1 : 0;
    siteDaily.missingValueRows += hasMissingValue ? 1 : 0;
    siteDaily.recordsTotal += records;
    siteDaily.detectors = [...new Set([...siteDaily.detectors, detector])];
    siteDailyMap.set(siteDailyKey, siteDaily);

    const detectorRegionKey = `${region}|${detector}`;
    const detectorRegion =
      detectorRegionMap.get(detectorRegionKey) ??
      ({
        region,
        detector,
        totalVolume: 0,
        rowCount: 0,
        averageVolume: 0,
      } satisfies DetectorRegionSummary);
    detectorRegion.totalVolume += totalVolume;
    detectorRegion.rowCount += 1;
    detectorRegion.averageVolume = detectorRegion.totalVolume / Math.max(detectorRegion.rowCount, 1);
    detectorRegionMap.set(detectorRegionKey, detectorRegion);

    const heatmap = heatmapMap.get(date) ?? Array.from({ length: 96 }, () => 0);
    intervals.forEach((value, index) => {
      heatmap[index] += value;
    });
    heatmapMap.set(date, heatmap);

    deepDiveRows.push({
      date,
      siteId,
      detector,
      region,
      totalVolume,
      records,
      alarmCount,
      intervals,
    });
  }

  const siteDailySummary = [...siteDailyMap.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.siteId.localeCompare(b.siteId),
  );
  const preliminaryDaily = [...dates]
    .sort()
    .map((date) => {
      const rows = siteDailySummary.filter((row) => row.date === date);
      return rows.reduce(
        (summary, row) => {
          summary.totalVolume += row.totalVolume;
          summary.rowCount += row.rowCount;
          summary.alarmCount += row.alarmCount;
          summary.zeroVolumeRows += row.zeroVolumeRows;
          summary.incompleteRows += row.incompleteRows;
          summary.negativeTotalRows += row.negativeTotalRows;
          summary.negativeIntervalRows += row.negativeIntervalRows;
          summary.missingValueRows += row.missingValueRows;
          return summary;
        },
        {
          date,
          totalVolume: 0,
          rowCount: 0,
          alarmCount: 0,
          zeroVolumeRows: 0,
          incompleteRows: 0,
          negativeTotalRows: 0,
          negativeIntervalRows: 0,
          missingValueRows: 0,
          unusualDailyTotal: false,
        } satisfies DailyVolume,
      );
    });
  const unusualDates = dailyIqrFlags(preliminaryDaily);
  const dailyVolume = preliminaryDaily.map((row) => ({
    ...row,
    unusualDailyTotal: unusualDates.has(row.date),
  }));

  const siteSummary: SiteSummary[] = [...sites].map((siteId) => {
    const lookup = knownSiteMap.get(siteId);
    const siteRows = siteDailySummary.filter((row) => row.siteId === siteId);
    const totalVolume = siteRows.reduce((sum, row) => sum + row.totalVolume, 0);
    const rowCount = siteRows.reduce((sum, row) => sum + row.rowCount, 0);
    const alarmCount = siteRows.reduce((sum, row) => sum + row.alarmCount, 0);
    return {
      siteId,
      displayName: lookup?.displayName ?? `Site ${siteId}`,
      officialName: lookup?.officialName ?? null,
      spreadsheetName: lookup?.spreadsheetName ?? null,
      municipality: lookup?.municipality ?? null,
      signalType: lookup?.signalType ?? null,
      latitude: lookup?.latitude ?? null,
      longitude: lookup?.longitude ?? null,
      melwayReference: lookup?.melwayReference ?? null,
      lookupSource: lookup?.lookupSource ?? "unmatched",
      confidence: lookup?.confidence ?? "raw_site_id",
      regions: [...(siteRegionSets.get(siteId) ?? new Set<string>())].sort(),
      detectors: [...(siteDetectorSets.get(siteId) ?? new Set<string>())].sort(),
      dates: [...(siteDateSets.get(siteId) ?? new Set<string>())].sort(),
      totalVolume,
      rowCount,
      alarmCount,
      matchedOfficial: lookup?.matchedOfficial ?? false,
      matchedSpreadsheet: lookup?.matchedSpreadsheet ?? false,
      namesAgree: lookup?.namesAgree ?? null,
    };
  });

  const siteMap = new Map(siteSummary.map((site) => [site.siteId, site]));
  const overview = aggregateOverview(siteDailySummary, siteMap);
  overview.unusualDailyTotalDays = unusualDates.size;

  const topSites: TopSite[] = siteSummary
    .map((site) => ({
      siteId: site.siteId,
      displayName: site.displayName,
      region: site.regions[0] ?? "Unknown",
      totalVolume: site.totalVolume,
      rowCount: site.rowCount,
      alarmCount: site.alarmCount,
    }))
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .slice(0, 50);

  const heatmapGlobal: HeatmapData = {
    dates: [...heatmapMap.keys()].sort(),
    intervalLabels,
    values: [...heatmapMap.keys()].sort().map((date) => heatmapMap.get(date) ?? []),
  };

  const weekdayWeekend = groupWeekdayWeekend(dailyVolume) as WeekdayWeekendSummary[];
  const sortedDates = [...dates].sort();
  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    appName: APP_NAME,
    datasetUrl: DATASET_URL,
    sourceStatus: "local-fallback",
    processedFiles: files.length,
    rawFileCount: files.length,
    dateRange: {
      start: sortedDates[0] ?? "",
      end: sortedDates[sortedDates.length - 1] ?? "",
    },
    dates: [...dates].sort(),
    regions: [...regions].sort(),
    sites: [...sites].sort((a, b) => Number(a) - Number(b)),
    detectors: [...detectors].sort((a, b) => Number(a) - Number(b)),
    intervalLabels,
    labels: {},
    files: {
      overview: "",
      dailyVolume: "",
      regionSummary: "",
      detectorRegionSummary: "",
      siteSummary: "",
      siteDailySummary: "",
      topSites: "",
      qualitySummary: "",
      weekdayWeekend: "",
      heatmapGlobal: "",
      deepDiveIndex: "",
    },
    deepDiveSiteCount: sites.size,
  };

  return {
    manifest,
    overview,
    dailyVolume,
    regionSummary: groupByRegion(siteDailySummary) as RegionSummary[],
    detectorRegionSummary: [...detectorRegionMap.values()].sort((a, b) => b.totalVolume - a.totalVolume),
    siteSummary,
    siteDailySummary,
    topSites,
    qualitySummary: {
      totals: overview,
      byDate: dailyVolume,
      missingColumns: [...missingColumns.entries()]
        .map(([column, missingRows]) => ({ column, missingRows }))
        .sort((a, b) => b.missingRows - a.missingRows),
      generatedWarnings: ["Data was parsed in the browser from locally supplied CSV files."],
    },
    weekdayWeekend,
    heatmapGlobal,
    deepDiveIndex: { sites: [] },
    localDeepDiveRows: deepDiveRows,
  };
}
