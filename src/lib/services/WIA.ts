import { exportJWK, generateKeyPair, JWK, KeyLike, SignJWT } from 'jose';
import { generateRandomIdentifier } from '../utils/generateRandomIdentifier';
import { logger } from '@/logger';

export interface WIAKeyPair {
	privateKey: KeyLike | Uint8Array;
	publicKeyJwk: JWK;
}

type BackendApiPost = (path: string, body: unknown) => Promise<{ data: any }>;

/**
 * Request a Wallet Instance Attestation (WIA) from go-wallet-backend, bound
 * to dpopKeyPair.
 *
 * Per EC TS03 section 2.2.1.1 / security/wia-strategy.md section 3.3, the
 * WIA `cnf` key MUST be the same key used as the DPoP key for the OID4VCI
 * flow it's presented in. So this is called once per flow, right after the
 * DPoP keypair for that flow is generated — not persisted or reused across
 * flows (each WIA is used at most once per issuance, matching the
 * single-use privacy design in wia-strategy.md section 10).
 *
 * Returns undefined if the backend doesn't support WIA (503
 * WIA_NOT_SUPPORTED) or the request fails for any other reason. WIA here is
 * Tier 3 (backend_attested, informative) — its absence must never block
 * issuance; an issuer that actually requires it will reject the flow on its
 * own, which is the correct place for that policy decision, not here.
 */
export async function requestWIA(
	post: BackendApiPost,
	dpopKeyPair: WIAKeyPair,
	clientId: string,
	walletProviderURI: string,
): Promise<string | undefined> {
	try {
		const challengeResponse = await post('/wallet-provider/wia/challenge', {});
		const { challenge } = challengeResponse.data;
		if (!challenge || typeof challenge !== 'string') {
			logger.debug('Cannot parse challenge from wallet-backend-server WIA challenge response');
			return undefined;
		}

		const pop = await new SignJWT({ nonce: challenge })
			.setProtectedHeader({
				alg: 'ES256',
				typ: 'oauth-client-attestation-pop+jwt',
				jwk: dpopKeyPair.publicKeyJwk,
			})
			.setIssuer(clientId)
			// go-wallet-backend's validatePop requires aud to match
			// WalletProvider.WIA.WalletProviderURI when configured
			// (internal/service/wia.go) - this is the WIA-REQUEST's own PoP,
			// proving possession to OUR wallet-provider backend, so the
			// audience is the wallet provider's own public identity
			// (ENGINE_URL - see src/config.ts), NOT the credential issuer
			// (that's buildClientAttestationPop's aud, a different PoP for a
			// different audience). Missing this claim was never caught before
			// since it was never exercised against a real backend until now
			// (WIA.test.ts mocks the backend entirely).
			.setAudience(walletProviderURI)
			.setIssuedAt()
			.setExpirationTime('5m')
			.setJti(generateRandomIdentifier(8))
			.sign(dpopKeyPair.privateKey);

		const generateResponse = await post('/wallet-provider/wia/generate', {
			pop,
			challenge,
			client_id: clientId,
		});
		const wia = generateResponse.data?.wallet_instance_attestation;
		if (!wia || typeof wia !== 'string') {
			logger.debug('Cannot parse wallet_instance_attestation from wallet-backend-server WIA generate response');
			return undefined;
		}
		return wia;
	}
	catch (err) {
		logger.debug(err);
		return undefined;
	}
}

/**
 * Build a fresh OAuth-Client-Attestation-PoP JWT for a single PAR/token
 * request to the credential issuer's authorization server.
 *
 * This is a DIFFERENT PoP than the one requestWIA sends to our own backend
 * above — different audience (the issuer's authorization server, not our
 * wallet provider), and no `jwk` header, since the issuer verifies it
 * against the public key already carried in the accompanying WIA's `cnf`
 * claim rather than a self-contained key. Must be freshly generated for
 * every request (anti-replay) — never reuse a PoP JWT across requests, even
 * to the same issuer.
 */
export async function buildClientAttestationPop(
	dpopKeyPair: WIAKeyPair,
	clientId: string,
	authorizationServerIssuer: string,
): Promise<string> {
	return await new SignJWT({})
		.setProtectedHeader({
			alg: 'ES256',
			typ: 'oauth-client-attestation-pop+jwt',
		})
		.setIssuer(clientId)
		.setAudience(authorizationServerIssuer)
		.setIssuedAt()
		.setExpirationTime('5m')
		.setJti(generateRandomIdentifier(8))
		.sign(dpopKeyPair.privateKey);
}

/**
 * Decide whether to (re-)request a WIA for the current OID4VCI flow, and do
 * so if needed. Pulled out of the OpenID4VCI flow orchestration so the
 * enabled/reuse decision is independently testable, rather than only
 * reachable by exercising the whole React hook.
 *
 * Reuses existingWia rather than requesting a fresh one — each flow's WIA
 * is requested at most once, matching the single-use-per-issuance design
 * (see requestWIA's docs above); a retry within the same flow (e.g. on a
 * DPoP nonce challenge) must not mint a second WIA for the same flow.
 */
export async function attestFlowIfEnabled(
	post: BackendApiPost,
	enabled: boolean,
	existingWia: string | undefined,
	dpopKeyPair: WIAKeyPair,
	clientId: string,
	walletProviderURI: string,
): Promise<string | undefined> {
	if (!enabled) {
		return undefined;
	}
	if (existingWia) {
		return existingWia;
	}
	return await requestWIA(post, dpopKeyPair, clientId, walletProviderURI);
}

export interface WalletAttestation {
	wia: string;
	keyPair: WIAKeyPair;
}

/**
 * Merge OAuth-Client-Attestation / -PoP headers into an existing headers
 * object for a single outgoing PAR/token request, when a wallet attestation
 * is present for this flow. Pulled out of TokenRequest.ts's myCustomFetch so
 * the header-building logic is testable without oauth4webapi/React
 * machinery — myCustomFetch itself just calls this and forwards the result.
 *
 * Returns headers unchanged (not a copy with attestation fields cleared) if
 * walletAttestation is absent, or if signing the fresh per-request PoP
 * fails — a PoP signing failure must not fail the whole token request, since
 * WIA here is Tier 3 (informative).
 */
export async function attachWalletAttestationHeaders(
	headers: Record<string, string>,
	walletAttestation: WalletAttestation | null,
	clientId: string,
	authorizationServerIssuer: string,
): Promise<Record<string, string>> {
	if (!walletAttestation) {
		return headers;
	}
	try {
		const pop = await buildClientAttestationPop(walletAttestation.keyPair, clientId, authorizationServerIssuer);
		return {
			...headers,
			'oauth-client-attestation': walletAttestation.wia,
			'oauth-client-attestation-pop': pop,
		};
	}
	catch (err) {
		logger.debug(err);
		return headers;
	}
}

/**
 * Generate a fresh attestation keypair, request a WIA bound to it, and build
 * the resulting OAuth-Client-Attestation/-PoP header VALUES for a single
 * flow - transport-agnostic (see OID4VCITypes.ts's clientAttestation/
 * clientAttestationPoP fields on OID4VCIFlowParams): every transport that
 * talks to a credential issuer needs the same two values, generated the same
 * way, once per flow; only the wire encoding differs per transport.
 *
 * clientId becomes the WIA's client_id (-> its sub claim, per
 * go-wallet-backend's pkg/service/wia.go) - it must match whatever
 * go-wallet-backend's engine resolves as req.ClientID for this flow (its
 * redirect_uri fallback for unregistered clients, internal/engine/oid4vci.go).
 * credentialIssuer is a separate value: the per-request PoP's audience,
 * since the PoP is sent to the credential issuer's PAR/token endpoint, not
 * back to the wallet itself.
 *
 * Never throws: WIA is Tier 3 (informative), so any failure here (backend
 * doesn't support WIA, network error, PoP signing failure) must degrade to
 * an attestation-less flow rather than block issuance.
 */
export async function generateFlowAttestation(
	post: BackendApiPost,
	enabled: boolean,
	clientId: string,
	credentialIssuer: string,
	walletProviderURI: string,
): Promise<{ clientAttestation?: string; clientAttestationPoP?: string }> {
	if (!enabled) {
		return {};
	}
	try {
		const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
		const publicKeyJwk = await exportJWK(publicKey);
		const keyPair: WIAKeyPair = { privateKey, publicKeyJwk };

		const wia = await attestFlowIfEnabled(post, enabled, undefined, keyPair, clientId, walletProviderURI);
		if (!wia) {
			return {};
		}

		const headers = await attachWalletAttestationHeaders({}, { wia, keyPair }, clientId, credentialIssuer);
		return {
			clientAttestation: headers['oauth-client-attestation'],
			clientAttestationPoP: headers['oauth-client-attestation-pop'],
		};
	}
	catch (err) {
		logger.debug('Wallet attestation unavailable for this flow', err);
		return {};
	}
}
