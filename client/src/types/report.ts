export type ReportType = 'argmax' | 'astir';

export interface ReportOption {
  key: string;
  label: string;
  image: string;
}

export interface MarkerTile {
  key: string;
  label: string;
  image: string;
  segmentationOverlay: string;
}

export interface ReportSampleData {
  sampleId: string;
  reportType: ReportType;
  title: string;
  rawProcessedImage: string;
  predictionAllImage: string;
  predictionLegendImage: string;
  predictionNumbersOverlayImage: string;
  markerTiles: MarkerTile[];
  predictionViews: ReportOption[];
}

export interface ReportListItem {
  sampleId: string;
  reportType: ReportType;
  title: string;
}

export interface ReportTypeCatalog {
  key: ReportType;
  label: string;
  count: number;
  cores: string[];
}

export interface ReportCatalogResponse {
  totalReports: number;
  reportTypes: ReportTypeCatalog[];
}

export interface CreateImageUploadUrlRequest {
  fileName: string;
  contentType: string;
  reportType?: ReportType;
  sampleId?: string;
}

export interface CreateImageUploadUrlResponse {
  key: string;
  uploadUrl: string;
  expiresIn: number;
}

export interface CreateImageViewUrlResponse {
  key: string;
  viewUrl: string;
  expiresIn: number;
}
