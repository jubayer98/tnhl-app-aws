import type { ReportType } from '../config';

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

export interface ReportCatalogData {
  totalReports: number;
  reportTypes: ReportTypeCatalog[];
}
