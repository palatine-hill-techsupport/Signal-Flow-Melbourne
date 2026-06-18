export type SourceStatus =
  | "loading"
  | "live"
  | "generated"
  | "local-fallback"
  | "none"
  | "error";

export type ThemeName = "light" | "dark";

export type TabName =
  | "Overview"
  | "Site locations"
  | "Data quality"
  | "Traffic patterns"
  | "Site deep dive"
  | "Exports";

export interface Manifest {
  generatedAt: string;
  appName: string;
  datasetUrl: string;
  sourceStatus: SourceStatus;
  processedFiles: number;
  rawFileCount: number;
  dateRange: {
    start: string;
    end: string;
  };
  dates: string[];
  regions: string[];
  sites: string[];
  detectors: string[];
  intervalLabels: string[];
  labels: Record<string, string>;
  files: {
    overview: string;
    dailyVolume: string;
    regionSummary: string;
    detectorRegionSummary: string;
    siteSummary: string;
    siteDailySummary: string;
    topSites: string;
    qualitySummary: string;
    weekdayWeekend: string;
    heatmapGlobal: string;
    deepDiveIndex: string;
  };
  deepDiveSiteCount: number;
}

export interface OverviewMetrics {
  rowCount: number;
  siteCount: number;
  detectorCount: number;
  regionCount: number;
  totalVolume: number;
  alarmCount: number;
  zeroVolumeRows: number;
  incompleteRows: number;
  negativeTotalRows: number;
  negativeIntervalRows: number;
  missingValueRows: number;
  unusualDailyTotalDays: number;
  matchedSites: number;
  unmatchedSites: number;
  matchRate: number;
}

export interface DailyVolume {
  date: string;
  totalVolume: number;
  rowCount: number;
  alarmCount: number;
  zeroVolumeRows: number;
  incompleteRows: number;
  negativeTotalRows: number;
  negativeIntervalRows: number;
  missingValueRows: number;
  unusualDailyTotal: boolean;
}

export interface RegionSummary {
  region: string;
  totalVolume: number;
  rowCount: number;
  alarmCount: number;
  siteCount: number;
  detectorCount: number;
  averageDetectorVolume: number;
  completeRecordRate: number;
}

export interface DetectorRegionSummary {
  region: string;
  detector: string;
  totalVolume: number;
  rowCount: number;
  averageVolume: number;
}

export interface SiteSummary {
  siteId: string;
  displayName: string;
  officialName?: string | null;
  spreadsheetName?: string | null;
  municipality?: string | null;
  signalType?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  melwayReference?: string | null;
  lookupSource: "both_sources" | "official_lookup" | "old_spreadsheet" | "unmatched";
  confidence: "high" | "medium" | "raw_site_id";
  regions: string[];
  detectors: string[];
  dates: string[];
  totalVolume: number;
  rowCount: number;
  alarmCount: number;
  matchedOfficial: boolean;
  matchedSpreadsheet: boolean;
  namesAgree?: boolean | null;
}

export interface SiteDailySummary {
  date: string;
  siteId: string;
  region: string;
  totalVolume: number;
  rowCount: number;
  alarmCount: number;
  zeroVolumeRows: number;
  incompleteRows: number;
  negativeTotalRows: number;
  negativeIntervalRows: number;
  missingValueRows: number;
  recordsTotal: number;
  detectors: string[];
}

export interface TopSite {
  siteId: string;
  displayName: string;
  region: string;
  totalVolume: number;
  rowCount: number;
  alarmCount: number;
}

export interface QualitySummary {
  totals: OverviewMetrics;
  byDate: DailyVolume[];
  missingColumns: Array<{ column: string; missingRows: number }>;
  generatedWarnings: string[];
}

export interface WeekdayWeekendSummary {
  dayType: "Weekday" | "Weekend";
  totalVolume: number;
  averageDailyVolume: number;
  dateCount: number;
}

export interface HeatmapData {
  dates: string[];
  intervalLabels: string[];
  values: number[][];
}

export interface DeepDiveIndex {
  sites: Array<{
    siteId: string;
    displayName: string;
    region: string;
    file: string;
    totalVolume: number;
  }>;
}

export interface DeepDiveRow {
  date: string;
  siteId: string;
  detector: string;
  region: string;
  totalVolume: number;
  records: number;
  alarmCount: number;
  intervals: number[];
}

export interface DeepDiveSite {
  siteId: string;
  displayName: string;
  rows: DeepDiveRow[];
}

export interface AppData {
  manifest: Manifest;
  overview: OverviewMetrics;
  dailyVolume: DailyVolume[];
  regionSummary: RegionSummary[];
  detectorRegionSummary: DetectorRegionSummary[];
  siteSummary: SiteSummary[];
  siteDailySummary: SiteDailySummary[];
  topSites: TopSite[];
  qualitySummary: QualitySummary;
  weekdayWeekend: WeekdayWeekendSummary[];
  heatmapGlobal: HeatmapData;
  deepDiveIndex: DeepDiveIndex;
  localDeepDiveRows?: DeepDiveRow[];
}

export interface Filters {
  startDate: string;
  endDate: string;
  region: string;
  siteId: string;
  detector: string;
  search: string;
  includeZeroVolume: boolean;
  includeIncomplete: boolean;
  includeAlarmRows: boolean;
  requireCoordinates: boolean;
}
