import { Logger } from "./logger";

declare module '*.png' {
	const value: string;
	export = value;
}

declare global {
	interface Window { logger: Logger; }
}

declare module '*.svg' {
	const value: string;
	export default value;
}
