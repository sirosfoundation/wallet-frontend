import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePrfRetry } from './usePrfRetry';

describe('usePrfRetry', () => {
	it('resets prfRetryAccepted when a new prompt starts', async () => {
		const { result } = renderHook(() => usePrfRetry());

		let first!: Promise<boolean>;
		act(() => { first = result.current.promptForPrfRetry(); });
		await act(async () => {
			result.current.resolvePrfRetryPrompt?.(true);
			await first;
		});
		expect(result.current.prfRetryAccepted).toBe(true);

		act(() => { void result.current.promptForPrfRetry(); });
		expect(result.current.needPrfRetry).toBe(true);
		expect(result.current.prfRetryAccepted).toBe(false);
	});
});
