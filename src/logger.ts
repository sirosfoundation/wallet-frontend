import { DISPLAY_CONSOLE, LOG_LEVEL, type LogLevel } from "./config";

export type { LogLevel };

export class Logger {
	level: LogLevel;
	// Severity ordering: error (0) > warn (1) > info (2) > debug (3)
	// Lower index = more severe, always enabled
	logLevels: Array<LogLevel> = ["error", "warn", "info", "debug"];

	levelColors: Record<LogLevel, string> = {
		error: "#FF5C5C",
		info: "#4DA6FF",
		warn: "#FFAA00",
		debug: "#9E9E9E",
	}

	constructor(level: LogLevel = "info") {
		this.level = level;
		this.bindMethods();
	}

	/**
	 * Bind console methods based on current log level.
	 * Methods with severity <= level are bound to console, others are no-ops.
	 */
	private bindMethods() {
		const levelIndex = this.logLevels.indexOf(this.level);

		for (const [index, logLevel] of this.logLevels.entries()) {
			if (index <= levelIndex) {
				this.group[logLevel] = Function.prototype.bind.call(
					console.group,
					console,
					...this.logPrefix(logLevel),
				);

				this[logLevel] = Function.prototype.bind.call(
					console[logLevel],
					console,
					...this.logPrefix(logLevel)
				);
			} else {
				// Disable methods for levels below current threshold
				this.group[logLevel] = () => {};
				this[logLevel] = () => {};
			}
		}
	}

	setLevel(logLevel: LogLevel) {
		this.level = logLevel;
		this.bindMethods();
	}

	logPrefix(level: string) {
		let prefix = `%c[${level}]%c`;

		if (!DISPLAY_CONSOLE) {
			prefix += ` ${new Date().toISOString()} | `;
		}
		return [prefix, `color: ${this.levelColors[level]}; font-weight: bold;`, ""];
	}

	group: Record<LogLevel | "end", (...args: unknown[]) => void> = {
		error: () => {},
		info: () => {},
		warn: () => {},
		debug: () => {},
		end() { console.groupEnd() }
	};

	error(..._args: unknown[]) {}
	info(..._args: unknown[]) {}
	warn(..._args: unknown[]) {}
	debug(..._args: unknown[]) {}
}

export const logger = new Logger(LOG_LEVEL || "info");

// Make logger available on window for debugging
if (typeof window !== 'undefined') {
	window.logger = logger;
}

/**
 * Helper function that translates a json array or object into human
 * readable plain text for logger.
 */
export function jsonToLog(json: unknown): string {
	const indt = (i: number) => " ".repeat(i);

	const parse = (input: unknown, indent: number = 2): string => {
		if (input === null || typeof input !== "object") {
			return String(input).trim();
		}

		if (Array.isArray(input)) {
			return input
				.map(item => `${indt(indent)}- ${parse(item, indent + 4)}`)
				.join('\n');
		}

		return Object.entries(input as Record<string, unknown>)
			.map(([key, value]) => {
				if (Array.isArray(value)) {
					return `${indt(indent)}${key}:\n` +
						value
							.map(item => `${indt(indent + 4)}- ${parse(item, indent + 8)}`)
							.join('\n');
				}

				if (value && value instanceof Error) {
					return `${indt(indent)}${key}: ${value.message}`;
				}

				if (value && typeof value === "object") {
					return `${indt(indent)}${key}:\n${parse(value, indent + 4)}`;
				}

				return `${indt(indent)}${key}: ${String(value).trim()}`;
			})
			.join('\n');
	};

	return `\n\n${parse(json)}\n\n`
}
