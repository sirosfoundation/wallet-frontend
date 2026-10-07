import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/context/TenantContext';
import type { UseOIDCGateResult } from '@/hooks/useOIDCGate';
import OIDCGateFlowStatus from './OIDCGateFlowStatus';

type Props = {
	gate: UseOIDCGateResult;
	purpose: 'login' | 'registration';
	username?: string;
	error?: React.ReactNode;
	children: React.ReactNode;
};

export default function OIDCGateBoundary({ gate, purpose, username = '', error, children }: Props) {
	const { t } = useTranslation();
	const { tenantConfig } = useTenant();
	const isLoading = gate.state.status === 'loading';
	const showGate = gate.requiresGate && !gate.isGateComplete && !isLoading;

	if (isLoading) {
		return <div className="mb-4 text-center py-4"><p className="dark:text-white">{t('common.loading')}</p></div>;
	}
	if (showGate && !gate.providerConfig) {
		return (
			<div className="mb-4 text-lm-red dark:text-dm-red pt-2">
				{t('loginSignup.oidcGateError', 'OIDC gate configuration error. Please contact support.')}
			</div>
		);
	}

	const status = gate.providerConfig && (
		<OIDCGateFlowStatus
			state={gate.state}
			provider={gate.providerConfig}
			purpose={purpose}
			tenantDisplayName={tenantConfig?.display_name || tenantConfig?.name}
			onStart={() => gate.startFlow({ username })}
			onRetry={gate.reset}
		/>
	);

	if (showGate) {
		return (
			<div className="mb-4">
				{status}
				{error && <div className="text-lm-red dark:text-dm-red pt-2 mt-4">{error}</div>}
			</div>
		);
	}

	return (
		<>
			{gate.isGateComplete && gate.state.status === 'oidc-complete' && <div className="mb-4">{status}</div>}
			{children}
		</>	
	);
}
