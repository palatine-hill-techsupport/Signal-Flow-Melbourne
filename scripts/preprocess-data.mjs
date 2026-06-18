#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseStream } from "csv-parse";
import { parse as parseSync } from "csv-parse/sync";
import xlsx from "@e965/xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const DATASET_URL = "https://opendata.transport.vic.gov.au/dataset/traffic-signal-volume-data";
const APP_NAME = "Signal Flow Melbourne";
const DATE_COLUMN = "QT_INTERVAL_COUNT";
const SITE_COLUMN = "NB_SCATS_SITE";
const DETECTOR_COLUMN = "NB_DETECTOR";
const REGION_COLUMN = "NM_REGION";
const RECORDS_COLUMN = "CT_RECORDS";
const TOTAL_VOLUME_COLUMN = "QT_VOLUME_24HOUR";
const ALARM_COLUMN = "CT_ALARM_24HOUR";
const INTERVAL_COLUMNS = Array.from({ length: 96 }, (_, index) => `V${String(index).padStart(2, "0")}`);
const KEY_COLUMNS = [
  DATE_COLUMN,
  SITE_COLUMN,
  DETECTOR_COLUMN,
  REGION_COLUMN,
  RECORDS_COLUMN,
  TOTAL_VOLUME_COLUMN,
  ALARM_COLUMN,
  ...INTERVAL_COLUMNS,
];

const LABELS = {
  QT_VOLUME_24HOUR: "Total 24-hour volume",
  CT_RECORDS: "Complete 15-minute records",
  CT_ALARM_24HOUR: "Alarm count",
  NB_SCATS_SITE: "SCATS site",
  NB_DETECTOR: "Detector",
  NM_REGION: "Region",
  "V00-V95": "15-minute interval volumes",
};

const intervalLabels = Array.from({ length: 96 }, (_, index) => {
  const startMinutes = index * 15;
  const endMinutes = (index + 1) * 15;
  const start = `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(
    startMinutes % 60,
  ).padStart(2, "0")}`;
  const end =
    endMinutes >= 24 * 60
      ? "00:00"
      : `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
  return `${start}-${end}`;
});

function argValue(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function normaliseSiteId(value) {
  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!text || ["nan", "none", "null", "<na>"].includes(text.toLowerCase())) return "";
  if (/^\d+(\.0+)?$/.test(text)) return String(Number.parseInt(text, 10));
  return text.toUpperCase();
}

function normaliseColumnName(column) {
  return String(column ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-/]+/g, "_")
    .replace(/[^a-z0-9_]+/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function cleanText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text || ["nan", "none", "null", "<na>"].includes(text.toLowerCase())) return null;
  return text;
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const clean = cleanText(value);
    if (clean) return clean;
  }
  return null;
}

function naturalSort(values) {
  return [...values].sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return String(a).localeCompare(String(b));
  });
}

function csvDate(pathName) {
  const match = path.basename(pathName).match(/VSDATA_(\d{8})\.csv$/i);
  if (!match) return null;
  return `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}`;
}

function addToSetMap(map, key, value) {
  const existing = map.get(key) ?? new Set();
  existing.add(value);
  map.set(key, existing);
}

function addMetric(target, row) {
  target.totalVolume += row.totalVolume;
  target.rowCount += row.rowCount;
  target.alarmCount += row.alarmCount;
  target.zeroVolumeRows += row.zeroVolumeRows;
  target.incompleteRows += row.incompleteRows;
  target.negativeTotalRows += row.negativeTotalRows;
  target.negativeIntervalRows += row.negativeIntervalRows;
  target.missingValueRows += row.missingValueRows;
  target.recordsTotal += row.recordsTotal;
}

function blankMetric() {
  return {
    totalVolume: 0,
    rowCount: 0,
    alarmCount: 0,
    zeroVolumeRows: 0,
    incompleteRows: 0,
    negativeTotalRows: 0,
    negativeIntervalRows: 0,
    missingValueRows: 0,
    recordsTotal: 0,
  };
}

async function findRawCsvFiles(dataDir) {
  const entries = await readdir(dataDir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^VSDATA_\d{8}\.csv$/i.test(entry.name)) continue;
    const filePath = path.join(dataDir, entry.name);
    const fileStat = await stat(filePath);
    files.push({ path: filePath, date: csvDate(entry.name), size: fileStat.size });
  }
  return files.filter((file) => file.date).sort((a, b) => a.date.localeCompare(b.date));
}

function selectedFilesFromArgs(files) {
  const from = argValue("--from");
  const to = argValue("--to");
  const all = hasArg("--all");
  const days = Number(argValue("--days", process.env.SIGNAL_FLOW_DAYS ?? "14"));
  let selected = files;
  if (from) selected = selected.filter((file) => file.date >= from);
  if (to) selected = selected.filter((file) => file.date <= to);
  if (!all && !from && !to) selected = selected.slice(Math.max(selected.length - days, 0));
  return selected;
}

async function loadLookupCsv(filePath) {
  const text = await readFile(filePath, "utf8");
  const rows = parseSync(text, { columns: true, skip_empty_lines: true, relax_column_count: true });
  return rows.map((row) => {
    const normalised = {};
    for (const [key, value] of Object.entries(row)) {
      normalised[normaliseColumnName(key)] = value;
    }
    return normalised;
  });
}

function detectColumn(columns, aliases, contains = []) {
  for (const alias of aliases) {
    if (columns.includes(alias)) return alias;
  }
  return columns.find((column) => contains.some((token) => column.includes(token))) ?? null;
}

function collectOfficialRows(rows, sourceName) {
  const siteColumn = detectColumn(Object.keys(rows[0] ?? {}), [
    "site_no",
    "site_number",
    "site_id",
    "nb_scats_site",
    "scats_site",
  ]);
  if (!siteColumn) return new Map();
  const nameColumn = detectColumn(Object.keys(rows[0] ?? {}), ["site_name", "site_description", "location"], [
    "site_name",
    "intersection",
    "location",
  ]);
  const municipalityColumn = detectColumn(Object.keys(rows[0] ?? {}), ["municipality", "lga"], ["municip"]);
  const typeColumn = detectColumn(Object.keys(rows[0] ?? {}), ["type", "signal_type"], ["type"]);
  const latitudeColumn = detectColumn(Object.keys(rows[0] ?? {}), ["latitude", "lat", "y"], ["latitude"]);
  const longitudeColumn = detectColumn(Object.keys(rows[0] ?? {}), ["longitude", "lon", "lng", "x"], ["longitude"]);
  const lookup = new Map();
  for (const row of rows) {
    const siteId = normaliseSiteId(row[siteColumn]);
    if (!siteId) continue;
    if (!lookup.has(siteId)) {
      lookup.set(siteId, {
        siteId,
        officialName: cleanText(nameColumn ? row[nameColumn] : null),
        municipality: cleanText(municipalityColumn ? row[municipalityColumn] : null),
        signalType: cleanText(typeColumn ? row[typeColumn] : null),
        latitude: latitudeColumn ? numberValue(row[latitudeColumn]) || null : null,
        longitude: longitudeColumn ? numberValue(row[longitudeColumn]) || null : null,
        sourceFile: sourceName,
        matchedOfficial: true,
      });
    }
  }
  return lookup;
}

async function loadOfficialLookup(dataDir) {
  const entries = await readdir(dataDir, { withFileTypes: true }).catch(() => []);
  const lookup = new Map();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".csv") || entry.name.startsWith("VSDATA_")) continue;
    const rows = await loadLookupCsv(path.join(dataDir, entry.name)).catch(() => []);
    if (!rows.length) continue;
    const parsed = collectOfficialRows(rows, entry.name);
    for (const [siteId, row] of parsed) lookup.set(siteId, row);
  }
  return lookup;
}

function rowsFromWorksheet(sheet) {
  const table = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  let headerIndex = table.findIndex((row) =>
    row.some((cell) => ["site_no", "site_number", "scats_site", "nb_scats_site"].includes(normaliseColumnName(cell))),
  );
  if (headerIndex === -1) {
    headerIndex = table.findIndex((row) =>
      row.some((cell) => {
        const column = normaliseColumnName(cell);
        return column.includes("site") && (column.includes("no") || column.includes("number"));
      }),
    );
  }
  if (headerIndex === -1) return [];
  const headers = table[headerIndex].map(normaliseColumnName);
  return table.slice(headerIndex + 1).map((row) => {
    const output = {};
    headers.forEach((header, index) => {
      if (header) output[header] = row[index];
    });
    return output;
  });
}

async function loadSpreadsheetLookup(dataDir) {
  const spreadsheetPath = path.join(dataDir, "SCATSSiteListingSpreadsheet.xls");
  const workbook = xlsx.readFile(spreadsheetPath, { cellDates: false });
  const lookup = new Map();
  for (const sheetName of workbook.SheetNames) {
    const rows = rowsFromWorksheet(workbook.Sheets[sheetName]);
    if (!rows.length) continue;
    const columns = Object.keys(rows[0]);
    const siteColumn = detectColumn(columns, ["site_no", "site_number", "site_id", "scats_site"], ["site"]);
    const nameColumn = detectColumn(columns, ["site_name", "location", "site_description", "intersection"], [
      "location",
      "intersection",
      "road",
    ]);
    const municipalityColumn = detectColumn(columns, ["municipality", "lga"], ["municip"]);
    const typeColumn = detectColumn(columns, ["type", "signal_type"], ["type"]);
    const latitudeColumn = detectColumn(columns, ["latitude", "lat", "y"], ["latitude"]);
    const longitudeColumn = detectColumn(columns, ["longitude", "lon", "lng", "x"], ["longitude"]);
    const melwayColumn = detectColumn(columns, ["melway_reference", "melway_ref", "melway"], ["melway"]);
    if (!siteColumn) continue;
    for (const row of rows) {
      const siteId = normaliseSiteId(row[siteColumn]);
      if (!siteId || lookup.has(siteId)) continue;
      lookup.set(siteId, {
        siteId,
        spreadsheetName: cleanText(nameColumn ? row[nameColumn] : null),
        municipality: cleanText(municipalityColumn ? row[municipalityColumn] : null),
        signalType: cleanText(typeColumn ? row[typeColumn] : null),
        latitude: latitudeColumn ? numberValue(row[latitudeColumn]) || null : null,
        longitude: longitudeColumn ? numberValue(row[longitudeColumn]) || null : null,
        melwayReference: cleanText(melwayColumn ? row[melwayColumn] : null),
        sourceSheet: sheetName,
        matchedSpreadsheet: true,
      });
    }
  }
  return lookup;
}

async function loadLookups(dataDir) {
  const [official, spreadsheet] = await Promise.all([
    loadOfficialLookup(dataDir),
    loadSpreadsheetLookup(dataDir).catch(() => new Map()),
  ]);
  return { official, spreadsheet };
}

function locationNamesAgree(officialName, spreadsheetName) {
  if (!officialName || !spreadsheetName) return null;
  const clean = (value) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\b(and|at|of|the|road|rd|street|st|avenue|ave|highway|hwy)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const left = clean(officialName);
  const right = clean(spreadsheetName);
  if (!left || !right) return null;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const leftWords = new Set(left.split(" "));
  const rightWords = new Set(right.split(" "));
  const overlap = [...leftWords].filter((word) => rightWords.has(word)).length;
  return overlap / Math.max(Math.min(leftWords.size, rightWords.size), 1) >= 0.5;
}

function makeDisplayName(siteId, official, spreadsheet, municipality) {
  const name = firstNonEmpty(official?.officialName, spreadsheet?.spreadsheetName);
  const muni = cleanText(municipality);
  if (name && muni) return `Site ${siteId} - ${name}, ${muni}`;
  if (name) return `Site ${siteId} - ${name}`;
  return `Site ${siteId}`;
}

function createContext() {
  return {
    dates: new Set(),
    regions: new Set(),
    sites: new Set(),
    detectors: new Set(),
    siteDaily: new Map(),
    siteMetrics: new Map(),
    detectorRegion: new Map(),
    daily: new Map(),
    heatmap: new Map(),
    missingColumns: new Map(),
    warnings: [],
  };
}

function processSummaryRow(row, context, fallbackDate = null) {
  const date = cleanText(row[DATE_COLUMN]) ?? fallbackDate;
  const siteId = normaliseSiteId(row[SITE_COLUMN]);
  const detector = cleanText(row[DETECTOR_COLUMN]);
  const region = cleanText(row[REGION_COLUMN]) ?? "Unknown";
  if (!date || !siteId || !detector) return;

  const totalVolume = numberValue(row[TOTAL_VOLUME_COLUMN]);
  const records = numberValue(row[RECORDS_COLUMN]);
  const alarmCount = numberValue(row[ALARM_COLUMN]);
  const intervals = INTERVAL_COLUMNS.map((column) => numberValue(row[column]));
  let hasMissingValue = false;
  for (const column of KEY_COLUMNS) {
    if (row[column] === undefined || row[column] === "") {
      context.missingColumns.set(column, (context.missingColumns.get(column) ?? 0) + 1);
      hasMissingValue = true;
    }
  }
  const hasNegativeInterval = intervals.some((value) => value < 0);
  const metric = {
    totalVolume,
    rowCount: 1,
    alarmCount,
    zeroVolumeRows: totalVolume === 0 ? 1 : 0,
    incompleteRows: records < 96 ? 1 : 0,
    negativeTotalRows: totalVolume < 0 ? 1 : 0,
    negativeIntervalRows: hasNegativeInterval ? 1 : 0,
    missingValueRows: hasMissingValue ? 1 : 0,
    recordsTotal: records,
  };

  context.dates.add(date);
  context.regions.add(region);
  context.sites.add(siteId);
  context.detectors.add(detector);

  const siteDailyKey = `${date}|${siteId}|${region}`;
  const siteDaily =
    context.siteDaily.get(siteDailyKey) ??
    ({
      date,
      siteId,
      region,
      ...blankMetric(),
      detectors: new Set(),
    });
  addMetric(siteDaily, metric);
  siteDaily.detectors.add(detector);
  context.siteDaily.set(siteDailyKey, siteDaily);

  const siteMetric =
    context.siteMetrics.get(siteId) ??
    ({
      siteId,
      ...blankMetric(),
      regions: new Set(),
      detectors: new Set(),
      dates: new Set(),
    });
  addMetric(siteMetric, metric);
  siteMetric.regions.add(region);
  siteMetric.detectors.add(detector);
  siteMetric.dates.add(date);
  context.siteMetrics.set(siteId, siteMetric);

  const detectorRegionKey = `${region}|${detector}`;
  const detectorRegion =
    context.detectorRegion.get(detectorRegionKey) ??
    ({
      region,
      detector,
      totalVolume: 0,
      rowCount: 0,
      averageVolume: 0,
    });
  detectorRegion.totalVolume += totalVolume;
  detectorRegion.rowCount += 1;
  detectorRegion.averageVolume = detectorRegion.totalVolume / Math.max(detectorRegion.rowCount, 1);
  context.detectorRegion.set(detectorRegionKey, detectorRegion);

  const daily =
    context.daily.get(date) ??
    ({
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
    });
  daily.totalVolume += totalVolume;
  daily.rowCount += 1;
  daily.alarmCount += alarmCount;
  daily.zeroVolumeRows += metric.zeroVolumeRows;
  daily.incompleteRows += metric.incompleteRows;
  daily.negativeTotalRows += metric.negativeTotalRows;
  daily.negativeIntervalRows += metric.negativeIntervalRows;
  daily.missingValueRows += metric.missingValueRows;
  context.daily.set(date, daily);

  const heatmap = context.heatmap.get(date) ?? Array.from({ length: 96 }, () => 0);
  intervals.forEach((value, index) => {
    heatmap[index] += value;
  });
  context.heatmap.set(date, heatmap);
}

async function streamCsv(filePath, onRow) {
  await new Promise((resolve, reject) => {
    createReadStream(filePath)
      .pipe(parseStream({ columns: true, skip_empty_lines: true, relax_column_count: true }))
      .on("data", onRow)
      .on("error", reject)
      .on("end", resolve);
  });
}

function iqrOutlierDates(daily) {
  const values = daily.map((row) => row.totalVolume).sort((a, b) => a - b);
  if (values.length < 4) return new Set();
  const quantile = (position) => {
    const index = (values.length - 1) * position;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return values[lower] * (1 - weight) + values[upper] * weight;
  };
  const q1 = quantile(0.25);
  const q3 = quantile(0.75);
  const iqr = q3 - q1;
  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;
  return new Set(daily.filter((row) => row.totalVolume < low || row.totalVolume > high).map((row) => row.date));
}

function groupRegions(siteDaily) {
  const regionMap = new Map();
  for (const row of siteDaily) {
    const region =
      regionMap.get(row.region) ??
      ({
        region: row.region,
        totalVolume: 0,
        rowCount: 0,
        alarmCount: 0,
        siteIds: new Set(),
        detectors: new Set(),
        recordsTotal: 0,
      });
    region.totalVolume += row.totalVolume;
    region.rowCount += row.rowCount;
    region.alarmCount += row.alarmCount;
    region.recordsTotal += row.recordsTotal;
    region.siteIds.add(row.siteId);
    row.detectors.forEach((detector) => region.detectors.add(detector));
    regionMap.set(row.region, region);
  }
  return [...regionMap.values()]
    .map((row) => ({
      region: row.region,
      totalVolume: row.totalVolume,
      rowCount: row.rowCount,
      alarmCount: row.alarmCount,
      siteCount: row.siteIds.size,
      detectorCount: row.detectors.size,
      averageDetectorVolume: row.detectors.size ? row.totalVolume / row.detectors.size : 0,
      completeRecordRate: row.rowCount ? row.recordsTotal / (row.rowCount * 96) : 0,
    }))
    .sort((a, b) => b.totalVolume - a.totalVolume);
}

function overviewFrom(siteDaily, siteSummary, unusualDailyTotalDays) {
  const siteIds = new Set();
  const detectors = new Set();
  const regions = new Set();
  const summary = {
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
    unusualDailyTotalDays,
    matchedSites: 0,
    unmatchedSites: 0,
    matchRate: 0,
  };
  for (const row of siteDaily) {
    summary.rowCount += row.rowCount;
    summary.totalVolume += row.totalVolume;
    summary.alarmCount += row.alarmCount;
    summary.zeroVolumeRows += row.zeroVolumeRows;
    summary.incompleteRows += row.incompleteRows;
    summary.negativeTotalRows += row.negativeTotalRows;
    summary.negativeIntervalRows += row.negativeIntervalRows;
    summary.missingValueRows += row.missingValueRows;
    siteIds.add(row.siteId);
    regions.add(row.region);
    row.detectors.forEach((detector) => detectors.add(detector));
  }
  const siteMap = new Map(siteSummary.map((site) => [site.siteId, site]));
  for (const siteId of siteIds) {
    const site = siteMap.get(siteId);
    if (site && site.lookupSource !== "unmatched") summary.matchedSites += 1;
    else summary.unmatchedSites += 1;
  }
  summary.siteCount = siteIds.size;
  summary.detectorCount = detectors.size;
  summary.regionCount = regions.size;
  summary.matchRate = summary.siteCount ? summary.matchedSites / summary.siteCount : 0;
  return summary;
}

function buildSiteSummary(context, lookups) {
  return naturalSort(context.sites).map((siteId) => {
    const official = lookups.official.get(siteId);
    const spreadsheet = lookups.spreadsheet.get(siteId);
    const metric = context.siteMetrics.get(siteId) ?? {
      totalVolume: 0,
      rowCount: 0,
      alarmCount: 0,
      regions: new Set(),
      detectors: new Set(),
      dates: new Set(),
    };
    const municipality = firstNonEmpty(official?.municipality, spreadsheet?.municipality);
    const lookupSource =
      official && spreadsheet ? "both_sources" : official ? "official_lookup" : spreadsheet ? "old_spreadsheet" : "unmatched";
    return {
      siteId,
      displayName: makeDisplayName(siteId, official, spreadsheet, municipality),
      officialName: official?.officialName ?? null,
      spreadsheetName: spreadsheet?.spreadsheetName ?? null,
      municipality,
      signalType: firstNonEmpty(official?.signalType, spreadsheet?.signalType),
      latitude: official?.latitude ?? spreadsheet?.latitude ?? null,
      longitude: official?.longitude ?? spreadsheet?.longitude ?? null,
      melwayReference: spreadsheet?.melwayReference ?? null,
      lookupSource,
      confidence: official ? "high" : spreadsheet ? "medium" : "raw_site_id",
      regions: naturalSort(metric.regions ?? []),
      detectors: naturalSort(metric.detectors ?? []),
      dates: naturalSort(metric.dates ?? []),
      totalVolume: metric.totalVolume ?? 0,
      rowCount: metric.rowCount ?? 0,
      alarmCount: metric.alarmCount ?? 0,
      matchedOfficial: Boolean(official),
      matchedSpreadsheet: Boolean(spreadsheet),
      namesAgree: locationNamesAgree(official?.officialName, spreadsheet?.spreadsheetName),
    };
  });
}

function serialiseSiteDaily(context) {
  return [...context.siteDaily.values()]
    .map((row) => ({
      ...row,
      detectors: naturalSort(row.detectors),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.siteId.localeCompare(b.siteId));
}

function groupWeekdayWeekend(daily) {
  const grouped = new Map();
  for (const row of daily) {
    const day = new Date(`${row.date}T00:00:00`).getDay();
    const dayType = day === 0 || day === 6 ? "Weekend" : "Weekday";
    const existing = grouped.get(dayType) ?? { dayType, totalVolume: 0, dateCount: 0 };
    existing.totalVolume += row.totalVolume;
    existing.dateCount += 1;
    grouped.set(dayType, existing);
  }
  return [...grouped.values()].map((row) => ({
    ...row,
    averageDailyVolume: row.dateCount ? row.totalVolume / row.dateCount : 0,
  }));
}

function safeSiteFileName(siteId) {
  return `site-${String(siteId).replace(/[^a-z0-9_-]+/gi, "_")}.json`;
}

async function collectDeepDiveRows(files, siteSummary, outputDir, limit) {
  const deepDiveDir = path.join(outputDir, "deep-dive");
  await mkdir(deepDiveDir, { recursive: true });
  const selectedSites = new Set(siteSummary.slice(0, limit).map((site) => site.siteId));
  const rowsBySite = new Map();
  for (const file of files) {
    await streamCsv(file.path, (row) => {
      const siteId = normaliseSiteId(row[SITE_COLUMN]);
      if (!selectedSites.has(siteId)) return;
      const date = cleanText(row[DATE_COLUMN]) ?? file.date;
      const detector = cleanText(row[DETECTOR_COLUMN]);
      if (!date || !detector) return;
      const intervals = INTERVAL_COLUMNS.map((column) => numberValue(row[column]));
      const siteRows = rowsBySite.get(siteId) ?? [];
      siteRows.push({
        date,
        siteId,
        detector,
        region: cleanText(row[REGION_COLUMN]) ?? "Unknown",
        totalVolume: numberValue(row[TOTAL_VOLUME_COLUMN]),
        records: numberValue(row[RECORDS_COLUMN]),
        alarmCount: numberValue(row[ALARM_COLUMN]),
        intervals,
      });
      rowsBySite.set(siteId, siteRows);
    });
  }

  const index = [];
  const siteMap = new Map(siteSummary.map((site) => [site.siteId, site]));
  for (const [siteId, rows] of rowsBySite) {
    const site = siteMap.get(siteId);
    const fileName = safeSiteFileName(siteId);
    await writeJson(path.join(deepDiveDir, fileName), {
      siteId,
      displayName: site?.displayName ?? `Site ${siteId}`,
      rows: rows.sort((a, b) => a.date.localeCompare(b.date) || String(a.detector).localeCompare(String(b.detector))),
    });
    index.push({
      siteId,
      displayName: site?.displayName ?? `Site ${siteId}`,
      region: site?.regions?.[0] ?? "Unknown",
      file: `data/deep-dive/${fileName}`,
      totalVolume: site?.totalVolume ?? 0,
    });
  }
  return { sites: index.sort((a, b) => b.totalVolume - a.totalVolume) };
}

async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data)}\n`, "utf8");
}

function packRows(rows, columns) {
  return {
    columns,
    rows: rows.map((row) => columns.map((column) => row[column])),
  };
}

async function main() {
  const dataDir = path.resolve(rootDir, argValue("--data", "data"));
  const outputDir = path.resolve(rootDir, argValue("--out", "public/data"));
  const deepSiteLimit = Number(argValue("--deep-sites", process.env.SIGNAL_FLOW_DEEP_SITES ?? "60"));
  const rawFiles = await findRawCsvFiles(dataDir);
  const selectedFiles = selectedFilesFromArgs(rawFiles);
  if (!selectedFiles.length) {
    throw new Error(`No VSDATA_*.csv files found in ${dataDir}`);
  }

  console.log(`Preparing ${APP_NAME} data`);
  console.log(`Raw files found: ${rawFiles.length}`);
  console.log(`Files selected: ${selectedFiles.length} (${selectedFiles[0].date} to ${selectedFiles[selectedFiles.length - 1].date})`);

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const lookups = await loadLookups(dataDir);
  console.log(`Lookup rows: official ${lookups.official.size}, spreadsheet ${lookups.spreadsheet.size}`);

  const context = createContext();
  for (const file of selectedFiles) {
    console.log(`Processing ${path.basename(file.path)}`);
    await streamCsv(file.path, (row) => processSummaryRow(row, context, file.date));
  }

  const siteDailySummary = serialiseSiteDaily(context);
  const dailyVolume = [...context.daily.values()].sort((a, b) => a.date.localeCompare(b.date));
  const unusualDates = iqrOutlierDates(dailyVolume);
  dailyVolume.forEach((row) => {
    row.unusualDailyTotal = unusualDates.has(row.date);
  });

  const siteSummary = buildSiteSummary(context, lookups);
  const topSites = [...siteSummary]
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .slice(0, 50)
    .map((site) => ({
      siteId: site.siteId,
      displayName: site.displayName,
      region: site.regions[0] ?? "Unknown",
      totalVolume: site.totalVolume,
      rowCount: site.rowCount,
      alarmCount: site.alarmCount,
    }));
  const overview = overviewFrom(siteDailySummary, siteSummary, unusualDates.size);
  const regionSummary = groupRegions(siteDailySummary);
  const detectorRegionSummary = [...context.detectorRegion.values()].sort((a, b) => b.totalVolume - a.totalVolume);
  const heatmapDates = naturalSort(context.heatmap.keys());
  const heatmapGlobal = {
    dates: heatmapDates,
    intervalLabels,
    values: heatmapDates.map((date) => context.heatmap.get(date)),
  };
  const weekdayWeekend = groupWeekdayWeekend(dailyVolume);
  const missingColumns = [...context.missingColumns.entries()]
    .map(([column, missingRows]) => ({ column, missingRows }))
    .sort((a, b) => b.missingRows - a.missingRows);
  const generatedWarnings = [];
  if (selectedFiles.length < rawFiles.length) {
    generatedWarnings.push(
      `Generated data covers ${selectedFiles.length} of ${rawFiles.length} local daily CSV files. Re-run with --all or --days N to change the window.`,
    );
  }
  const qualitySummary = {
    totals: overview,
    byDate: dailyVolume,
    missingColumns,
    generatedWarnings,
  };

  const deepDiveIndex = await collectDeepDiveRows(
    selectedFiles,
    [...siteSummary].sort((a, b) => b.totalVolume - a.totalVolume),
    outputDir,
    deepSiteLimit,
  );

  const files = {
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
  const sortedDates = naturalSort(context.dates);
  const manifest = {
    generatedAt: new Date().toISOString(),
    appName: APP_NAME,
    datasetUrl: DATASET_URL,
    sourceStatus: "generated",
    processedFiles: selectedFiles.length,
    rawFileCount: rawFiles.length,
    dateRange: {
      start: sortedDates[0],
      end: sortedDates[sortedDates.length - 1],
    },
    dates: sortedDates,
    regions: naturalSort(context.regions),
    sites: naturalSort(context.sites),
    detectors: naturalSort(context.detectors),
    intervalLabels,
    labels: LABELS,
    files,
    deepDiveSiteCount: deepDiveIndex.sites.length,
  };

  await Promise.all([
    writeJson(path.join(outputDir, "manifest.json"), manifest),
    writeJson(path.join(outputDir, "overview.json"), overview),
    writeJson(path.join(outputDir, "daily-volume.json"), dailyVolume),
    writeJson(path.join(outputDir, "region-summary.json"), regionSummary),
    writeJson(path.join(outputDir, "detector-region-summary.json"), detectorRegionSummary),
    writeJson(path.join(outputDir, "site-summary.json"), siteSummary),
    writeJson(
      path.join(outputDir, "site-daily-summary.json"),
      packRows(siteDailySummary, [
        "date",
        "siteId",
        "region",
        "totalVolume",
        "rowCount",
        "alarmCount",
        "zeroVolumeRows",
        "incompleteRows",
        "negativeTotalRows",
        "negativeIntervalRows",
        "missingValueRows",
        "recordsTotal",
        "detectors",
      ]),
    ),
    writeJson(path.join(outputDir, "top-sites.json"), topSites),
    writeJson(path.join(outputDir, "quality-summary.json"), qualitySummary),
    writeJson(path.join(outputDir, "weekday-weekend.json"), weekdayWeekend),
    writeJson(path.join(outputDir, "heatmap-global.json"), heatmapGlobal),
    writeJson(path.join(outputDir, "deep-dive-index.json"), deepDiveIndex),
  ]);

  console.log(`Wrote static app data to ${path.relative(rootDir, outputDir)}`);
  console.log(`Rows summarised: ${overview.rowCount.toLocaleString("en-AU")}`);
  console.log(`Sites: ${overview.siteCount.toLocaleString("en-AU")}`);
  console.log(`Deep-dive site files: ${deepDiveIndex.sites.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
