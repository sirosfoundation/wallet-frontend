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
 *
 * File organisation:
 *   1. Types & constants
 *   2. Storage utilities
 *   3. Encoding & PKCE helpers
 *   4. Token parsing
 *   5. Configuration & discovery
 *   6. Flow entry-points & callback
 */

import type { OIDCProviderConfig } from '../api/types';

// ---------------------------------------------------------------------------
// 1. Types & constants
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = 'oidc_gate_';
const TOKEN_KEY_SUFFIX = '_token';
const STATE_KEY_SUFFIX = '_state';
const VERIFIER_KEY_SUFFIX = '_verifier';

export type OIDCGatePurpose = 'registration' | 'login';
export type OIDCFlowMode = 'browser-redirect' | 'native-bridge';

export interface OIDCFlowConfig {
	issuer: string;
	clientId: string;
	redirectUri: string;
	scopes: string;
}

interface OIDCState {
	purpose: OIDCGatePurpose;
	nonce: string;
	returnPath: string;
	formData?: Record<string, string>;
}

/**
 * Native bridge interface for WebView apps.
 * Native apps inject this object to handle OIDC flows via their native SDK.
 */
export interface NativeOIDCBridge {
	isAvailable(): boolean;
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

// ---------------------------------------------------------------------------
// 2. Storage utilities
// ---------------------------------------------------------------------------

function getStorageKey(purpose: OIDCGatePurpose, suffix: string): string {
	return `${STORAGE_PREFIX}${purpose}${suffix}`;
}

function storeOIDCState(purpose: OIDCGatePurpose, state: OIDCState, verifier: string): void {
	sessionStorage.setItem(getStorageKey(purpose, STATE_KEY_SUFFIX), JSON.stringify(state));
	sessionStorage.setItem(getStorageKey(purpose, VERIFIER_KEY_SUFFIX), verifier);
}

function retrieveOIDCState(purpose: OIDCGatePurpose): { state: OIDCState; verifier: string } | null {
	const stateKey = getStorageKey(purpose, STATE_KEY_SUFFIX);
	const verifierKey = getStorageKey(purpose, VERIFIER_KEY_SUFFIX);

	const stateJson = sessionStorage.getItem(stateKey);
	const verifier = sessionStorage.getItem(verifierKey);

	if (!stateJson || !verifier) {
		return null;
	}

	sessionStorage.removeItem(stateKey);
	sessionStorage.removeItem(verifierKey);

	try {
		return { state: JSON.parse(stateJson), verifier };
	} catch {
		return null;
	}
}

export function storeIdToken(purpose: OIDCGatePurpose, token: string): void {
	sessionStorage.setItem(getStorageKey(purpose, TOKEN_KEY_SUFFIX), token);
}

export function getStoredIdToken(purpose: OIDCGatePurpose): string | null {
	return sessionStorage.getItem(getStorageKey(purpose, TOKEN_KEY_SUFFIX));
}

export function clearStoredIdToken(purpose: OIDCGatePurpose): void {
	sessionStorage.removeItem(getStorageKey(purpose, TOKEN_KEY_SUFFIX));
}

export function clearOIDCState(purpose: OIDCGatePurpose): void {
	sessionStorage.removeItem(getStorageKey(purpose, TOKEN_KEY_SUFFIX));
	sessionStorage.removeItem(getStorageKey(purpose, STATE_KEY_SUFFIX));
	sessionStorage.removeItem(getStorageKey(purpose, VERIFIER_KEY_SUFFIX));
}

// ---------------------------------------------------------------------------
// 3. Encoding & PKCE helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(buffer: Uint8Array): string {
	const base64 = btoa(String.fromCharCode(...buffer));
	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateRandomString(length: number): string {
	const bytesNeeded = Math.ceil((length * 6) / 8);
	const array = new Uint8Array(bytesNeeded);
	crypto.getRandomValues(array);
	return base64UrlEncode(array).slice(0, length);
}

function generateCodeVerifier(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return base64UrlEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return base64UrlEncode(new Uint8Array(digest));
}

// ---------------------------------------------------------------------------
// 4. Token parsing
// ---------------------------------------------------------------------------

/**
 * Extract claims from JWT ID token (without validation).
 * Used for display purposes only — actual validation happens on the backend.
 */
export function extractIdTokenClaims(idToken: string): Record<string, unknown> {
	try {
		const [, payload] = idToken.split('.');
		if (!payload) {
			return {};
		}

		const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
		const paddedBase64 = base64 + '='.repeat((4 - (base64.length % 4)) % 4);

		const decoded = atob(paddedBase64);
		return JSON.parse(decoded);
	} catch {
		return {};
	}
}

export function getDisplayNameFromToken(idToken: string): string | null {
	const claims = extractIdTokenClaims(idToken);
	return (claims.name as string) || (claims.email as string) || (claims.sub as string) || null;
}

// ---------------------------------------------------------------------------
// 5. Configuration & discovery
// ---------------------------------------------------------------------------

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

export function getOIDCFlowMode(): OIDCFlowMode {
	if (typeof window !== 'undefined' && window.NativeOIDCBridge?.isAvailable?.()) {
		return 'native-bridge';
	}
	return 'browser-redirect';
}

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

// ---------------------------------------------------------------------------
// 6. Flow entry-points & callback
// ---------------------------------------------------------------------------

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

	storeIdToken(purpose, result.idToken);
	return result;
}

async function startBrowserRedirectFlow(
	config: OIDCFlowConfig,
	purpose: OIDCGatePurpose,
	returnPath: string,
	formData?: Record<string, string>
): Promise<void> {
	const endpoints = await discoverOIDCEndpoints(config.issuer);

	const codeVerifier = generateCodeVerifier();
	const codeChallenge = await generateCodeChallenge(codeVerifier);
	const nonce = generateRandomString(32);
	const stateParam = generateRandomString(32);

	const state: OIDCState = {
		purpose,
		nonce,
		returnPath,
		formData,
	};
	storeOIDCState(purpose, state, codeVerifier);

	sessionStorage.setItem(`${STORAGE_PREFIX}state_${stateParam}`, purpose);

	const authUrl = new URL(endpoints.authorizationEndpoint);
	authUrl.searchParams.set('response_type', 'code');
	authUrl.searchParams.set('client_id', config.clientId);
	authUrl.searchParams.set('redirect_uri', config.redirectUri);
	authUrl.searchParams.set('scope', config.scopes);
	authUrl.searchParams.set('state', stateParam);
	authUrl.searchParams.set('nonce', nonce);
	authUrl.searchParams.set('code_challenge', codeChallenge);
	authUrl.searchParams.set('code_challenge_method', 'S256');

	window.location.href = authUrl.toString();
}

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
 * Handle OIDC callback (browser redirect mode only).
 * Should be called on the callback page (/oidc/cb or /id/:tenantId/oidc/cb).
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

	if (error) {
		throw new Error(errorDescription || error);
	}

	if (!code || !stateParam) {
		throw new Error('Missing authorization code or state');
	}

	const purpose = sessionStorage.getItem(`${STORAGE_PREFIX}state_${stateParam}`) as OIDCGatePurpose;
	sessionStorage.removeItem(`${STORAGE_PREFIX}state_${stateParam}`);

	if (!purpose) {
		throw new Error('Invalid or expired state');
	}

	const storedData = retrieveOIDCState(purpose);
	if (!storedData) {
		throw new Error('Session expired, please try again');
	}

	const { state, verifier } = storedData;

	const endpoints = await discoverOIDCEndpoints(config.issuer);

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

	storeIdToken(purpose, idToken);

	return {
		idToken,
		purpose: state.purpose,
		returnPath: state.returnPath,
		formData: state.formData,
	};
}
