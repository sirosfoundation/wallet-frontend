import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, waitFor } from '@testing-library/react';
import OpenIDFlowCallback from './OpenIDFlowCallback';

const { log, flow } = vi.hoisted(() => ({
	log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
	flow: {
		handleCredentialOffer: vi.fn(),
		requestWithPreAuthorization: vi.fn(),
		handleAuthorizationResponse: vi.fn(),
		handleReceivedCredentials: vi.fn(),
	},
}));

vi.mock('@/logger', () => ({ logger: log, jsonToLog: (value: unknown) => JSON.stringify(value) }));
vi.mock('@/context/OIDFlowTransportContext', () => ({ useOIDFlowTransport: () => ({ transportReady: true }) }));
vi.mock('@/context/TenantContext', () => ({ useTenant: () => ({ buildPath: () => '/' }) }));
vi.mock('react-router', () => ({ Navigate: () => null, useNavigate: () => vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/hooks/useErrorDialog', () => ({ default: () => ({ displayError: vi.fn() }) }));
vi.mock('@/hooks/useOID4VCIFlow', () => ({ default: () => flow }));
vi.mock('@/hooks/useOID4VPFlow', () => ({ default: () => ({}) }));
vi.mock('@/context/OpenID4VPContext', () => ({ default: {} }));
vi.mock('@/context/TxCodeInputContext', () => ({
	useTxCodeInput: () => ({ requestTxCode: vi.fn(), state: { isOpen: false }, handleSubmit: vi.fn(), handleCancel: vi.fn() }),
}));
vi.mock('@/components/Popups/TxCodeInputPopup', () => ({ TxCodeInputPopup: () => null }));
vi.mock('@/components/Popups/IssuanceWarningPopup', () => ({ default: () => null }));
vi.mock('@/components/Shared/Spinner', () => ({ default: () => null }));
vi.mock('@/hooks/useStatusContext', () => ({ useStatusContext: () => ({ blockUpdates: () => () => undefined }) }));
vi.mock('@/lib/openid-flow/platforms/dc-api', () => ({ DCAPISession: {} }));
vi.mock('@/components/flows/PresentCredentialsFlow', () => ({
	ConformantCredentials: {},
	PresentCredentialsFlow: () => null,
	usePresentCredentialsFlow: () => ({}),
}));

const SEED = 'ef'.repeat(16);
const CREDENTIAL = 'eyJhbGciOiJFUzI1NiJ9.issued.credential~disclosure~';

describe('OpenIDFlowCallback: logging a completed offer', () => {
	beforeEach(() => {
		Object.values(log).forEach((fn) => fn.mockClear());
		window.history.pushState({}, '', '/cb?credential_offer_uri=https%3A%2F%2Fissuer.example.com%2Foffer');
	});

	it('never logs the flow result: a decrypted seed and the credentials stay out of every log call', async () => {
		flow.handleCredentialOffer.mockResolvedValue({
			success: true,
			credentials: [{ format: 'dc+sd-jwt', credential: CREDENTIAL }],
			credentialMetadata: { 'org.siros.secret_seed': { ns: SEED }, display: [{ name: 'PID' }] },
			credentialIssuerIdentifier: 'https://issuer.example.com',
		});
		flow.handleReceivedCredentials.mockResolvedValue({ success: true });

		render(<OpenIDFlowCallback />);

		await waitFor(() => expect(flow.handleReceivedCredentials).toHaveBeenCalled());
		const everything = JSON.stringify(Object.values(log).flatMap((fn) => fn.mock.calls));
		expect(everything).not.toContain(SEED);
		expect(everything).not.toContain(CREDENTIAL);
		expect(everything).not.toContain('org.siros.secret_seed');
	});

	it('logs only non-sensitive status fields of the offer result', async () => {
		flow.handleCredentialOffer.mockResolvedValue({
			success: true,
			credentials: [{ format: 'dc+sd-jwt', credential: CREDENTIAL }],
			credentialMetadata: { 'org.siros.secret_seed': { ns: SEED } },
			preAuthorizedCode: 'pre-auth-code-secret',
		});
		flow.handleReceivedCredentials.mockResolvedValue({ success: true });
		flow.requestWithPreAuthorization.mockResolvedValue({ success: false });

		render(<OpenIDFlowCallback />);

		await waitFor(() => expect(log.debug).toHaveBeenCalledWith('Received credential offer:', expect.anything()));
		const [, logged] = log.debug.mock.calls.find(([message]) => message === 'Received credential offer:')!;
		expect(logged).toEqual({
			success: true,
			credentialCount: 1,
			authorizationRequired: false,
			preAuthorized: true,
			txCodeRequired: false,
			errorCode: undefined,
		});
		expect(JSON.stringify(log.debug.mock.calls)).not.toContain('pre-auth-code-secret');
	});
});

describe('OpenIDFlowCallback: no whole result or response is ever handed to the logger', () => {
	it('passes no flow result variable to a logger call', () => {
		const source = readFileSync(resolve(process.cwd(), 'src/pages/OpenIDFlowCallback/OpenIDFlowCallback.tsx'), 'utf8');

		for (const variable of ['offer', 'sendResult', 'preAuthResult', 'result']) {
			expect(source).not.toMatch(new RegExp(`logger\\.\\w+\\([^)]*,\\s*${variable}\\s*\\)`));
		}
	});
});
