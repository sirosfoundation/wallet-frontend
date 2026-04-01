import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import {
	TxCodeInputProvider,
	useTxCodeInput,
	useTxCodeInputSafe,
} from './TxCodeInputContext';

describe('TxCodeInputContext', () => {
	describe('useTxCodeInput', () => {
		it('should throw when used outside provider', () => {
			expect(() => {
				renderHook(() => useTxCodeInput());
			}).toThrow('useTxCodeInput must be used within TxCodeInputProvider');
		});

		it('should return context value when inside provider', () => {
			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<TxCodeInputProvider>{children}</TxCodeInputProvider>
			);

			const { result } = renderHook(() => useTxCodeInput(), { wrapper });

			expect(result.current).toHaveProperty('requestTxCode');
			expect(result.current).toHaveProperty('state');
			expect(result.current).toHaveProperty('handleSubmit');
			expect(result.current).toHaveProperty('handleCancel');
		});
	});

	describe('useTxCodeInputSafe', () => {
		it('should return null when used outside provider', () => {
			const { result } = renderHook(() => useTxCodeInputSafe());
			expect(result.current).toBeNull();
		});

		it('should return context value when inside provider', () => {
			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<TxCodeInputProvider>{children}</TxCodeInputProvider>
			);

			const { result } = renderHook(() => useTxCodeInputSafe(), { wrapper });

			expect(result.current).not.toBeNull();
			expect(result.current).toHaveProperty('requestTxCode');
		});
	});

	describe('TxCodeInputProvider', () => {
		const wrapper = ({ children }: { children: React.ReactNode }) => (
			<TxCodeInputProvider>{children}</TxCodeInputProvider>
		);

		it('should have initial state with isOpen false', () => {
			const { result } = renderHook(() => useTxCodeInput(), { wrapper });

			expect(result.current.state.isOpen).toBe(false);
			expect(result.current.state.config).toEqual({});
		});

		describe('requestTxCode', () => {
			it('should open popup with provided config', async () => {
				const { result } = renderHook(() => useTxCodeInput(), { wrapper });

				const config = { description: 'Enter code', length: 6 };

				// Start the request (don't await yet)
				act(() => {
					result.current.requestTxCode(config);
				});

				// Popup should now be open with config
				expect(result.current.state.isOpen).toBe(true);
				expect(result.current.state.config).toEqual(config);
			});

			it('should resolve with code when handleSubmit is called', async () => {
				const { result } = renderHook(() => useTxCodeInput(), { wrapper });

				let resolvedCode: string | undefined;
				const config = { description: 'Enter code', length: 6 };

				// Start the request
				act(() => {
					result.current.requestTxCode(config).then((code) => {
						resolvedCode = code;
					});
				});

				// Simulate user submitting code
				act(() => {
					result.current.handleSubmit('123456');
				});

				// Wait for promise to resolve
				await vi.waitFor(() => {
					expect(resolvedCode).toBe('123456');
				});

				// Popup should be closed
				expect(result.current.state.isOpen).toBe(false);
			});

			it('should reject when handleCancel is called', async () => {
				const { result } = renderHook(() => useTxCodeInput(), { wrapper });

				let rejectedError: Error | undefined;
				const config = { description: 'Enter code' };

				// Start the request
				act(() => {
					result.current.requestTxCode(config).catch((error) => {
						rejectedError = error;
					});
				});

				// Simulate user cancelling
				act(() => {
					result.current.handleCancel();
				});

				// Wait for promise to reject
				await vi.waitFor(() => {
					expect(rejectedError).toBeDefined();
					expect(rejectedError?.message).toContain('cancelled');
				});

				// Popup should be closed
				expect(result.current.state.isOpen).toBe(false);
			});
		});

		describe('handleSubmit', () => {
			it('should close popup even without pending request', () => {
				const { result } = renderHook(() => useTxCodeInput(), { wrapper });

				// Manually set open state by requesting
				act(() => {
					result.current.requestTxCode({});
				});

				expect(result.current.state.isOpen).toBe(true);

				// Submit should close
				act(() => {
					result.current.handleSubmit('test');
				});

				expect(result.current.state.isOpen).toBe(false);
			});
		});

		describe('handleCancel', () => {
			it('should close popup even without pending request', () => {
				const { result } = renderHook(() => useTxCodeInput(), { wrapper });

				// Manually set open state by requesting
				act(() => {
					result.current.requestTxCode({});
				});

				expect(result.current.state.isOpen).toBe(true);

				// Cancel should close (but we need to handle the rejection)
				act(() => {
					result.current.handleCancel();
				});

				expect(result.current.state.isOpen).toBe(false);
			});
		});

		describe('multiple requests', () => {
			it('should handle sequential requests correctly', async () => {
				const { result } = renderHook(() => useTxCodeInput(), { wrapper });

				// First request
				let firstCode: string | undefined;
				act(() => {
					result.current.requestTxCode({ length: 4 }).then((code) => {
						firstCode = code;
					});
				});

				act(() => {
					result.current.handleSubmit('1234');
				});

				await vi.waitFor(() => {
					expect(firstCode).toBe('1234');
				});

				// Second request
				let secondCode: string | undefined;
				act(() => {
					result.current.requestTxCode({ length: 6 }).then((code) => {
						secondCode = code;
					});
				});

				expect(result.current.state.isOpen).toBe(true);
				expect(result.current.state.config.length).toBe(6);

				act(() => {
					result.current.handleSubmit('123456');
				});

				await vi.waitFor(() => {
					expect(secondCode).toBe('123456');
				});
			});
		});
	});
});
