import { Logger, jsonToLog } from '@sirosfoundation/browser-log';
import { LOG_LEVEL, type LogLevel } from './config';

export type { LogLevel };

export { jsonToLog };

export const logger = new Logger({ level: LOG_LEVEL || 'info' });

// Make logger available on window for debugging
if (typeof window !== 'undefined') {
	window.logger = logger;
}
