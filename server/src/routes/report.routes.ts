import { Router } from 'express';
import {
	createReportImageUploadUrlController,
	createReportImageViewUrlController,
	getReportByTypeAndSample,
	getReportCatalogController,
} from '../controllers';

const reportRouter = Router();

reportRouter.get('/catalog', getReportCatalogController);
reportRouter.post('/images/upload-url', createReportImageUploadUrlController);
reportRouter.get('/images/view-url', createReportImageViewUrlController);
reportRouter.get('/:reportType/:sampleId', getReportByTypeAndSample);

export default reportRouter;
