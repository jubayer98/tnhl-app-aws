import type {
  CreateImageUploadUrlRequest,
  CreateImageUploadUrlResponse,
  CreateImageViewUrlResponse,
  ReportCatalogResponse,
  ReportSampleData,
  ReportType,
} from '../types/report';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

async function fetchJsonWithBody<T>(path: string, method: 'POST', body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

export function fetchReportCatalog(): Promise<ReportCatalogResponse> {
  return fetchJson<ReportCatalogResponse>('/api/report/catalog');
}

export function fetchReportByTypeAndSample(reportType: ReportType, sampleId: string): Promise<ReportSampleData> {
  return fetchJson<ReportSampleData>(`/api/report/${reportType}/${sampleId}`);
}

export function createImageUploadUrl(
  request: CreateImageUploadUrlRequest,
): Promise<CreateImageUploadUrlResponse> {
  return fetchJsonWithBody<CreateImageUploadUrlResponse>('/api/report/images/upload-url', 'POST', request);
}

export function createImageViewUrl(key: string): Promise<CreateImageViewUrlResponse> {
  const encodedKey = encodeURIComponent(key);
  return fetchJson<CreateImageViewUrlResponse>(`/api/report/images/view-url?key=${encodedKey}`);
}

export async function uploadImageToSignedUrl(uploadUrl: string, file: File): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type,
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error(`Upload failed (${response.status}).`);
  }
}
