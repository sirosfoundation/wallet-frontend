/**
 * TenantContext - React context for multi-tenancy support.
 *
 * URL Structure:
 * - All tenants use /id/ prefix: /id/{tenantId}/, /id/{tenantId}/settings
 * - Single-tenant deployments omit the prefix (routes at root)
 *
 * The tenant ID can come from multiple sources (in order of precedence):
 * 1. URL path parameter (/id/:tenantId/*) - for path-based routing
 * 2. Explicitly passed tenantId prop - for components that know the tenant
 * 3. SessionStorage - cached from previous login/registration
 *
 * Usage:
 *   // In App.tsx, wrap tenant-scoped routes:
 *   <Route path="/id/:tenantId/*" element={<TenantProvider><TenantRoutes /></TenantProvider>} />
 *
 *   // In components:
 *   const { tenantId } = useTenant();
 *   api.signupWebauthn(name, keystore, ..., tenantId);
 *
 * See go-wallet-backend/docs/adr/011-multi-tenancy.md for full design.
 */

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { getStoredTenant, setStoredTenant, clearStoredTenant, buildTenantRoutePath, TENANT_PATH_PREFIX, isMultiTenant } from '../lib/tenant';
import { BACKEND_URL } from '../config';
import type { TenantConfig, OIDCProviderConfig } from '../api/types';

export interface TenantContextValue {
	/** Current tenant ID (from URL, prop, or storage) */
	effectiveTenantId: string | undefined;
	/** The tenant id in the URL path. Might not match `effectiveTenantId` */
	urlTenantId: string | undefined;
	/** Whether we're in a tenant-scoped context */
	isMultiTenant: boolean;
	/** Fetched tenant configuration (includes OIDC gate config) */
	tenantConfig: TenantConfig | null;
	/** Whether tenant config is currently being fetched */
	isLoadingConfig: boolean;
	/** Error from fetching tenant config */
	configError: string | null;
	// -- OIDC gate helpers --
	/** Check if registration requires OIDC gate */
	requiresOIDCGateForRegistration: () => boolean;
	/** Check if login requires OIDC gate */
	requiresOIDCGateForLogin: () => boolean;
	/** Get OIDC provider config for registration (if gated) */
	getRegistrationOIDCProvider: () => OIDCProviderConfig | null;
	/** Get OIDC provider config for login (if gated) */
	getLoginOIDCProvider: () => OIDCProviderConfig | null;
	/** Switch to a different tenant (navigates to new tenant's home) */
	switchTenant: (newTenantId: string) => void;
	/** Clear tenant context (on logout) */
	clearTenant: () => void;
	/** Build a tenant-aware path for links and navigation */
	buildPath: (subPath?: string) => string;
}

const TenantContext = createContext<TenantContextValue | null>(null);

interface TenantProviderProps {
	children: ReactNode;
	/** Optional explicit tenant ID (overrides URL parsing) */
	tenantId?: string;
}

/**
 * TenantProvider extracts tenant from URL path and provides it to children.
 *
 * For path-based routing, the URL structure is:
 *   /id/{tenantId}/settings
 *   /id/{tenantId}/add
 *   /id/{tenantId}/cb?code=...
 *
 * The provider:
 * 1. Reads tenantId from URL params (useParams)
 * 2. Falls back to sessionStorage if not in URL
 * 3. Stores tenant in sessionStorage when found in URL
 * 4. Fetches tenant config (including OIDC gate settings) from backend
 */
export function TenantProvider({ children, tenantId: propTenantId }: TenantProviderProps) {
	// Get tenant from URL path parameter
	// This requires the route to be defined as /id/:tenantId/*
	const { tenantId: urlTenantId } = useParams<{ tenantId: string }>();

	// Note: With the /id/ prefix approach, default tenant uses root paths (/) and
	// custom tenants use /id/{tenantId}/* paths. No redirect needed for /default/*.

	// Get the already-stored tenant (from prior authentication)
	const storedTenantId = getStoredTenant();

	// Determine effective tenant ID:
	// - If user is already authenticated (has stored tenant), use stored tenant
	// - Otherwise, use prop > URL > storage as before
	const effectiveTenantId = storedTenantId || propTenantId || urlTenantId;

	// Calculate initial tenant to determine loading state
	const initialTenantToFetch = urlTenantId || effectiveTenantId;

	// Tenant config state
	// Initialize isLoadingConfig to true if there's a tenant to fetch, to avoid race conditions
	// where components check the loading state before the effect runs
	const [tenantConfig, setTenantConfig] = useState<TenantConfig | null>(null);
	const [isLoadingConfig, setIsLoadingConfig] = useState(!!initialTenantToFetch);
	const [configError, setConfigError] = useState<string | null>(null);

	// Fetch tenant config from backend
	useEffect(() => {
		// Use URL tenant for pre-auth config (registration/login decisions)
		// Fall back to effectiveTenantId for authenticated users
		const tenantToFetch = urlTenantId || effectiveTenantId;
		if (!tenantToFetch) {
			setTenantConfig(null);
			return;
		}

		// Create AbortController to cancel pending requests when tenant changes
		const abortController = new AbortController();

		// Clear previous config when tenant changes to avoid stale data
		setTenantConfig(null);
		setIsLoadingConfig(true);
		setConfigError(null);

		const fetchTenantConfig = async () => {
			try {
				const response = await axios.get<TenantConfig>(
					`${BACKEND_URL}/api/v1/tenants/${tenantToFetch}/config`,
					{
						timeout: 10000,
						signal: abortController.signal,
						headers: {
							// Include X-Tenant-ID for proxy routing even though
							// the endpoint uses URL path for tenant identification
							'X-Tenant-ID': tenantToFetch,
						},
					}
				);
				setTenantConfig(response.data);
			} catch (error) {
				// Ignore aborted requests (component unmounted or tenant changed)
				if (axios.isCancel(error)) {
					return;
				}
				if (axios.isAxiosError(error)) {
					if (error.response?.status === 404) {
						// Tenant config endpoint not found — may be an older backend that
						// doesn't serve per-tenant config yet. Fall back to defaults.
						console.warn(
							`[TenantContext] Tenant config 404 for "${tenantToFetch}". ` +
							`Using default config (no OIDC gate).`
						);
						setTenantConfig({ id: tenantToFetch, name: tenantToFetch });
					} else {
						// Non-404 error — fall back to defaults for backward compatibility
						// rather than blocking the user from logging in.
						console.error(
							`[TenantContext] Failed to fetch config for "${tenantToFetch}": ${error.message}. ` +
							`Falling back to default config.`
						);
						setTenantConfig({ id: tenantToFetch, name: tenantToFetch });
					}
				} else {
					console.error('[TenantContext] Unexpected error fetching tenant config:', error);
					setTenantConfig({ id: tenantToFetch, name: tenantToFetch });
				}
			} finally {
				setIsLoadingConfig(false);
			}
		};

		fetchTenantConfig();

		// Cleanup: abort pending request when deps change or component unmounts
		return () => {
			abortController.abort();
		};
	}, [urlTenantId, effectiveTenantId]);

	// Only sync URL tenant to storage if:
	// 1. There's a URL tenant, AND
	// 2. No existing stored tenant (user is not yet authenticated)
	// This prevents an authenticated user from having their tenant overwritten
	// when they navigate to a different tenant's URL
	useEffect(() => {
		if (urlTenantId && !storedTenantId) {
			setStoredTenant(urlTenantId);
		}
	}, [urlTenantId, storedTenantId]);

	// OIDC gate helper functions
	const requiresOIDCGateForRegistration = useCallback((): boolean => {
		const mode = tenantConfig?.oidc_gate?.mode;
		return mode === 'registration' || mode === 'both';
	}, [tenantConfig]);

	const requiresOIDCGateForLogin = useCallback((): boolean => {
		const mode = tenantConfig?.oidc_gate?.mode;
		return mode === 'login' || mode === 'both';
	}, [tenantConfig]);

	const getRegistrationOIDCProvider = useCallback((): OIDCProviderConfig | null => {
		if (!requiresOIDCGateForRegistration()) return null;
		return tenantConfig?.oidc_gate?.registration_op || null;
	}, [tenantConfig, requiresOIDCGateForRegistration]);

	const getLoginOIDCProvider = useCallback((): OIDCProviderConfig | null => {
		if (!requiresOIDCGateForLogin()) return null;
		// Fall back to registration_op if login_op not specified
		return tenantConfig?.oidc_gate?.login_op || tenantConfig?.oidc_gate?.registration_op || null;
	}, [tenantConfig, requiresOIDCGateForLogin]);

	const switchTenant = useCallback((newTenantId: string) => {
		setStoredTenant(newTenantId);
		// Use full page reload instead of React navigation to ensure tenant-specific
		// config (potentially in index.html) is loaded fresh
		window.location.href = `/${TENANT_PATH_PREFIX}/${newTenantId}/`;
	}, []);

	const clearTenant = useCallback(() => {
		clearStoredTenant();
	}, []);

	const buildPath = useCallback((subPath?: string) => {
		return buildTenantRoutePath(effectiveTenantId, subPath);
	}, [effectiveTenantId]);

	const value = useMemo<TenantContextValue>(() => ({
		effectiveTenantId,
		urlTenantId,
		isMultiTenant: isMultiTenant(),
		tenantConfig,
		isLoadingConfig,
		configError,
		requiresOIDCGateForRegistration,
		requiresOIDCGateForLogin,
		getRegistrationOIDCProvider,
		getLoginOIDCProvider,
		switchTenant,
		clearTenant,
		buildPath,
	}), [effectiveTenantId, urlTenantId, tenantConfig, isLoadingConfig, configError,
		requiresOIDCGateForRegistration, requiresOIDCGateForLogin,
		getRegistrationOIDCProvider, getLoginOIDCProvider,
		switchTenant, clearTenant, buildPath]);

	return (
		<TenantContext.Provider value={value}>
			{children}
		</TenantContext.Provider>
	);
}

/**
 * Hook to access tenant context.
 * Must be used within a TenantProvider.
 */
export function useTenant(): TenantContextValue {
	const context = useContext(TenantContext);
	const { tenantId: urlTenantId } = useParams<{ tenantId: string }>();

	if (!context) {
		// Return a default context for components outside TenantProvider
		// This allows the app to work in single-tenant mode
		const storedTenant = getStoredTenant();
		return {
			effectiveTenantId: storedTenant,
			urlTenantId,
			isMultiTenant: false,
			tenantConfig: null,
			isLoadingConfig: false,
			configError: null,
			requiresOIDCGateForRegistration: () => false,
			requiresOIDCGateForLogin: () => false,
			getRegistrationOIDCProvider: () => null,
			getLoginOIDCProvider: () => null,
			switchTenant: () => {
				console.warn('switchTenant called outside TenantProvider');
			},
			clearTenant: clearStoredTenant,
			buildPath: (subPath?: string) => buildTenantRoutePath(storedTenant, subPath),
		};
	}
	return context;
}

/**
 * Hook to get tenant ID, throwing if not available.
 * Use this when tenant is required (e.g., in tenant-scoped routes).
 */
export function useRequiredTenant(): string {
	const { effectiveTenantId } = useTenant();
	if (!effectiveTenantId) {
		throw new Error('Tenant ID is required but not available. Ensure this component is within a tenant-scoped route (/id/:tenantId/*).');
	}
	return effectiveTenantId;
}
