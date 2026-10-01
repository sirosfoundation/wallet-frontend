import { assert, afterEach, beforeEach, describe, it, vi } from "vitest";
import { throttle } from "./throttle";

describe("throttle", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("invokes the action on the first call", () => {
		const action = vi.fn();
		throttle(action, 1000)();
		assert.equal(action.mock.calls.length, 1);
	});

	it("ignores calls made before the timeout elapses", () => {
		const action = vi.fn();
		const throttled = throttle(action, 1000);
		throttled();
		throttled();
		throttled();
		assert.equal(action.mock.calls.length, 1);
	});

	it("still blocks a call made just before the timeout elapses", () => {
		const action = vi.fn();
		const throttled = throttle(action, 1000);
		throttled();
		vi.advanceTimersByTime(999);
		throttled();
		assert.equal(action.mock.calls.length, 1);
	});

	it("allows the action to run again once the timeout has elapsed", () => {
		const action = vi.fn();
		const throttled = throttle(action, 1000);
		throttled();
		vi.advanceTimersByTime(1000);
		throttled();
		assert.equal(action.mock.calls.length, 2);
	});
});
