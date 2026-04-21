import cors from 'cors';
import express, { Request, Response } from 'express';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  AWS_REGION,
  REPORT_ASSET_BASE_URL,
  REPORT_ASSET_ROUTE,
  REPORT_ASSET_S3_BUCKET,
  REPORT_ASSET_S3_PREFIX,
  getReportImagesRoot,
  isReportType,
} from './config';
import { reportRouter } from './routes';

const app = express();
const PORT = Number(process.env.PORT) || 8080;
let reportAssetS3Client: S3Client | null = null;

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

function buildReportAssetObjectKey(reportType: string, sampleFolder: string, fileName: string): string {
  const base = REPORT_ASSET_S3_PREFIX ? `${REPORT_ASSET_S3_PREFIX}/${reportType}/images` : `${reportType}/images`;
  return `${base}/${sampleFolder}/${fileName}`;
}

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  }),
);
app.use(express.json());

if (!REPORT_ASSET_BASE_URL) {
  app.use(`${REPORT_ASSET_ROUTE}/argmax`, express.static(getReportImagesRoot('argmax')));
  app.use(`${REPORT_ASSET_ROUTE}/astir`, express.static(getReportImagesRoot('astir')));
} else {
  app.get(`${REPORT_ASSET_ROUTE}/:reportType/:sampleFolder/:fileName`, async (req: Request, res: Response) => {
    try {
      const reportTypeParam = req.params.reportType;
      const sampleFolderParam = req.params.sampleFolder;
      const fileNameParam = req.params.fileName;

      const reportType = Array.isArray(reportTypeParam) ? reportTypeParam[0] : reportTypeParam;
      const sampleFolder = Array.isArray(sampleFolderParam) ? sampleFolderParam[0] : sampleFolderParam;
      const fileName = Array.isArray(fileNameParam) ? fileNameParam[0] : fileNameParam;

      if (!isReportType(reportType)) {
        res.status(400).json({ message: `Unsupported report type: ${reportType}` });
        return;
      }

      const key = buildReportAssetObjectKey(reportType, sampleFolder, fileName);
      const client = getReportAssetS3Client();
      const object = await client.send(
        new GetObjectCommand({
          Bucket: REPORT_ASSET_S3_BUCKET,
          Key: key,
        }),
      );

      if (object.ContentType) {
        res.setHeader('Content-Type', object.ContentType);
      }
      if (object.CacheControl) {
        res.setHeader('Cache-Control', object.CacheControl);
      }

      const body = object.Body;
      if (!body || typeof (body as NodeJS.ReadableStream).pipe !== 'function') {
        res.status(500).json({ message: 'Invalid S3 object body stream.' });
        return;
      }

      (body as NodeJS.ReadableStream).pipe(res);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch report asset';
      const notFound = /nosuchkey|not found|404/i.test(message);
      const forbidden = /not authorized|accessdenied|forbidden|403/i.test(message);
      res.status(notFound ? 404 : forbidden ? 403 : 500).json({ message });
    }
  });
}

app.use('/api/report', reportRouter);

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});