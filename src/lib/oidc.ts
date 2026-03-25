/**
 * OIDC PKCE Flow Utilities
 * 
 * Handles OIDC authentication flows for the OIDC gate feature.
 * Supports two modes:
 * 1. Browser redirect - Standard PKCE flow using browser navigation
 * 2. Native bridge - Uses native app's OIDC SDK (AppAuth-iOS/Android)
 * 
 * Token storage is purpose-specific to prevent cross-contamination
 * between registration and login gates.
 */

import type { OIDCProviderConfig } from '../api/types';

// Storage keys for OIDC tokens and state
const STORAGE_PREFIX = 'oidc_gate_';
const TOKEN_KEY_SUFFIX = '_token';
const STATE_KEY_SUFFIX = '_state';
const VERIFIER_KEY_SUFFIX = '_verifier';

export type OIDCGatePurpose = 'registration' | 'login';
export type OIDCFlowMode = 'browser-redirect' | 'native-bridge';

/**
 * Native bridge interface for WebView apps.
 * Native apps inject this object to handle OIDC flows via their native SDK.
 */
export interface NativeOIDCBridge {
	/** Check if native OIDC is available */
	isAvailable(): boolean;

	/** 
	 * Start OIDC flow via native SDK (AppAuth-iOS/Android)
	 * Returns promise that resolves with ID token
	 */
	startFlow(config: {
		issuer: string;
		clientId: string;
		scopes: string;
	}): Promise<{ idToken: string }>;
}

declare global {
	interface Window {
		NativeOIDCBridge?: NativeOIDCBridge;
	}
}

/**
 * Detect which OIDC flow mode to use.
 * Native bridge takes precedence if available.
 */
export function getOIDCFlowMode(): OIDCFlowMode {
	if (typeof window !== 'undefined' && window.NativeOIDCBridge?.isAvailable?.()) {
		return 'native-bridge';
	}
	return 'browser-redirect';
}

/**
 * Configuration for OIDC flow
 */
export interface OIDCFlowConfig {
	issuer: string;
	clientId: string;
	redirectUri: string;
	scopes: string;
}

/**
 * OIDC state stored during browser redirect flow
 */
interface OIDCState {
	purpose: OIDCGatePurpose;
	nonce: string;
	returnPath: string;
	formData?: Record<string, string>;
}

/**
 * Generate a cryptographically random string
 */
function generateRandomString(length: number): string {
	const array = new Uint8Array(length);
	crypto.getRandomValues(array);
	return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('').slice(0, length);
}

/**
 * Generate PKCE code verifier (43-128 characters)
 */
function generateCodeVerifier(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return base64UrlEncode(array);
}

/**
 * Generate PKCE code challenge from verifier
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Base64url encode
 */
function base64UrlEncode(buffer: Uint8Array): string {
	const base64 = btoa(String.fromCharCode(...buffer));
	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Get storage key for a given purpose and type
 */
function getStorageKey(purpose: OIDCGatePurpose, suffix: string): string {
	return `${STORAGE_PREFIX}${purpose}${suffix}`;
}

/**
 * Store OIDC state before redirect
 */
function storeOIDCState(purpose: OIDCGatePurpose, state: OIDCState, verifier: string): void {
	sessionStorage.setItem(getStorageKey(purpose, STATE_KEY_SUFFIX), JSON.stringify(state));
	sessionStorage.setItem(getStorageKey(purpose, VERIFIER_KEY_SUFFIX), verifier);
}

/**
 * Retrieve and clear OIDC state after redirect
 */
function retrieveOIDCState(purpose: OIDCGatePurpose): { state: OIDCState; verifier: string } | null {
	const stateKey = getStorageKey(purpose, STATE_KEY_SUFFIX);
	const verifierKey = getStorageKey(purpose, VERIFIER_KEY_SUFFIX);

	const stateJson = sessionStorage.getItem(stateKey);
	const verifier = sessionStorage.getItem(verifierKey);

	if (!stateJson || !verifier) {
		return null;
	}

	// Clear after retrieval
	sessionStorage.removeItem(stateKey);
	sessionStorage.removeItem(verifierKey);

	try {
		return { state: JSON.parse(stateJson), verifier };
	} catch {
		return null;
	}
}

/**
 * Store ID token for a given purpose
 */
export function storeIdToken(purpose: OIDCGatePurpose, token: string): void {
	sessionStorage.setItem(getStorageKey(purpose, TOKEN_KEY_SUFFIX), token);
}

/**
 * Get stored ID token for a given purpose
 */
export function getStoredIdToken(purpose: OIDCGatePurpose): string | null {
	return sessionStorage.getItem(getStorageKey(purpose, TOKEN_KEY_SUFFIX));
}

/**
 * Clear stored ID token for a given purpose
 */
export function clearStoredIdToken(purpose: OIDCGatePurpose): void {
	sessionStorage.removeItem(getStorageKey(purpose, TOKEN_KEY_SUFFIX));
}

/**
 * Clear all OIDC state for a given purpose
 */
export function clearOIDCState(purpose: OIDCGatePurpose): void {
	sessionStorage.removeItem(getStorageKey(purpose, TOKEN_KEY_SUFFIX));
	sessionStorage.removeItem(getStorageKey(purpose, STATE_KEY_SUFFIX));
	sessionStorage.removeItem(getStorageKey(purpose, VERIFIER_KEY_SUFFIX));
}

/**
 * Build OIDC configuration from provider config
 */
export function buildOIDCConfig(
	provider: OIDCProviderConfig,
	redirectUri: string
): OIDCFlowConfig {
	return {
		issuer: provider.issuer,
		clientId: provider.client_id,
		redirectUri,
		scopes: provider.scopes || 'openid profile email',
	};
}

/**
 * Discover OIDC endpoints from issuer
 */
async function discoverOIDCEndpoints(issuer: string): Promise<{
	authorizationEndpoint: string;
	tokenEndpoint: string;
	jwksUri: string;
}> {
	const wellKnownUrl = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
	const response = await fetch(wellKnownUrl);

	if (!response.ok) {
		throw new Error(`Failed to fetch OIDC configuration: ${response.status}`);
	}

	const config = await response.json();

	return {
		authorizationEndpoint: config.authorization_endpoint,
		tokenEndpoint: config.token_endpoint,
		jwksUri: config.jwks_uri,
	};
}

/**
 * Start OIDC flow using native bridge
 */
async function startNativeBridgeFlow(
	config: OIDCFlowConfig,
	purpose: OIDCGatePurpose
): Promise<{ idToken: string }> {
	if (!window.NativeOIDCBridge) {
		throw new Error('Native OIDC bridge not available');
	}

	const result = await window.NativeOIDCBridge.startFlow({
		issuer: config.issuer,
		clientId: config.clientId,
		scopes: config.scopes,
	});

	// Store the token
	storeIdToken(purpose, result.idToken);

	return result;
}

/**
 * Start OIDC flow using browser redirect
 */
async function startBrowserRedirectFlow(
	config: OIDCFlowConfig,
	purpose: OIDCGatePurpose,
	returnPath: string,
	formData?: Record<string, string>
): Promise<void> {
	// Discover endpoints
	const endpoints = await discoverOIDCEndpoints(config.issuer);

	// Generate PKCE parameters
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = await generateCodeChallenge(codeVerifier);
	const nonce = generateRandomString(32);
	const stateParam = generateRandomString(32);

	// Store state for callback
	const state: OIDCState = {
		purpose,
		nonce,
		returnPath,
		formData,
	};
	storeOIDCState(purpose, state, codeVerifier);

	// Also store state param mapping
	sessionStorage.setItem(`${STORAGE_PREFIX}state_${stateParam}`, purpose);

	// Build authorization URL
	const authUrl = new URL(endpoints.authorizationEndpoint);
	authUrl.searchParams.set('response_type', 'code');
	authUrl.searchParams.set('client_id', config.clientId);
	authUrl.searchParams.set('redirect_uri', config.redirectUri);
	authUrl.searchParams.set('scope', config.scopes);
	authUrl.searchParams.set('state', stateParam);
	authUrl.searchParams.set('nonce', nonce);
	authUrl.searchParams.set('code_challenge', codeChallenge);
	authUrl.searchParams.set('code_challenge_method', 'S256');

	// Redirect to IdP
	window.location.href = authUrl.toString();
}

/**
 * Start OIDC flow - automatically selects browser or native mode
 */
export async function startOIDCFlow(
	config: OIDCFlowConfig,
	purpose: OIDCGatePurpose,
	options?: {
		returnPath?: string;
		formData?: Record<string, string>;
	}
): Promise<{ idToken: string } | void> {
	const mode = getOIDCFlowMode();

	if (mode === 'native-bridge') {
		return startNativeBridgeFlow(config, purpose);
	} else {
		const returnPath = options?.returnPath || window.location.pathname + window.location.search;
		return startBrowserRedirectFlow(config, purpose, returnPath, options?.formData);
	}
}

/**
 * Handle OIDC callback (browser redirect mode only)
 * Should be called on the callback page (/cb or /id/:tenantId/cb)
 */
export async function handleOIDCCallback(
	config: OIDCFlowConfig
): Promise<{
	idToken: string;
	purpose: OIDCGatePurpose;
	returnPath: string;
	formData?: Record<string, string>;
}> {
	const url = new URL(window.location.href);
	const code = url.searchParams.get('code');
	const stateParam = url.searchParams.get('state');
	const error = url.searchParams.get('error');
	const errorDescription = url.searchParams.get('error_description');

	// Check for error response
	if (error) {
		throw new Error(errorDescription || error);
	}

	if (!code || !stateParam) {
		throw new Error('Missing authorization code or state');
	}

	// Look up purpose from state param
	const purpose = sessionStorage.getItem(`${STORAGE_PREFIX}state_${stateParam}`) as OIDCGatePurpose;
	sessionStorage.removeItem(`${STORAGE_PREFIX}state_${stateParam}`);

	if (!purpose) {
		throw new Error('Invalid or expired state');
	}

	// Retrieve stored state
	const storedData = retrieveOIDCState(purpose);
	if (!storedData) {
		throw new Error('Session expired, please try again');
	}

	const { state, verifier } = storedData;

	// Discover token endpoint
	const endpoints = await discoverOIDCEndpoints(config.issuer);

	// Exchange code for tokens
	const tokenResponse = await fetch(endpoints.tokenEndpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: config.redirectUri,
			client_id: config.clientId,
			code_verifier: verifier,
		}),
	});

	if (!tokenResponse.ok) {
		const errorData = await tokenResponse.json().catch(() => ({}));
		throw new Error(errorData.error_description || errorData.error || 'Token exchange failed');
	}

	const tokens = await tokenResponse.json();
	const idToken = tokens.id_token;

	if (!idToken) {
		throw new Error('No ID token in response');
	}

	// TODO: Validate ID token (nonce, signature, etc.)
	// For now, we rely on backend validation

	// Store the token
	storeIdToken(purpose, idToken);

	return {
		idToken,
		purpose: state.purpose,
		returnPath: state.returnPath,
		formData: state.formData,
	};
}

/**
 * Extract claims from JWT ID token (without validation)
 * Used for display purposes only - actual validation happens on backend
 */
export function extractIdTokenClaims(idToken: string): Record<string, unknown> {
	try {
		const [, payload] = idToken.split('.');
		const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
		return JSON.parse(decoded);
	} catch {
		return {};
	}
}

/**
 * Get display name from ID token claims
 */
export function getDisplayNameFromToken(idToken: string): string | null {
	const claims = extractIdTokenClaims(idToken);
	return (claims.name as string) || (claims.email as string) || (claims.sub as string) || null;
}
