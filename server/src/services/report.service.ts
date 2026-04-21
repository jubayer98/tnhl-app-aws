import fs from 'fs';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import {
  AWS_REGION,
  DEFAULT_MARKER_ORDER,
  PREDICTION_PREFERRED_ORDER,
  REPORT_ASSET_BASE_URL,
  REPORT_ASSET_ROUTE,
  REPORT_ASSET_S3_BUCKET,
  REPORT_ASSET_S3_PREFIX,
  REPORT_SOURCE_CONFIG,
  REPORT_TYPES,
  ReportType,
  getReportImagesRoot,
  getSampleAssetDirectory,
  getSampleAssetFolder,
  isReportType,
} from '../config';
import {
  MarkerTile,
  ReportCatalogData,
  ReportTypeCatalog,
  ReportOption,
  ReportSampleData,
} from '../models';

const HUMAN_LABEL_OVERRIDES: Record<string, string> = {
  dapi: 'DAPI',
  pax5: 'PAX5',
  nk_cd56: 'NK_CD56',
  nk_cd57: 'NK_CD57',
  vascular_cd31: 'Vascular_CD31',
  vascular_cd34: 'Vascular_CD34',
};

let reportAssetS3Client: S3Client | null = null;

function shouldUseS3ForReportAssets(): boolean {
  return Boolean(REPORT_ASSET_BASE_URL);
}

function getReportAssetS3Client(): S3Client {
  if (!AWS_REGION) {
    throw new Error('AWS_REGION must be set for S3 report asset mode.');
  }
  if (!REPORT_ASSET_S3_BUCKET) {
    throw new Error('REPORT_ASSET_S3_BUCKET or AWS_S3_BUCKET must be set for S3 report asset mode.');
  }

  if (!reportAssetS3Client) {
    reportAssetS3Client = new S3Client({ region: AWS_REGION });
  }

  return reportAssetS3Client;
}

function getReportTypePrefix(reportType: ReportType): string {
  return REPORT_ASSET_S3_PREFIX
    ? `${REPORT_ASSET_S3_PREFIX}/${reportType}/images/`
    : `${reportType}/images/`;
}

async function listKeysFromS3(prefix: string): Promise<string[]> {
  const client = getReportAssetS3Client();
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    let response;
    try {
      response = await client.send(
        new ListObjectsV2Command({
          Bucket: REPORT_ASSET_S3_BUCKET,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const accessDenied = /not authorized|accessdenied|forbidden|ListBucket/i.test(message);
      if (accessDenied) {
        throw new Error(
          `Missing S3 permission: s3:ListBucket on arn:aws:s3:::${REPORT_ASSET_S3_BUCKET} for prefix ${prefix}`,
        );
      }

      throw error;
    }

    for (const item of response.Contents || []) {
      if (item.Key) {
        keys.push(item.Key);
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

function toDisplayLabel(rawKey: string): string {
  if (HUMAN_LABEL_OVERRIDES[rawKey]) {
    return HUMAN_LABEL_OVERRIDES[rawKey];
  }

  return rawKey
    .split('_')
    .map((segment) => {
      if (/^cd\d+$/i.test(segment)) {
        return segment.toUpperCase();
      }
      return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
    })
    .join(' ');
}

function assetUrl(reportType: ReportType, sampleId: string, fileName: string): string {
  return `${REPORT_ASSET_ROUTE}/${reportType}/${getSampleAssetFolder(reportType, sampleId)}/${fileName}`;
}

function parsePredictionKey(fileName: string): string | null {
  const match = fileName.match(/^03_celltype_(.+)\.png$/i);
  if (!match) {
    return null;
  }

  const key = match[1].toLowerCase();
  const blocked = ['predictions_all', 'predictions_legend', 'prediction_numbers_overlay'];
  if (blocked.includes(key)) {
    return null;
  }

  return key;
}

function parseMarkerKey(fileName: string): string | null {
  const match = fileName.match(/^02_marker_(.+)\.png$/i);
  return match ? match[1].toLowerCase() : null;
}

async function listAvailableCores(reportType: ReportType): Promise<string[]> {
  if (shouldUseS3ForReportAssets()) {
    const prefix = getReportTypePrefix(reportType);
    const folderRegex = new RegExp(`^html_report_assets-${reportType}-(.+)$`, 'i');
    const keys = await listKeysFromS3(prefix);
    const folders = new Set<string>();

    for (const key of keys) {
      const relative = key.startsWith(prefix) ? key.slice(prefix.length) : key;
      const folder = relative.split('/')[0];
      if (!folder) {
        continue;
      }

      const match = folder.match(folderRegex);
      if (match?.[1]) {
        folders.add(match[1]);
      }
    }

    return Array.from(folders).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  const root = getReportImagesRoot(reportType);
  if (!fs.existsSync(root)) {
    return [];
  }

  const folderRegex = new RegExp(`^html_report_assets-${reportType}-(.+)$`, 'i');
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const match = entry.name.match(folderRegex);
      return match ? match[1] : null;
    })
    .filter((core): core is string => core !== null)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function ensureReportType(value: string): ReportType {
  const normalized = value.toLowerCase();
  if (!isReportType(normalized)) {
    throw new Error(`Unsupported report type: ${value}`);
  }

  return normalized;
}

async function ensureCoreExists(reportType: ReportType, sampleId: string): Promise<void> {
  const cores = await listAvailableCores(reportType);
  if (!cores.includes(sampleId)) {
    throw new Error(`Unsupported sample id for ${reportType}: ${sampleId}`);
  }
}

async function getAssetFileNames(reportType: ReportType, sampleId: string): Promise<string[]> {
  if (shouldUseS3ForReportAssets()) {
    const sampleFolder = getSampleAssetFolder(reportType, sampleId);
    const prefix = `${getReportTypePrefix(reportType)}${sampleFolder}/`;
    const keys = await listKeysFromS3(prefix);
    const fileNames = keys
      .map((key) => (key.startsWith(prefix) ? key.slice(prefix.length) : key))
      .filter((name) => Boolean(name) && !name.includes('/') && name.toLowerCase().endsWith('.png'));

    if (!fileNames.length) {
      throw new Error(`Asset directory not found for ${reportType}/${sampleId}`);
    }

    return fileNames;
  }

  const sampleDir = getSampleAssetDirectory(reportType, sampleId);
  if (!fs.existsSync(sampleDir)) {
    throw new Error(`Asset directory not found for ${reportType}/${sampleId}: ${sampleDir}`);
  }

  return fs.readdirSync(sampleDir).filter((name) => name.toLowerCase().endsWith('.png'));
}

function buildPredictionViews(reportType: ReportType, sampleId: string, fileNames: string[]): ReportOption[] {
  const keys = fileNames
    .map(parsePredictionKey)
    .filter((key): key is string => key !== null);

  const uniqueKeys = Array.from(new Set(keys));
  uniqueKeys.sort((a, b) => {
    const aIndex = PREDICTION_PREFERRED_ORDER.indexOf(a as (typeof PREDICTION_PREFERRED_ORDER)[number]);
    const bIndex = PREDICTION_PREFERRED_ORDER.indexOf(b as (typeof PREDICTION_PREFERRED_ORDER)[number]);

    if (aIndex >= 0 && bIndex >= 0) {
      return aIndex - bIndex;
    }
    if (aIndex >= 0) {
      return -1;
    }
    if (bIndex >= 0) {
      return 1;
    }
    return a.localeCompare(b);
  });

  const options = uniqueKeys.map((key) => ({
    key,
    label: toDisplayLabel(key),
    image: assetUrl(reportType, sampleId, `03_celltype_${key}.png`),
  }));

  return [
    {
      key: 'all',
      label: 'All Cell Types',
      image: assetUrl(reportType, sampleId, '03_celltype_predictions_all.png'),
    },
    ...options,
  ];
}

function buildMarkerTiles(reportType: ReportType, sampleId: string, fileNames: string[]): MarkerTile[] {
  const markerKeys = fileNames
    .map(parseMarkerKey)
    .filter((key): key is string => key !== null);

  const uniqueKeys = Array.from(new Set(markerKeys));
  uniqueKeys.sort((a, b) => {
    const aIndex = DEFAULT_MARKER_ORDER.indexOf(a as (typeof DEFAULT_MARKER_ORDER)[number]);
    const bIndex = DEFAULT_MARKER_ORDER.indexOf(b as (typeof DEFAULT_MARKER_ORDER)[number]);

    if (aIndex >= 0 && bIndex >= 0) {
      return aIndex - bIndex;
    }
    if (aIndex >= 0) {
      return -1;
    }
    if (bIndex >= 0) {
      return 1;
    }
    return a.localeCompare(b);
  });

  return uniqueKeys.map((key) => ({
    key,
    label: toDisplayLabel(key),
    image: assetUrl(reportType, sampleId, `02_marker_${key}.png`),
    segmentationOverlay: assetUrl(reportType, sampleId, '02_segmentation_overlay.png'),
  }));
}

export async function getReportCatalog(): Promise<ReportCatalogData> {
  const reportTypes: ReportTypeCatalog[] = [];

  for (const reportType of REPORT_TYPES) {
    const cores = await listAvailableCores(reportType);
    reportTypes.push({
      key: reportType,
      label: REPORT_SOURCE_CONFIG[reportType].label,
      count: cores.length,
      cores,
    });
  }

  return {
    totalReports: reportTypes.reduce((sum, item) => sum + item.count, 0),
    reportTypes,
  };
}

export async function getReportSampleData(reportTypeInput: string, sampleId: string): Promise<ReportSampleData> {
  const reportType = ensureReportType(reportTypeInput);
  await ensureCoreExists(reportType, sampleId);
  const fileNames = await getAssetFileNames(reportType, sampleId);
  const titlePrefix = REPORT_SOURCE_CONFIG[reportType].titlePrefix;

  return {
    sampleId,
    reportType,
    title: `${titlePrefix} (${sampleId})`,
    rawProcessedImage: assetUrl(reportType, sampleId, '01_raw_processed.png'),
    predictionAllImage: assetUrl(reportType, sampleId, '03_celltype_predictions_all.png'),
    predictionLegendImage: assetUrl(reportType, sampleId, '03_celltype_predictions_legend.png'),
    predictionNumbersOverlayImage: assetUrl(reportType, sampleId, '03_celltype_prediction_numbers_overlay.png'),
    markerTiles: buildMarkerTiles(reportType, sampleId, fileNames),
    predictionViews: buildPredictionViews(reportType, sampleId, fileNames),
  };
}
