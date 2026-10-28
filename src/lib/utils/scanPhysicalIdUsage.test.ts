import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { hasUsedScanPhysicalId, recordScanPhysicalIdUsed } from './scanPhysicalIdUsage';

// This environment provides no localStorage at all -- several of the suite's
// pre-existing failures are modules touching it at import time -- so each test
// installs exactly the storage it wants to exercise.
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function install(storage: unknown) {
	Object.defineProperty(globalThis, 'localStorage', {
		value: storage,
		configurable: true,
		writable: true,
	});
}

function memoryStorage() {
	const map = new Map<string, string>();
	return {
		getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
		setItem: (k: string, v: string) => void map.set(k, v),
	};
}

beforeEach(() => install(memoryStorage()));

afterEach(() => {
	if (original) {
		Object.defineProperty(globalThis, 'localStorage', original);
	} else {
		delete (globalThis as Record<string, unknown>).localStorage;
	}
});

describe('scanPhysicalIdUsage', () => {
	it('reports not used before anything is recorded', () => {
		expect(hasUsedScanPhysicalId()).toBe(false);
	});

	it('reports used after recording', () => {
		recordScanPhysicalIdUsed();
		expect(hasUsedScanPhysicalId()).toBe(true);
	});

	// The entry point is pinned at the top of the page regardless, so a device
	// that cannot store this must still render rather than fail with it. Both
	// shapes matter: a storage that refuses (private window, blocked site data)
	// and no storage object at all, which is what this very environment has.
	it('survives a localStorage that throws on write', () => {
		install({
			getItem: () => null,
			setItem: () => {
				throw new DOMException('denied');
			},
		});
		expect(() => recordScanPhysicalIdUsed()).not.toThrow();
	});

	it('reports not used when localStorage throws on read', () => {
		install({
			getItem: () => {
				throw new DOMException('denied');
			},
			setItem: () => undefined,
		});
		expect(hasUsedScanPhysicalId()).toBe(false);
	});

	it('survives localStorage being absent entirely', () => {
		delete (globalThis as Record<string, unknown>).localStorage;
		expect(() => recordScanPhysicalIdUsed()).not.toThrow();
		expect(hasUsedScanPhysicalId()).toBe(false);
	});
});
