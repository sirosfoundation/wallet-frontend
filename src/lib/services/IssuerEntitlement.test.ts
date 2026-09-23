import { describe, it, expect, vi } from 'vitest';
import type { HttpClient } from 'wallet-common';
import {
	createIssuerEntitlementChecker,
	describeEntitlementFindings,
	isEntitlementRefused,
	type IssuerEntitlement,
} from './IssuerEntitlement';

vi.mock('@/logger', () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/** An HttpClient whose POST returns a fixed response, recording what it was sent. */
function stubClient(response: { status: number; data: unknown } | Error) {
	const post = vi.fn(async () => {
		if (response instanceof Error) throw response;
		return { status: response.status, headers: {}, data: response.data };
	});
	return { client: { get: vi.fn(), post } as unknown as HttpClient, post };
}

const config = (client: HttpClient) => ({
	httpClient: client,
	backendUrl: 'https://backend.example.com/',
	getAuthToken: () => 'token-1',
	tenantId: 'tenant-1',
});

const refusal = {
	allowed: false,
	mode: 'fail',
	evaluated: true,
	findings: [{
		code: 'attestation_type_not_registered',
		message: 'provider is not registered to issue dc+sd-jwt',
		credential_type: 'eu.europa.ec.eudi.pid.1',
	}],
	entitlements: ['http://data.europa.eu/eudi/id/pid-provider'],
	subject: 'VATSE-1234567890',
};

describe('createIssuerEntitlementChecker', () => {
	it('sends the offered credential types so the per-type check can run', async () => {
		const { client, post } = stubClient({ status: 200, data: { issuer_entitlement: refusal } });
		const check = createIssuerEntitlementChecker(config(client));

		await check({
			issuerId: 'https://issuer.example.com',
			credentialTypes: ['eu.europa.ec.eudi.pid.1'],
		});

		expect(post).toHaveBeenCalledTimes(1);
		const [url, body, headers] = post.mock.calls[0] as unknown as [string, Record<string, unknown>, Record<string, string>];
		// The trailing slash on backendUrl must not produce a double slash.
		expect(url).toBe('https://backend.example.com/v1/resolve');
		expect(body).toMatchObject({
			subject_id: 'https://issuer.example.com',
			subject_type: 'url',
			resource_type: 'credential_issuer',
			credential_types: ['eu.europa.ec.eudi.pid.1'],
		});
		expect(headers['Authorization']).toBe('Bearer token-1');
		expect(headers['X-Tenant-ID']).toBe('tenant-1');
	});

	it('omits credential_types entirely when none are on offer', async () => {
		const { client, post } = stubClient({ status: 200, data: { issuer_entitlement: refusal } });
		await createIssuerEntitlementChecker(config(client))({ issuerId: 'https://issuer.example.com' });

		const body = (post.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
		expect(body).not.toHaveProperty('credential_types');
	});

	it('parses a refusal with its findings', async () => {
		const { client } = stubClient({ status: 200, data: { issuer_entitlement: refusal } });
		const result = await createIssuerEntitlementChecker(config(client))({
			issuerId: 'https://issuer.example.com',
		});

		expect(result).not.toBeNull();
		expect(result!.allowed).toBe(false);
		expect(result!.evaluated).toBe(true);
		expect(result!.findings[0].code).toBe('attestation_type_not_registered');
		expect(result!.findings[0].credential_type).toBe('eu.europa.ec.eudi.pid.1');
		expect(result!.subject).toBe('VATSE-1234567890');
	});

	it('tolerates the fields the backend omits when empty', async () => {
		// pkg/issuertrust marks findings/entitlements/subject `omitempty`, so a
		// clean pass arrives with none of them. If that failed to parse, every
		// well-formed pass would be downgraded to "not checked".
		const { client } = stubClient({
			status: 200,
			data: { issuer_entitlement: { allowed: true, mode: 'warn', evaluated: true } },
		});
		const result = await createIssuerEntitlementChecker(config(client))({
			issuerId: 'https://issuer.example.com',
		});

		expect(result).toEqual({
			allowed: true,
			mode: 'warn',
			evaluated: true,
			findings: [],
			entitlements: [],
			subject: undefined,
		});
	});

	it('reports "not checked" rather than a refusal when the backend is unreachable', async () => {
		// A backend outage must not become an outage for every issuer, and must
		// equally never be recorded as a pass. null is neither.
		const { client } = stubClient(new Error('network down'));
		const result = await createIssuerEntitlementChecker(config(client))({
			issuerId: 'https://issuer.example.com',
		});
		expect(result).toBeNull();
	});

	it('reports "not checked" when the response carries no decision', async () => {
		// An older backend, or one with the check switched off, simply omits the
		// field. That is not a refusal.
		const { client } = stubClient({ status: 200, data: { decision: true, context: {} } });
		const result = await createIssuerEntitlementChecker(config(client))({
			issuerId: 'https://issuer.example.com',
		});
		expect(result).toBeNull();
	});

	it('reports "not checked" on a non-200', async () => {
		const { client } = stubClient({ status: 503, data: {} });
		const result = await createIssuerEntitlementChecker(config(client))({
			issuerId: 'https://issuer.example.com',
		});
		expect(result).toBeNull();
	});

	it('discards a malformed decision rather than guessing at it', async () => {
		const { client } = stubClient({ status: 200, data: { issuer_entitlement: { mode: 'fail' } } });
		const result = await createIssuerEntitlementChecker(config(client))({
			issuerId: 'https://issuer.example.com',
		});
		// No `allowed` boolean means there is no decision to act on - refusing
		// on a shape we do not understand would block legitimate issuance.
		expect(result).toBeNull();
	});
});

describe('isEntitlementRefused', () => {
	const decision = (over: Partial<IssuerEntitlement>): IssuerEntitlement => ({
		allowed: true, mode: 'warn', evaluated: true, findings: [], entitlements: [], ...over,
	});

	it('refuses only on an explicit allowed:false', () => {
		expect(isEntitlementRefused(decision({ allowed: false }))).toBe(true);
	});

	it('does not refuse in warn mode, even with findings', () => {
		// Warn is the default until the ARF's 24-month registration obligation
		// takes effect; refusing before then would break legitimate issuance.
		expect(isEntitlementRefused(decision({
			allowed: true,
			mode: 'warn',
			findings: [{ code: 'no_registration_certificate', message: 'none present' }],
		}))).toBe(false);
	});

	it('does not refuse when the check never ran', () => {
		expect(isEntitlementRefused(null)).toBe(false);
	});
});

describe('describeEntitlementFindings', () => {
	it('names every finding so a user can tell why', () => {
		const text = describeEntitlementFindings({
			allowed: false, mode: 'fail', evaluated: true, entitlements: [],
			findings: [
				{ code: 'not_an_attestation_provider', message: 'no provider role' },
				{ code: 'registration_certificate_expired', message: 'expired at 2026-01-01T00:00:00Z' },
			],
		});
		expect(text).toContain('not_an_attestation_provider');
		expect(text).toContain('registration_certificate_expired');
	});

	it('still says something useful when there are no findings', () => {
		const text = describeEntitlementFindings({
			allowed: false, mode: 'fail', evaluated: true, findings: [], entitlements: [],
		});
		expect(text).not.toBe('');
	});
});
