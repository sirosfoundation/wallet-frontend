/**
 * OIDCCallback - Handle OIDC redirect callback
 *
 * This page handles the redirect back from the IdP after authentication.
 * It exchanges the authorization code for tokens and stores the ID token,
 * then redirects back to the login page.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTenant } from '../../context/TenantContext';
import { handleOIDCCallback, buildOIDCConfig } from '../../lib/oidc';
import LoginLayout from '../../components/Auth/LoginLayout';
import { LoaderCircle, CheckCircle, AlertCircle } from 'lucide-react';
import Button from '../../components/Buttons/Button';

type CallbackState =
	| { status: 'processing' }
	| { status: 'success'; returnPath: string }
	| { status: 'error'; message: string };

export default function OIDCCallback() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { buildPath, getRegistrationOIDCProvider, getLoginOIDCProvider, isLoadingConfig } = useTenant();

	const [state, setState] = useState<CallbackState>({ status: 'processing' });

	useEffect(() => {
		// Wait for tenant config to load
		if (isLoadingConfig) {
			return;
		}

		const processCallback = async () => {
			try {
				// Determine the redirect URI (same as what was used to start the flow)
				const redirectUri = window.location.origin + window.location.pathname;

				// Get provider config - we need to figure out which one was used
				// The purpose is stored in the state parameter
				const url = new URL(window.location.href);
				const stateParam = url.searchParams.get('state');

				if (!stateParam) {
					throw new Error('Missing state parameter');
				}

				// Look up purpose from sessionStorage (stored by startOIDCFlow)
				const purpose = sessionStorage.getItem(`oidc_gate_state_${stateParam}`);

				if (purpose !== 'registration' && purpose !== 'login') {
					throw new Error('Invalid or expired session');
				}

				// Get the appropriate provider config
				const providerConfig = purpose === 'registration'
					? getRegistrationOIDCProvider()
					: getLoginOIDCProvider();

				if (!providerConfig) {
					throw new Error('OIDC provider not configured');
				}

				const config = buildOIDCConfig(providerConfig, redirectUri);

				// Process the callback
				const result = await handleOIDCCallback(config);

				setState({ status: 'success', returnPath: result.returnPath });

				// Redirect back to the original return path (or login as a fallback) after a brief delay
				setTimeout(() => {
					const targetPath = result.returnPath || buildPath('/login');
					navigate(targetPath, { replace: true });
				}, 1500);

			} catch (error) {
				console.error('OIDC callback error:', error);
				setState({
					status: 'error',
					message: error instanceof Error ? error.message : 'Authentication failed',
				});
			}
		};

		processCallback();
	}, [isLoadingConfig, getRegistrationOIDCProvider, getLoginOIDCProvider, buildPath, navigate]);

	const handleRetry = () => {
		// Go back to login page to start over
		navigate(buildPath('/login'), { replace: true });
	};

	return (
		<LoginLayout heading={t('oidcGate.callbackProcessing')}>
			<div className="relative p-8 sm:px-12 space-y-4 md:space-y-6 lg:space-y-8 bg-white rounded-lg dark:bg-dm-gray-900 border border-lm-gray-400 dark:border-dm-gray-600">
				{state.status === 'processing' && (
					<div className="flex flex-col items-center gap-4 py-8">
						<LoaderCircle className="rounded-full text-brand-base dark:text-white animate-spin" size={48} />
						<p className="text-lm-gray-700 dark:text-dm-gray-300">
							{t('oidcGate.callbackProcessing')}
						</p>
					</div>
				)}

				{state.status === 'success' && (
					<div className="flex flex-col items-center gap-4 py-8">
						<CheckCircle className="text-lm-green dark:text-dm-green" size={48} />
						<p className="text-lm-green dark:text-dm-green font-medium">
							{t('oidcGate.callbackSuccess')}
						</p>
					</div>
				)}

				{state.status === 'error' && (
					<div className="flex flex-col items-center gap-4 py-8">
						<AlertCircle className="text-lm-red dark:text-dm-red" size={48} />
						<p className="text-lm-red dark:text-dm-red font-medium">
							{t('oidcGate.callbackError')}
						</p>
						<p className="text-sm text-lm-gray-600 dark:text-dm-gray-400 text-center">
							{state.message}
						</p>
						<Button
							id="oidc-callback-retry"
							onClick={handleRetry}
							variant="primary"
						>
							{t('common.tryAgain')}
						</Button>
					</div>
				)}
			</div>
		</LoginLayout>
	);
}
