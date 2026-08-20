import { Logger } from '@sirosfoundation/browser-log';
import { LOG_LEVEL } from './config';

export { jsonToLog } from '@sirosfoundation/browser-log';
export type { LogLevel } from './config';

export const logger = new Logger({ level: LOG_LEVEL || 'info' });

// Make logger available on window for debugging
if (typeof window !== 'undefined') {
	window.logger = logger;
}
