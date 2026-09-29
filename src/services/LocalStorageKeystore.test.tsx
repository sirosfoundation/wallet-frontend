// @vitest-environment happy-dom
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { useLocalStorageKeystore } from "@/services/LocalStorageKeystore";

/**
 * happy-dom provides a `window` but no Web Storage, and `useStorage.ts` reads
 * `window.localStorage` at module scope — so LocalStorageKeystore cannot even
 * be imported without one, which is why it had no tests at all. An in-memory
 * Storage is installed before any import evaluates.
 *
 * Vitest hoists `vi.hoisted` and `vi.mock` above every import, so this runs
 * before the imports above it despite appearing below them — which is what
 * lets those sit at the top of the file for `import/first`.
 */
vi.hoisted(() => {
	class MemoryStorage implements Storage {
		#entries = new Map<string, string>();
		get length() { return this.#entries.size; }
		key(index: number) { return [...this.#entries.keys()][index] ?? null; }
		getItem(name: string) { return this.#entries.has(name) ? this.#entries.get(name)! : null; }
		setItem(name: string, value: string) { this.#entries.set(name, String(value)); }
		removeItem(name: string) { this.#entries.delete(name); }
		clear() { this.#entries.clear(); }
	}

	for (const name of ["localStorage", "sessionStorage"] as const) {
		const storage = new MemoryStorage();
		Object.defineProperty(globalThis.window, name, { value: storage, configurable: true, writable: true });
		Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true });
	}
});

vi.mock("@/hooks/useIndexedDb", () => ({
	useIndexedDb: () => ({
		read: vi.fn(async () => undefined),
		write: vi.fn(async () => undefined),
		destroy: vi.fn(async () => undefined),
	}),
}));

/** The keystore calls useNavigate(), so it needs a Router in the tree. */
const routerWrapper = ({ children }: { children: React.ReactNode }) => (
	<MemoryRouter>{children}</MemoryRouter>
);

describe("LocalStorageKeystore.signVcdm2Presentation", () => {
	beforeEach(() => {
		window.sessionStorage.clear();
		window.localStorage.clear();
	});

	it("refuses to sign while the keystore is closed", async () => {
		const { result } = renderHook(() => useLocalStorageKeystore(new EventTarget()), { wrapper: routerWrapper });

		await expect(
			result.current.signVcdm2Presentation("n", "aud", ["anything"]),
		).rejects.toThrow(/Key store is closed/);
	});
});
