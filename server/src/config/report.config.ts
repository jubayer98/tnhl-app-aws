import path from 'path';

export const REPORT_ASSET_ROUTE = '/api/report/assets';

export const REPORT_TYPES = ['argmax', 'astir'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

type ReportSourceConfig = {
  label: string;
  titlePrefix: string;
  imagesRoot: string;
};

export const REPORT_SOURCE_CONFIG: Record<ReportType, ReportSourceConfig> = {
  argmax: {
    label: 'Argmax',
    titlePrefix: 'Cell Type Prediction - Argmax',
    imagesRoot:
      process.env.ARGMAX_IMAGES_ROOT ||
      '/Users/jubayer/Development/ukw/tnhl_ctsp/outputs/argmax/images',
  },
  astir: {
    label: 'Astir',
    titlePrefix: 'Cell Type Prediction - Astir',
    imagesRoot:
      process.env.ASTIR_IMAGES_ROOT ||
      '/Users/jubayer/Development/ukw/tnhl_ctsp/outputs/astir/images',
  },
};

export const DEFAULT_MARKER_ORDER = [
  'dapi',
  'pax5',
  'cd3',
  'cd11b',
  'cd11c',
  'cd68',
  'cd90',
  'podoplanin',
  'cd31',
  'cd34',
  'cd56',
  'cd57',
  'cd138',
  'cd15',
] as const;

export const PREDICTION_PREFERRED_ORDER = [
  'all',
  'b',
  't',
  'myeloid',
  'dendritic',
  'macro',
  'stroma',
  'lymphatic',
  'vascular_cd31',
  'vascular_cd34',
  'nk_cd56',
  'nk_cd57',
  'plasma',
  'granulo',
  'other',
] as const;

export function isReportType(value: string): value is ReportType {
  return REPORT_TYPES.includes(value as ReportType);
}

export function getSampleAssetFolder(reportType: ReportType, sampleId: string): string {
  return `html_report_assets-${reportType}-${sampleId}`;
}

export function getSampleAssetDirectory(reportType: ReportType, sampleId: string): string {
  return path.join(REPORT_SOURCE_CONFIG[reportType].imagesRoot, getSampleAssetFolder(reportType, sampleId));
}

export function getReportImagesRoot(reportType: ReportType): string {
  return REPORT_SOURCE_CONFIG[reportType].imagesRoot;
}
