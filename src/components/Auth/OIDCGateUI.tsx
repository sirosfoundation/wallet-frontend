/**
 * OIDCGateUI - Container component for OIDC gate flow
 *
 * Renders different UI states based on gate flow status:
 * - idle: Shows IdP button with explanation text
 * - awaiting-oidc: Shows loading/progress indicator
 * - oidc-complete: Shows success with verified identity
 * - error: Shows error message with retry option
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, AlertCircle } from 'lucide-react';
import Button from '../Buttons/Button';
import OIDCGateButton from './OIDCGateButton';
import type { OIDCGateState } from '../../hooks/useOIDCGate';
import type { OIDCProviderConfig } from '../../api/types';
import type { OIDCGatePurpose } from '../../lib/oidc';

export interface OIDCGateUIProps {
	/** Current state of the OIDC gate flow */
	state: OIDCGateState;
	/** OIDC provider configuration */
	provider: OIDCProviderConfig;
	/** Purpose: registration or login */
	purpose: OIDCGatePurpose;
	/** Callback when user clicks to start OIDC flow */
	onStart: () => void;
	/** Callback when user wants to retry after error */
	onRetry: () => void;
}

export default function OIDCGateUI({
	state,
	provider,
	purpose,
	onStart,
	onRetry,
}: OIDCGateUIProps) {
	const { t } = useTranslation();

	const displayName = provider.display_name || 'your organization';

	// Loading config state
	if (state.status === 'loading') {
		return (
			<div className="text-center py-4">
				<p className="dark:text-white">{t('common.loading')}</p>
			</div>
		);
	}

	// Idle state - show IdP button
	if (state.status === 'idle') {
		return (
			<div className="space-y-4">
				<OIDCGateButton
					provider={provider}
					purpose={purpose}
					onClick={onStart}
				/>
				<p className="text-sm text-lm-gray-600 dark:text-dm-gray-400 text-center">
					{purpose === 'registration'
						? t('oidcGate.registrationExplanation', { provider: displayName })
						: t('oidcGate.loginExplanation', { provider: displayName })
					}
				</p>
			</div>
		);
	}

	// Awaiting OIDC - flow in progress
	if (state.status === 'awaiting-oidc') {
		return (
			<div className="text-center py-4 space-y-4">
				<div className="flex justify-center">
					<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
				</div>
				<p className="dark:text-white">
					{t('oidcGate.awaitingAuth')}
				</p>
				<p className="text-sm text-lm-gray-600 dark:text-dm-gray-400">
					{t('oidcGate.awaitingAuthHint')}
				</p>
			</div>
		);
	}

	// OIDC complete - show success
	if (state.status === 'oidc-complete') {
		return (
			<div className="space-y-4">
				<div className="flex items-center justify-center gap-2 p-3 bg-lm-green/10 dark:bg-dm-green/10 rounded-lg border border-lm-green dark:border-dm-green">
					<CheckCircle className="text-lm-green dark:text-dm-green" size={20} />
					<span className="text-lm-green dark:text-dm-green font-medium">
						{t('oidcGate.verified', { name: state.displayName || t('oidcGate.verifiedUser') })}
					</span>
				</div>
			</div>
		);
	}

	// Error state
	if (state.status === 'error') {
		return (
			<div className="space-y-4">
				<div className="flex items-center gap-2 p-3 bg-lm-red/10 dark:bg-dm-red/10 rounded-lg border border-lm-red dark:border-dm-red">
					<AlertCircle className="text-lm-red dark:text-dm-red shrink-0" size={20} />
					<span className="text-lm-red dark:text-dm-red">
						{state.message || t('oidcGate.errorGeneric')}
					</span>
				</div>
				<Button
					id="oidc-gate-retry-button"
					onClick={onRetry}
					variant="primary"
					additionalClassName="w-full"
				>
					{t('common.tryAgain')}
				</Button>
			</div>
		);
	}

	return null;
}
