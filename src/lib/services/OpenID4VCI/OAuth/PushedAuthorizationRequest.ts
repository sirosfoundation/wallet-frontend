import * as oauth4webapi from 'oauth4webapi';
import { useCallback, useMemo, useRef } from "react";
import { OpenidAuthorizationServerMetadata } from "wallet-common";
import { MODE } from '@/config';
import { useHttpClient } from '@/hooks/useHttpClient';
import { attachWalletAttestationHeaders, WalletAttestation, WIAKeyPair } from '../WIA';

const { customFetch, allowInsecureRequests } = oauth4webapi;
const isDev = MODE === 'development';

function normalizeHeaders(h: any): Record<string, string> {
	const out: Record<string, string> = {};
	if (!h) return out;
	for (const [k, v] of Object.entries(h)) {
		if (v === undefined || v === null) continue;
		out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
	}
	return out;
}

export function usePushedAuthorizationRequest() {
	const httpClient = useHttpClient();
	// Set by sendPushedAuthorizationRequest itself (from asMeta/params) right
	// before the request goes out - myCustomFetch is memoized independent of
	// any single call, so it can't take these as direct arguments; mirrors
	// TokenRequest.ts's ref-based pattern for the same reason.
	const walletAttestation = useRef<WalletAttestation | null>(null);
	const clientIdRef = useRef<string | null>(null);
	const issuerRef = useRef<string | null>(null);

	const myCustomFetch = useMemo(() => {
		return async (url: string, options?: RequestInit) => {
			const method = (options?.method ?? 'POST').toLowerCase();
			// OAuth-Client-Attestation / -PoP (draft-ietf-oauth-attestation-based-client-auth):
			// PAR is where OAuth client authentication actually happens for a
			// PAR-only AS, so the attestation must be attached here, not only at
			// the token endpoint - see TokenRequest.ts's myCustomFetch for the
			// other half of this same mechanism.
			const headers = await attachWalletAttestationHeaders(
				normalizeHeaders(options?.headers),
				walletAttestation.current,
				clientIdRef.current,
				issuerRef.current,
			);
			const body = options?.body;

			let data: string | undefined;
			if (typeof body === 'string') {
				data = body;
			} else if (body instanceof URLSearchParams) {
				data = body.toString();
			} else if (body != null) {
				data = String(body);
			}

			let wrapped;
			if (method === 'post') {
				wrapped = await httpClient.post(url, data, headers);
			} else {
				throw new Error(`Unsupported method in customFetch: ${method}`);
			}

			// wrapped = { status, headers, data } where `data` is the real AS response body
			const resHeaders = normalizeHeaders(wrapped.headers);
			const contentType = resHeaders['content-type'] ?? 'application/json';
			const bodyText =
				typeof wrapped.data === 'string'
					? wrapped.data
					: contentType.includes('application/json')
						? JSON.stringify(wrapped.data)
						: String(wrapped.data ?? '');

			return new Response(bodyText, {
				status: wrapped.status ?? 500,
				headers: resHeaders,
			});
		};
	}, [httpClient]);

	// Builds an oauth4webapi DPoPHandle from a WIAKeyPair, so the same key used
	// as the WIA's cnf claim can also bind the resulting authorization code to
	// this DPoP key (RFC 9449 section 10, the `dpop_jkt` PAR parameter) -
	// mirrors TokenRequest.ts's getDPoPHandle, which does the equivalent for
	// the token endpoint.
	const getDPoPHandle = useCallback(async (client: oauth4webapi.Client, keyPair: WIAKeyPair) => {
		const publicKey = await crypto.subtle.importKey(
			'jwk',
			keyPair.publicKeyJwk as JsonWebKey,
			{ name: 'ECDSA', namedCurve: 'P-256' },
			true,
			['verify']
		);
		return oauth4webapi.DPoP(client, {
			privateKey: keyPair.privateKey as CryptoKey,
			publicKey: publicKey as CryptoKey,
		});
	}, []);

	const sendPushedAuthorizationRequest = useCallback(
		async (
			asMeta: OpenidAuthorizationServerMetadata,
			params: Record<string,string>,
			attestation?: { wia: string; keyPair: WIAKeyPair },
		) => {
			const endpoint = asMeta.pushed_authorization_request_endpoint;
			if (!endpoint) {
				throw new Error('AS metadata missing pushed_authorization_request_endpoint');
			}
			const client: oauth4webapi.Client = { client_id: params.client_id };

			clientIdRef.current = params.client_id;
			issuerRef.current = asMeta.issuer;
			walletAttestation.current = attestation ?? null;

			// Generate PKCE
			const code_verifier = oauth4webapi.generateRandomCodeVerifier();
			const code_challenge = await oauth4webapi.calculatePKCECodeChallenge(code_verifier);
			params.code_challenge = code_challenge;
			params.code_challenge_method = "S256";

			const body = new URLSearchParams(params);

			const as: oauth4webapi.AuthorizationServer = {
				issuer: asMeta.issuer,
				pushed_authorization_request_endpoint: endpoint,
			};

			// Bind the resulting authorization code to the same key as the WIA's
			// cnf claim, when this AS supports DPoP - only meaningful together
			// with an attestation, since there's no cnf key to bind to otherwise.
			const DPoP = attestation && asMeta.dpop_signing_alg_values_supported
				? await getDPoPHandle(client, attestation.keyPair)
				: undefined;

			const response = await oauth4webapi.pushedAuthorizationRequest(
				as,
				client,
				oauth4webapi.None(),
				body,
				{
					[customFetch]: myCustomFetch,
					[allowInsecureRequests]: isDev,
					...(DPoP ? { DPoP } : {}),
				}
			);

			const json = await response.json();
			if (json?.error) {
				throw new Error(`PAR failed: ${json.error} ${json.error_description ?? ''}`.trim());
			}
			if (!json?.request_uri) {
				throw new Error(`PAR failed: missing request_uri. Got: ${JSON.stringify(json)}`);
			}
			return { request_uri: json.request_uri, code_verifier, rawResponse: json };
		},
		[myCustomFetch, getDPoPHandle]
	);

	return useMemo(() => ({ sendPushedAuthorizationRequest }), [sendPushedAuthorizationRequest]);
}
