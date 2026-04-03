/**
 * useOIDCGate - React hook for managing OIDC gate flow state
 *
 * This hook manages the state machine for OIDC gate authentication:
 * - Detects if gate is required based on tenant config
 * - Tracks flow state (idle, awaiting-oidc, oidc-complete, error)
 * - Handles starting OIDC flow and processing completion
 * - Provides ID token for API calls after successful authentication
 */

import { useState, useCallback, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import {
	type OIDCGatePurpose,
	type OIDCFlowConfig,
	buildOIDCConfig,
	startOIDCFlow,
	getStoredIdToken,
	clearStoredIdToken,
	getDisplayNameFromToken,
	getOIDCFlowMode,
} from '../lib/oidc';
import type { OIDCProviderConfig } from '../api/types';

/**
 * OIDC gate flow states
 */
export type OIDCGateState =
	| { status: 'idle' }
	| { status: 'loading' }
	| { status: 'awaiting-oidc' }
	| { status: 'oidc-complete'; token: string; displayName: string | null }
	| { status: 'error'; message: string };

export interface UseOIDCGateOptions {
	/** The purpose of this gate (registration or login) */
	purpose: OIDCGatePurpose;
	/** Callback URL for browser redirect flow (e.g., /oidc/cb or /id/:tenantId/oidc/cb) */
	redirectUri: string;
}

export interface UseOIDCGateResult {
	/** Current state of the OIDC gate flow */
	state: OIDCGateState;
	/** Whether this purpose requires an OIDC gate */
	requiresGate: boolean;
	/** Whether gate has been completed (token available) */
	isGateComplete: boolean;
	/** The OIDC provider config for this purpose (if gated) */
	providerConfig: OIDCProviderConfig | null;
	/** The ID token from completed OIDC flow */
	idToken: string | null;
	/** Start the OIDC authentication flow */
	startFlow: (formData?: Record<string, string>) => Promise<void>;
	/** Reset the gate state (e.g., on error retry) */
	reset: () => void;
	/** Clear the stored token (e.g., on logout) */
	clearToken: () => void;
}

/**
 * Hook to manage OIDC gate flow for registration or login
 */
export function useOIDCGate({ purpose, redirectUri }: UseOIDCGateOptions): UseOIDCGateResult {
	const {
		isLoadingConfig,
		requiresOIDCGateForRegistration,
		requiresOIDCGateForLogin,
		getRegistrationOIDCProvider,
		getLoginOIDCProvider,
	} = useTenant();

	// Determine if this purpose requires a gate
	const requiresGate = purpose === 'registration'
		? requiresOIDCGateForRegistration()
		: requiresOIDCGateForLogin();

	// Get the provider config for this purpose
	const providerConfig = purpose === 'registration'
		? getRegistrationOIDCProvider()
		: getLoginOIDCProvider();

	// State management
	const [state, setState] = useState<OIDCGateState>({ status: 'idle' });

	// Check for existing token on mount and config changes
	useEffect(() => {
		if (isLoadingConfig) {
			setState({ status: 'loading' });
			return;
		}

		if (!requiresGate) {
			setState({ status: 'idle' });
			return;
		}

		// Check if we already have a token
		const existingToken = getStoredIdToken(purpose);
		if (existingToken) {
			setState({
				status: 'oidc-complete',
				token: existingToken,
				displayName: getDisplayNameFromToken(existingToken),
			});
		} else {
			setState({ status: 'idle' });
		}
	}, [isLoadingConfig, requiresGate, purpose]);

	// Start the OIDC flow
	const startFlow = useCallback(async (formData?: Record<string, string>) => {
		if (!providerConfig) {
			setState({ status: 'error', message: 'OIDC provider not configured' });
			return;
		}

		setState({ status: 'awaiting-oidc' });

		try {
			const config: OIDCFlowConfig = buildOIDCConfig(providerConfig, redirectUri);
			const mode = getOIDCFlowMode();

			if (mode === 'native-bridge') {
				// Native bridge returns immediately with token
				const result = await startOIDCFlow(config, purpose, { formData });
				if (result && 'idToken' in result) {
					setState({
						status: 'oidc-complete',
						token: result.idToken,
						displayName: getDisplayNameFromToken(result.idToken),
					});
				}
			} else {
				// Browser redirect - this will navigate away
				// State will be restored on callback page
				await startOIDCFlow(config, purpose, {
					returnPath: window.location.pathname + window.location.search,
					formData,
				});
				// If we get here without redirect, something went wrong
				// (but normally we won't get here as the page will redirect)
			}
		} catch (error) {
			setState({
				status: 'error',
				message: error instanceof Error ? error.message : 'OIDC flow failed',
			});
		}
	}, [providerConfig, purpose, redirectUri]);

	// Reset state (for retry)
	const reset = useCallback(() => {
		clearStoredIdToken(purpose);
		setState({ status: 'idle' });
	}, [purpose]);

	// Clear token
	const clearToken = useCallback(() => {
		clearStoredIdToken(purpose);
		setState({ status: 'idle' });
	}, [purpose]);

	// Derived values
	const isGateComplete = state.status === 'oidc-complete';
	const idToken = state.status === 'oidc-complete' ? state.token : null;

	return {
		state,
		requiresGate,
		isGateComplete,
		providerConfig,
		idToken,
		startFlow,
		reset,
		clearToken,
	};
}
