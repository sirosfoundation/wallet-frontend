import { JWK, KeyLike, SignJWT } from "jose";
import { generateRandomIdentifier } from "../../utils/generateRandomIdentifier";
import { logger } from "@/logger";

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
): Promise<string | undefined> {
	try {
		const challengeResponse = await post("/wallet-provider/wia/challenge", {});
		const { challenge } = challengeResponse.data;
		if (!challenge || typeof challenge !== "string") {
			logger.debug("Cannot parse challenge from wallet-backend-server WIA challenge response");
			return undefined;
		}

		const pop = await new SignJWT({ nonce: challenge })
			.setProtectedHeader({
				alg: "ES256",
				typ: "oauth-client-attestation-pop+jwt",
				jwk: dpopKeyPair.publicKeyJwk,
			})
			.setIssuer(clientId)
			.setIssuedAt()
			.setExpirationTime("5m")
			.setJti(generateRandomIdentifier(8))
			.sign(dpopKeyPair.privateKey);

		const generateResponse = await post("/wallet-provider/wia/generate", {
			pop,
			challenge,
			client_id: clientId,
		});
		const wia = generateResponse.data?.wallet_instance_attestation;
		if (!wia || typeof wia !== "string") {
			logger.debug("Cannot parse wallet_instance_attestation from wallet-backend-server WIA generate response");
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
			alg: "ES256",
			typ: "oauth-client-attestation-pop+jwt",
		})
		.setIssuer(clientId)
		.setAudience(authorizationServerIssuer)
		.setIssuedAt()
		.setExpirationTime("5m")
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
): Promise<string | undefined> {
	if (!enabled) {
		return undefined;
	}
	if (existingWia) {
		return existingWia;
	}
	return await requestWIA(post, dpopKeyPair, clientId);
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
			"oauth-client-attestation": walletAttestation.wia,
			"oauth-client-attestation-pop": pop,
		};
	}
	catch (err) {
		logger.debug(err);
		return headers;
	}
}
