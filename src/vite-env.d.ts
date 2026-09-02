/// <reference types="vite/client" />

import { ViteEnvConfig } from "../config";
import type { Logger } from './logger';

declare global {
	interface Window {
		logger: Logger;
	}
}

export interface ImportMeta {
	readonly env: ViteEnvConfig;
}
