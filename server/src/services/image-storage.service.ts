import path from 'path';
import crypto from 'crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  AWS_REGION,
  AWS_S3_BUCKET,
  AWS_S3_KEY_PREFIX,
  AWS_S3_UPLOAD_URL_EXPIRES_SEC,
  AWS_S3_VIEW_URL_EXPIRES_SEC,
  isS3Configured,
} from '../config';
import { isReportType } from '../config/report.config';

const ALLOWED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

let s3Client: S3Client | null = null;

class ImageStorageError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getS3Client(): S3Client {
  if (!isS3Configured()) {
    throw new ImageStorageError(500, 'S3 is not configured. Set AWS_REGION and AWS_S3_BUCKET.');
  }

  if (!s3Client) {
    s3Client = new S3Client({ region: AWS_REGION });
  }

  return s3Client;
}

function sanitizeSampleId(sampleId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(sampleId)) {
    throw new ImageStorageError(400, 'sampleId contains invalid characters.');
  }

  return sampleId;
}

function getFileExtension(fileName: string, contentType: string): string {
  const parsedExt = path.extname(fileName).replace('.', '').toLowerCase();
  const mimeExt = EXTENSION_BY_MIME[contentType.toLowerCase()] || '';

  if (parsedExt && ['png', 'jpg', 'jpeg', 'webp'].includes(parsedExt)) {
    return parsedExt === 'jpeg' ? 'jpg' : parsedExt;
  }

  if (mimeExt) {
    return mimeExt;
  }

  throw new ImageStorageError(400, 'Unsupported file extension. Use png, jpg, or webp.');
}

function buildObjectKey(fileName: string, contentType: string, reportType?: string, sampleId?: string): string {
  const extension = getFileExtension(fileName, contentType);
  const uniqueName = `${crypto.randomUUID()}.${extension}`;

  if (reportType && sampleId) {
    if (!isReportType(reportType.toLowerCase())) {
      throw new ImageStorageError(400, `Unsupported report type: ${reportType}`);
    }

    const normalizedType = reportType.toLowerCase();
    const normalizedSample = sanitizeSampleId(sampleId);
    return `${AWS_S3_KEY_PREFIX}/reports/${normalizedType}/${normalizedSample}/${uniqueName}`;
  }

  const datePrefix = new Date().toISOString().slice(0, 10);
  return `${AWS_S3_KEY_PREFIX}/images/${datePrefix}/${uniqueName}`;
}

export type CreateUploadUrlInput = {
  fileName: string;
  contentType: string;
  reportType?: string;
  sampleId?: string;
};

export type CreateUploadUrlResult = {
  key: string;
  uploadUrl: string;
  expiresIn: number;
};

export async function createImageUploadUrl(input: CreateUploadUrlInput): Promise<CreateUploadUrlResult> {
  const fileName = input.fileName?.trim();
  const contentType = input.contentType?.trim().toLowerCase();

  if (!fileName) {
    throw new ImageStorageError(400, 'fileName is required.');
  }
  if (!contentType) {
    throw new ImageStorageError(400, 'contentType is required.');
  }
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new ImageStorageError(400, 'Unsupported contentType. Use image/png, image/jpeg, or image/webp.');
  }
  if (input.reportType && !input.sampleId) {
    throw new ImageStorageError(400, 'sampleId is required when reportType is provided.');
  }

  const key = buildObjectKey(fileName, contentType, input.reportType, input.sampleId);
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: AWS_S3_BUCKET,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: AWS_S3_UPLOAD_URL_EXPIRES_SEC,
  });

  return {
    key,
    uploadUrl,
    expiresIn: AWS_S3_UPLOAD_URL_EXPIRES_SEC,
  };
}

export type CreateViewUrlResult = {
  key: string;
  viewUrl: string;
  expiresIn: number;
};

export async function createImageViewUrl(keyInput: string): Promise<CreateViewUrlResult> {
  const key = keyInput?.trim();
  if (!key) {
    throw new ImageStorageError(400, 'key is required.');
  }

  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: AWS_S3_BUCKET,
    Key: key,
  });

  const viewUrl = await getSignedUrl(client, command, {
    expiresIn: AWS_S3_VIEW_URL_EXPIRES_SEC,
  });

  return {
    key,
    viewUrl,
    expiresIn: AWS_S3_VIEW_URL_EXPIRES_SEC,
  };
}

export function asImageStorageStatus(error: unknown): number {
  if (error instanceof ImageStorageError) {
    return error.status;
  }

  return 500;
}
