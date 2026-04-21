import path from 'path';
import { config as loadEnv } from 'dotenv';

const envCandidates = [
	path.resolve(__dirname, '../../.env'),
	path.resolve(process.cwd(), '.env'),
	path.resolve(process.cwd(), 'server/.env'),
];

for (const envPath of envCandidates) {
	const result = loadEnv({ path: envPath, override: false });
	if (!result.error) {
		break;
	}
}

export * from './report.config';
export * from './s3.config';
