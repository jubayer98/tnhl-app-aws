import { Request, Response } from 'express';
import {
  asImageStorageStatus,
  createImageUploadUrl,
  createImageViewUrl,
  getReportCatalog,
  getReportSampleData,
} from '../services';

export async function getReportCatalogController(_req: Request, res: Response): Promise<void> {
  try {
    const catalog = await getReportCatalog();
    res.status(200).json(catalog);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown report error';
    const forbidden = /missing s3 permission|not authorized|accessdenied|forbidden|listbucket/i.test(message);
    res.status(forbidden ? 403 : 500).json({ message });
  }
}

export async function getReportByTypeAndSample(req: Request, res: Response): Promise<void> {
  try {
    const reportTypeParam = req.params.reportType;
    const reportType = Array.isArray(reportTypeParam) ? reportTypeParam[0] : reportTypeParam;
    const sampleIdParam = req.params.sampleId;
    const sampleId = Array.isArray(sampleIdParam) ? sampleIdParam[0] : sampleIdParam;
    const report = await getReportSampleData(reportType, sampleId);
    res.status(200).json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown report error';
    const forbidden = /missing s3 permission|not authorized|accessdenied|forbidden|listbucket/i.test(message);
    const notFound = /unsupported sample id|unsupported report type|asset directory not found/i.test(message);
    res.status(notFound ? 404 : forbidden ? 403 : 500).json({
      message,
    });
  }
}

export async function createReportImageUploadUrlController(req: Request, res: Response): Promise<void> {
  try {
    const { fileName, contentType, reportType, sampleId } = req.body as {
      fileName?: string;
      contentType?: string;
      reportType?: string;
      sampleId?: string;
    };

    const signedUpload = await createImageUploadUrl({
      fileName: fileName || '',
      contentType: contentType || '',
      reportType,
      sampleId,
    });

    res.status(200).json(signedUpload);
  } catch (error) {
    const status = asImageStorageStatus(error);
    const message = error instanceof Error ? error.message : 'Failed to create upload URL';
    res.status(status).json({ message });
  }
}

export async function createReportImageViewUrlController(req: Request, res: Response): Promise<void> {
  try {
    const keyParam = req.query.key;
    const key =
      typeof keyParam === 'string'
        ? keyParam
        : Array.isArray(keyParam) && typeof keyParam[0] === 'string'
          ? keyParam[0]
          : '';
    const signedView = await createImageViewUrl(key || '');
    res.status(200).json(signedView);
  } catch (error) {
    const status = asImageStorageStatus(error);
    const message = error instanceof Error ? error.message : 'Failed to create view URL';
    res.status(status).json({ message });
  }
}
