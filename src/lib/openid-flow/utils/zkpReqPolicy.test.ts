import { describe, it, expect } from 'vitest';
import type { OID4VPVerifiedRequest } from '../types/OID4VPTypes';
import { requestsZkpReq, zkpReqRefusal } from './zkpReqPolicy';

const signedEncrypted: OID4VPVerifiedRequest = {
	clientId: 'x509_san_dns:verifier.example.com',
	clientIdScheme: 'x509_san_dns',
	responseMode: 'direct_post.jwt',
	signed: true,
	signatureVerification: 'verified',
};

describe('requestsZkpReq', () => {
	it('is true when any credential query has the zkp_req format', () => {
		expect(requestsZkpReq({ credentials: [{ id: 'a', format: 'dc+sd-jwt' }, { id: 'zkp', format: 'zkp_req' }] })).toBe(true);
	});

	it.each([
		['an sd-jwt query', { credentials: [{ id: 'a', format: 'dc+sd-jwt' }] }],
		['an mdoc query', { credentials: [{ id: 'a', format: 'mso_mdoc' }] }],
		['an empty query', { credentials: [] }],
		['no credentials member', {}],
		['a non-array credentials member', { credentials: 'zkp_req' }],
		['null', null],
		['undefined', undefined],
		['a string', 'zkp_req'],
	])('is false for %s', (_label, query) => {
		expect(requestsZkpReq(query)).toBe(false);
	});

	it('is not fooled by a verifier that merely advertises zkp_req support', () => {
		expect(requestsZkpReq({ credentials: [{ id: 'a', format: 'dc+sd-jwt' }], client_metadata: { vp_formats_supported: { zkp_req: {} } } })).toBe(false);
	});
});

describe('zkpReqRefusal', () => {
	it('lets a signed, verified request with an encrypted response proceed', () => {
		expect(zkpReqRefusal(signedEncrypted, 'not-yet-known')).toBeNull();
		expect(zkpReqRefusal(signedEncrypted, 'present')).toBeNull();
	});

	it.each([
		['no verified_request at all', undefined],
		['an unsigned request', { ...signedEncrypted, signed: false, signatureVerification: 'none' as const }],
		['a redirect_uri client (never signed)', { ...signedEncrypted, clientIdScheme: 'redirect_uri', signed: false, signatureVerification: 'none' as const }],
		['a deferred verification (not verified)', { ...signedEncrypted, signed: false, signatureVerification: 'deferred' as const }],
		['signed set without a verified verdict', { ...signedEncrypted, signatureVerification: 'deferred' as const }],
		['a verified verdict without signed', { ...signedEncrypted, signed: false }],
		['a missing signature state', { ...signedEncrypted, signed: undefined, signatureVerification: undefined }],
	])('refuses %s as not signed', (_label, request) => {
		expect(zkpReqRefusal(request, 'present')).toMatch(/signed request object/);
	});

	it.each(['direct_post', 'query', 'fragment', undefined])('refuses a signed request over the %s response mode', (responseMode) => {
		expect(zkpReqRefusal({ ...signedEncrypted, responseMode }, 'not-yet-known')).toMatch(/encrypted/);
	});

	it('refuses a signed direct_post.jwt request whose sign step carries no response_encryption', () => {
		expect(zkpReqRefusal(signedEncrypted, 'absent')).toMatch(/encrypted/);
	});

	it('reports the signature first when both requirements fail', () => {
		expect(zkpReqRefusal({ ...signedEncrypted, signed: false, responseMode: 'direct_post' }, 'absent')).toMatch(/signed request object/);
	});
});
