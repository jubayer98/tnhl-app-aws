function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function asPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export const AWS_REGION = process.env.AWS_REGION || '';
export const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || '';
export const AWS_S3_KEY_PREFIX = (process.env.AWS_S3_KEY_PREFIX || 'uploads').replace(/^\/+|\/+$/g, '');
export const REPORT_ASSET_S3_BUCKET = process.env.REPORT_ASSET_S3_BUCKET || AWS_S3_BUCKET;
export const REPORT_ASSET_S3_PREFIX = (process.env.REPORT_ASSET_S3_PREFIX || '').replace(/^\/+|\/+$/g, '');

export const AWS_S3_UPLOAD_URL_EXPIRES_SEC = asPositiveInt(process.env.AWS_S3_UPLOAD_URL_EXPIRES_SEC, 300);
export const AWS_S3_VIEW_URL_EXPIRES_SEC = asPositiveInt(process.env.AWS_S3_VIEW_URL_EXPIRES_SEC, 300);

const reportAssetBase = process.env.REPORT_ASSET_BASE_URL || process.env.S3_REPORT_ASSET_BASE_URL || '';
export const REPORT_ASSET_BASE_URL = reportAssetBase ? trimTrailingSlash(reportAssetBase) : '';

export function isS3Configured(): boolean {
  return Boolean(AWS_REGION && AWS_S3_BUCKET);
}
