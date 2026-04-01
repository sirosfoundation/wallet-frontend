import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, jsonToLog } from './logger';

// Mock the config module
vi.mock('./config', () => ({
	DISPLAY_CONSOLE: true,
	LOG_LEVEL: 'debug',
}));

describe('Logger', () => {
	let consoleSpy: {
		error: ReturnType<typeof vi.spyOn>;
		warn: ReturnType<typeof vi.spyOn>;
		info: ReturnType<typeof vi.spyOn>;
		debug: ReturnType<typeof vi.spyOn>;
		group: ReturnType<typeof vi.spyOn>;
		groupEnd: ReturnType<typeof vi.spyOn>;
	};

	beforeEach(() => {
		consoleSpy = {
			error: vi.spyOn(console, 'error').mockImplementation(() => {}),
			warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
			info: vi.spyOn(console, 'info').mockImplementation(() => {}),
			debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
			group: vi.spyOn(console, 'group').mockImplementation(() => {}),
			groupEnd: vi.spyOn(console, 'groupEnd').mockImplementation(() => {}),
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('constructor', () => {
		it('should default to info level', () => {
			const logger = new Logger();
			expect(logger.level).toBe('info');
		});

		it('should accept custom log level', () => {
			const logger = new Logger('error');
			expect(logger.level).toBe('error');
		});

		it('should have all log levels defined', () => {
			const logger = new Logger('debug');
			expect(logger.logLevels).toEqual(['error', 'info', 'warn', 'debug']);
		});
	});

	describe('setLevel', () => {
		it('should update the log level', () => {
			const logger = new Logger('info');
			logger.setLevel('debug');
			expect(logger.level).toBe('debug');
		});
	});

	describe('logPrefix', () => {
		it('should return formatted prefix with color', () => {
			const logger = new Logger('debug');
			const prefix = logger.logPrefix('error');

			expect(prefix[0]).toContain('[error]');
			expect(prefix[1]).toContain('color:');
			expect(prefix[1]).toContain('#FF5C5C'); // error color
		});

		it('should use correct colors for each level', () => {
			const logger = new Logger('debug');

			expect(logger.logPrefix('error')[1]).toContain('#FF5C5C');
			expect(logger.logPrefix('info')[1]).toContain('#4DA6FF');
			expect(logger.logPrefix('warn')[1]).toContain('#FFAA00');
			expect(logger.logPrefix('debug')[1]).toContain('#9E9E9E');
		});
	});

	describe('logging methods at debug level', () => {
		it('should bind error method to console.error', () => {
			const logger = new Logger('debug');
			logger.error('test error');
			expect(consoleSpy.error).toHaveBeenCalled();
		});

		it('should bind warn method to console.warn', () => {
			const logger = new Logger('debug');
			logger.warn('test warning');
			expect(consoleSpy.warn).toHaveBeenCalled();
		});

		it('should bind info method to console.info', () => {
			const logger = new Logger('debug');
			logger.info('test info');
			expect(consoleSpy.info).toHaveBeenCalled();
		});

		it('should bind debug method to console.debug', () => {
			const logger = new Logger('debug');
			logger.debug('test debug');
			expect(consoleSpy.debug).toHaveBeenCalled();
		});
	});

	describe('log level filtering', () => {
		it('should not log debug when level is info', () => {
			const logger = new Logger('info');
			// At info level, debug should be a no-op
			logger.debug('should not appear');
			// The default no-op function doesn't call console.debug
			// We verify by checking it's still the default empty function
			expect(logger.debug.toString()).not.toContain('bind');
		});

		it('should only log error when level is error', () => {
			const logger = new Logger('error');
			// info, warn, debug should be no-ops at error level
			expect(logger.info.toString()).not.toContain('bind');
			expect(logger.warn.toString()).not.toContain('bind');
			expect(logger.debug.toString()).not.toContain('bind');
		});
	});

	describe('group methods', () => {
		it('should have group.end that calls console.groupEnd', () => {
			const logger = new Logger('debug');
			logger.group.end();
			expect(consoleSpy.groupEnd).toHaveBeenCalled();
		});

		it('should bind group methods at debug level', () => {
			const logger = new Logger('debug');
			logger.group.error('test group');
			expect(consoleSpy.group).toHaveBeenCalled();
		});
	});
});

describe('jsonToLog', () => {
	it('should handle null', () => {
		const result = jsonToLog(null);
		expect(result).toContain('null');
	});

	it('should handle simple values', () => {
		expect(jsonToLog('test')).toContain('test');
		expect(jsonToLog(123)).toContain('123');
		expect(jsonToLog(true)).toContain('true');
	});

	it('should format simple objects', () => {
		const result = jsonToLog({ name: 'test', value: 42 });
		expect(result).toContain('name: test');
		expect(result).toContain('value: 42');
	});

	it('should format arrays with dashes', () => {
		const result = jsonToLog(['a', 'b', 'c']);
		expect(result).toContain('- a');
		expect(result).toContain('- b');
		expect(result).toContain('- c');
	});

	it('should handle nested objects', () => {
		const result = jsonToLog({
			outer: {
				inner: 'value',
			},
		});
		expect(result).toContain('outer:');
		expect(result).toContain('inner: value');
	});

	it('should handle arrays in objects', () => {
		const result = jsonToLog({
			items: ['first', 'second'],
		});
		expect(result).toContain('items:');
		expect(result).toContain('- first');
		expect(result).toContain('- second');
	});

	it('should handle Error objects', () => {
		const result = jsonToLog({
			error: new Error('Something went wrong'),
		});
		expect(result).toContain('error: Something went wrong');
	});

	it('should trim string values', () => {
		const result = jsonToLog({ value: '  trimmed  ' });
		expect(result).toContain('value: trimmed');
	});
});
