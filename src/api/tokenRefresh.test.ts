import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import {
	refreshAccessToken,
	isUnauthorizedError,
	withTokenRefresh,
	TokenRefreshConfig,
	_resetRefreshState,
} from './tokenRefresh';

// Mock axios
vi.mock('axios', async () => {
	const actual = await vi.importActual<typeof import('axios')>('axios');
	return {
		...actual,
		default: {
			...(actual.default as object),
			post: vi.fn(),
			isAxiosError: (error: any) => error?.isAxiosError === true,
		},
	};
});

// Mock tenant module
vi.mock('../lib/tenant', () => ({
	getStoredTenant: () => 'test-tenant',
}));

describe('tokenRefresh', () => {
	const mockConfig: TokenRefreshConfig = {
		backendUrl: 'https://api.example.com',
		getRefreshToken: vi.fn(),
		setAppToken: vi.fn(),
		setRefreshToken: vi.fn(),
		clearSession: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		_resetRefreshState();
	});

	afterEach(() => {
		_resetRefreshState();
	});

	describe('isUnauthorizedError', () => {
		it('should return true for 401 axios errors', () => {
			const error = {
				isAxiosError: true,
				response: { status: 401 },
			};
			expect(isUnauthorizedError(error)).toBe(true);
		});

		it('should return false for other status codes', () => {
			const error = {
				isAxiosError: true,
				response: { status: 403 },
			};
			expect(isUnauthorizedError(error)).toBe(false);
		});

		it('should return false for non-axios errors', () => {
			const error = new Error('Regular error');
			expect(isUnauthorizedError(error)).toBe(false);
		});

		it('should return false for errors without response', () => {
			const error = {
				isAxiosError: true,
			};
			expect(isUnauthorizedError(error)).toBe(false);
		});
	});

	describe('refreshAccessToken', () => {
		it('should return success: false when no refresh token available', async () => {
			(mockConfig.getRefreshToken as ReturnType<typeof vi.fn>).mockReturnValue(null);

			const result = await refreshAccessToken(mockConfig);

			expect(result.success).toBe(false);
			expect(axios.post).not.toHaveBeenCalled();
		});

		it('should refresh token successfully and update tokens', async () => {
			(mockConfig.getRefreshToken as ReturnType<typeof vi.fn>).mockReturnValue('refresh-token-123');
			(axios.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				data: {
					appToken: 'new-app-token',
					refreshToken: 'new-refresh-token',
				},
			});

			const result = await refreshAccessToken(mockConfig);

			expect(result.success).toBe(true);
			expect(result.appToken).toBe('new-app-token');
			expect(result.refreshToken).toBe('new-refresh-token');
			expect(mockConfig.setAppToken).toHaveBeenCalledWith('new-app-token');
			expect(mockConfig.setRefreshToken).toHaveBeenCalledWith('new-refresh-token');
		});

		it('should handle successful refresh without token rotation', async () => {
			(mockConfig.getRefreshToken as ReturnType<typeof vi.fn>).mockReturnValue('refresh-token-123');
			(axios.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				data: {
					appToken: 'new-app-token',
					// No refreshToken in response
				},
			});

			const result = await refreshAccessToken(mockConfig);

			expect(result.success).toBe(true);
			expect(mockConfig.setAppToken).toHaveBeenCalledWith('new-app-token');
			expect(mockConfig.setRefreshToken).not.toHaveBeenCalled();
		});

		it('should clear session on 401 error during refresh', async () => {
			(mockConfig.getRefreshToken as ReturnType<typeof vi.fn>).mockReturnValue('refresh-token-123');
			(axios.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
				isAxiosError: true,
				response: { status: 401 },
			});

			const result = await refreshAccessToken(mockConfig);

			expect(result.success).toBe(false);
			expect(mockConfig.clearSession).toHaveBeenCalled();
		});

		it('should clear session on 403 error during refresh', async () => {
			(mockConfig.getRefreshToken as ReturnType<typeof vi.fn>).mockReturnValue('refresh-token-123');
			(axios.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
				isAxiosError: true,
				response: { status: 403 },
			});

			const result = await refreshAccessToken(mockConfig);

			expect(result.success).toBe(false);
			expect(mockConfig.clearSession).toHaveBeenCalled();
		});

		it('should not clear session on network errors', async () => {
			(mockConfig.getRefreshToken as ReturnType<typeof vi.fn>).mockReturnValue('refresh-token-123');
			(axios.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

			const result = await refreshAccessToken(mockConfig);

			expect(result.success).toBe(false);
			expect(mockConfig.clearSession).not.toHaveBeenCalled();
		});

		it('should deduplicate concurrent refresh requests', async () => {
			(mockConfig.getRefreshToken as ReturnType<typeof vi.fn>).mockReturnValue('refresh-token-123');

			let resolveRefresh: (value: any) => void;
			const refreshPromise = new Promise((resolve) => {
				resolveRefresh = resolve;
			});

			(axios.post as ReturnType<typeof vi.fn>).mockReturnValueOnce(refreshPromise);

			// Start two concurrent refresh requests
			const result1Promise = refreshAccessToken(mockConfig);
			const result2Promise = refreshAccessToken(mockConfig);

			// Resolve the refresh
			resolveRefresh!({
				data: { appToken: 'new-token' },
			});

			const [result1, result2] = await Promise.all([result1Promise, result2Promise]);

			// Both should succeed
			expect(result1.success).toBe(true);
			expect(result2.success).toBe(true);

			// But only one API call should be made
			expect(axios.post).toHaveBeenCalledTimes(1);
		});

		it('should send correct headers with refresh request', async () => {
			(mockConfig.getRefreshToken as ReturnType<typeof vi.fn>).mockReturnValue('refresh-token-123');
			(axios.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				data: { appToken: 'new-token' },
			});

			await refreshAccessToken(mockConfig);

			expect(axios.post).toHaveBeenCalledWith(
				'https://api.example.com/user/token/refresh',
				{ refreshToken: 'refresh-token-123' },
				expect.objectContaining({
					headers: {
						'Content-Type': 'application/json',
						'X-Tenant-ID': 'test-tenant',
					},
				})
			);
		});
	});

	describe('withTokenRefresh', () => {
		it('should return result on successful request', async () => {
			const requestFn = vi.fn().mockResolvedValue({ data: 'success' });

			const result = await withTokenRefresh(requestFn, mockConfig);

			expect(result).toEqual({ data: 'success' });
			expect(requestFn).toHaveBeenCalledTimes(1);
		});

		it('should retry request after successful token refresh on 401', async () => {
			(mockConfig.getRefreshToken as ReturnType<typeof vi.fn>).mockReturnValue('refresh-token-123');
			(axios.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				data: { appToken: 'new-token' },
			});

			let callCount = 0;
			const requestFn = vi.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					return Promise.reject({
						isAxiosError: true,
						response: { status: 401 },
					});
				}
				return Promise.resolve({ data: 'success after retry' });
			});

			const result = await withTokenRefresh(requestFn, mockConfig);

			expect(result).toEqual({ data: 'success after retry' });
			expect(requestFn).toHaveBeenCalledTimes(2);
		});

		it('should throw error if token refresh fails', async () => {
			(mockConfig.getRefreshToken as ReturnType<typeof vi.fn>).mockReturnValue(null);

			const unauthorizedError = {
				isAxiosError: true,
				response: { status: 401 },
			};
			const requestFn = vi.fn().mockRejectedValue(unauthorizedError);

			await expect(withTokenRefresh(requestFn, mockConfig)).rejects.toEqual(unauthorizedError);
			expect(requestFn).toHaveBeenCalledTimes(1);
		});

		it('should not retry on non-401 errors', async () => {
			const serverError = {
				isAxiosError: true,
				response: { status: 500 },
			};
			const requestFn = vi.fn().mockRejectedValue(serverError);

			await expect(withTokenRefresh(requestFn, mockConfig)).rejects.toEqual(serverError);
			expect(requestFn).toHaveBeenCalledTimes(1);
			expect(axios.post).not.toHaveBeenCalled();
		});

		it('should not retry more than once', async () => {
			(mockConfig.getRefreshToken as ReturnType<typeof vi.fn>).mockReturnValue('refresh-token-123');
			(axios.post as ReturnType<typeof vi.fn>).mockResolvedValue({
				data: { appToken: 'new-token' },
			});

			const unauthorizedError = {
				isAxiosError: true,
				response: { status: 401 },
			};
			const requestFn = vi.fn().mockRejectedValue(unauthorizedError);

			await expect(withTokenRefresh(requestFn, mockConfig)).rejects.toEqual(unauthorizedError);
			// Should call once originally, once after refresh
			expect(requestFn).toHaveBeenCalledTimes(2);
			// Only one refresh attempt
			expect(axios.post).toHaveBeenCalledTimes(1);
		});
	});
});
