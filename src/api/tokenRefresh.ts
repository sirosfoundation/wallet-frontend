/**
 * Token refresh utilities for automatic access token renewal.
 *
 * This module provides functionality to:
 * - Refresh access tokens using refresh tokens
 * - Retry failed requests after token refresh
 * - Prevent concurrent refresh attempts
 */

import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import { jsonParseTaggedBinary, jsonStringifyTaggedBinary } from '../util';
import { getStoredTenant } from '../lib/tenant';

// Module-level state for managing concurrent refresh attempts
let isRefreshing = false;
let refreshPromise: Promise<RefreshResult> | null = null;

export interface RefreshResult {
	success: boolean;
	appToken?: string;
	refreshToken?: string;
}

export interface TokenRefreshConfig {
	backendUrl: string;
	getRefreshToken: () => string | null;
	setAppToken: (token: string) => void;
	setRefreshToken: (token: string) => void;
	clearSession: () => void;
}

/**
 * Refresh the access token using the refresh token.
 * Prevents concurrent refresh attempts by deduplicating requests.
 */
export async function refreshAccessToken(config: TokenRefreshConfig): Promise<RefreshResult> {
	const refreshToken = config.getRefreshToken();

	if (!refreshToken) {
		return { success: false };
	}

	// If already refreshing, wait for the existing request
	if (isRefreshing && refreshPromise) {
		return refreshPromise;
	}

	isRefreshing = true;
	refreshPromise = performRefresh(config, refreshToken);

	try {
		const result = await refreshPromise;
		return result;
	} finally {
		isRefreshing = false;
		refreshPromise = null;
	}
}

async function performRefresh(
	config: TokenRefreshConfig,
	refreshToken: string
): Promise<RefreshResult> {
	try {
		const response = await axios.post(
			`${config.backendUrl}/user/token/refresh`,
			{ refreshToken },
			{
				headers: {
					'Content-Type': 'application/json',
					'X-Tenant-ID': getStoredTenant() || 'default',
				},
				transformResponse: (data) => data ? jsonParseTaggedBinary(data) : data,
			}
		);

		if (response.data?.appToken) {
			config.setAppToken(response.data.appToken);

			// Handle token rotation - backend may issue new refresh token
			if (response.data.refreshToken) {
				config.setRefreshToken(response.data.refreshToken);
			}

			return {
				success: true,
				appToken: response.data.appToken,
				refreshToken: response.data.refreshToken,
			};
		}

		return { success: false };
	} catch (error) {
		console.warn('Token refresh failed:', error);

		// If refresh token is expired or invalid, clear the session
		if (axios.isAxiosError(error)) {
			const status = error.response?.status;
			if (status === 401 || status === 403) {
				config.clearSession();
			}
		}

		return { success: false };
	}
}

/**
 * Check if an error is a 401 Unauthorized that might be recoverable via token refresh.
 */
export function isUnauthorizedError(error: unknown): error is AxiosError {
	return axios.isAxiosError(error) && error.response?.status === 401;
}

/**
 * Execute an API request with automatic token refresh on 401 errors.
 *
 * @param requestFn - Function that performs the API request
 * @param refreshConfig - Configuration for token refresh
 * @param retried - Internal flag to prevent infinite retry loops
 * @returns The response from the API request
 */
export async function withTokenRefresh<T>(
	requestFn: () => Promise<T>,
	refreshConfig: TokenRefreshConfig,
	retried = false
): Promise<T> {
	try {
		return await requestFn();
	} catch (error) {
		// Only attempt refresh on 401 errors and if we haven't already retried
		if (!retried && isUnauthorizedError(error)) {
			const refreshResult = await refreshAccessToken(refreshConfig);

			if (refreshResult.success) {
				// Retry the original request with the new token
				return withTokenRefresh(requestFn, refreshConfig, true);
			}
		}

		// Re-throw if refresh failed or error is not 401
		throw error;
	}
}

/**
 * Create a request function that includes token refresh capability.
 * This is useful for wrapping existing request functions.
 */
export function createRefreshableRequest<TArgs extends unknown[], TResult>(
	requestFn: (...args: TArgs) => Promise<TResult>,
	getRefreshConfig: () => TokenRefreshConfig
): (...args: TArgs) => Promise<TResult> {
	return async (...args: TArgs): Promise<TResult> => {
		return withTokenRefresh(
			() => requestFn(...args),
			getRefreshConfig()
		);
	};
}

// For testing: reset module state
export function _resetRefreshState(): void {
	isRefreshing = false;
	refreshPromise = null;
}
