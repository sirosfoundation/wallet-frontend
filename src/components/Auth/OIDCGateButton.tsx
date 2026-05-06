/**
 * OIDCGateButton - Button to initiate OIDC IdP authentication
 *
 * Displays a branded button with the IdP's display name.
 * Shows "Sign up with {IdP}" or "Sign in with {IdP}" based on purpose.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../Buttons/Button';
import { Building2 } from 'lucide-react';
import type { OIDCProviderConfig } from '../../api/types';
import type { OIDCGatePurpose } from '../../lib/oidc';

export interface OIDCGateButtonProps {
	/** OIDC provider configuration */
	provider: OIDCProviderConfig;
	/** Purpose: registration or login */
	purpose: OIDCGatePurpose;
	/** Click handler to start OIDC flow */
	onClick: () => void;
	/** Whether button is disabled */
	disabled?: boolean;
	/** Whether OIDC flow is in progress */
	loading?: boolean;
}

export default function OIDCGateButton({
	provider,
	purpose,
	onClick,
	disabled = false,
	loading = false,
}: OIDCGateButtonProps) {
	const { t } = useTranslation();

	const displayName = provider.display_name || 'Identity Provider';
	const buttonLabel = purpose === 'registration'
		? t('oidcGate.signUpWith', { provider: displayName })
		: t('oidcGate.signInWith', { provider: displayName });

	return (
		<Button
			id={`oidc-gate-${purpose}-button`}
			onClick={onClick}
			variant="primary"
			size="lg"
			textSize="md"
			disabled={disabled || loading}
			additionalClassName="w-full items-center justify-center"
		>
			<Building2 size={20} className="inline mr-2 shrink-0" />
			{loading ? t('common.loading') : buttonLabel}
		</Button>
	);
}
