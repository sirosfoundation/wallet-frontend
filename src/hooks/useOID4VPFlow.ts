/**
 * Hybrid OID4VP Flow Hook
 *
 * This hook provides a unified interface for verifiable presentation flows
 * that works across different transport types (HTTP proxy, WebSocket, Direct).
 *
 * Phase 4 of Transport Abstraction
 */

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useOIDFlowTransportSafe } from '@/context/OIDFlowTransportContext';
import SessionContext from '@/context/SessionContext';
import CredentialsContext, { ExtendedVcEntity } from '@/context/CredentialsContext';
import { matchCredentials } from '@/lib/services/CredentialMatchingService';
import type {
	OID4VPFlowResult,
	OID4VPSelectedCredential,
	OID4VPVerifierInfo,
} from '@/lib/openid-flow/types/OID4VPTypes';
import type { OIDFlowActiveTransportType, OIDFlowProgressEvent } from '@/lib/openid-flow/types/OIDFlowTypes';
import { DcqlQuery } from 'dcql';
import { getLeastUsedCredentialInstance } from '@/lib/services/CredentialBatchHelper';
import { applySelectiveDisclosure, buildOid4vpDcApiSessionTranscript, buildOid4vpSessionTranscript } from '@/lib/verifiable-credentials';
import { OIDFlowError } from '@/lib/openid-flow/errors';
import { useOIDFlowSignHandler } from './useOIDFlowSignHandler';
import { DCAPIRequest, DCAPISession } from '@/lib/openid-flow/platforms/dc-api';
import type { SignRequestHandler } from '@/lib/openid-flow/transports/OIDFlowWebSocketTransport';
import { LocalStorageKeystore } from '@/services/LocalStorageKeystore';
import { BackendApi } from '@/api';
import { parseClientIdScheme, KeyMaterial } from 'wallet-common';
import { logger } from '@/logger';
import { ConformantCredentials } from '@/components/flows/PresentCredentialsFlow';
import { encodeZkpReqVpToken, zkpReqQueriesOf, type IZkpReq, type PresentationSession } from '@sirosfoundation/zkp-req';

export interface UseOID4VPFlowOptions {
	/**
	 * Called when flow progress updates
	 */
	onProgress?: (event: OIDFlowProgressEvent) => void;
	/**
	 * Called when an error occurs
	 */
	onError?: (error: Error) => void;
	/**
	 * Callback to show credential selection UI
	 */
	onCredentialSelection?: (
		verifierInfo: OID4VPVerifierInfo,
		dcqlQuery: DcqlQuery.Input,
		conformantCredentialsMap: ConformantCredentials,
	) => Promise<Map<string, number>>;
}

export interface OID4VPCredentialSelectionOptions {
	/**
	 * Pre-selected by the native picker (DC API); empty means all.
	 */
	selectedCredentialIDs?: string[];
	/**
	 * Set by the caller when the request is `zkp_req`.
	 *
	 * @todo Take the flow's `IPresentationStrategy` instead.
	 */
	zkpReq?: IZkpReq;
}

export interface UseOID4VPFlowReturn {
	/**
	 * Start an OID4VP flow with an authorization request URI
	 */
	handleAuthorizationRequest: (
		authorizationRequestUrl: URL
	) => Promise<OID4VPFlowResult>;
	/**
	 * Handle credential selection by showing the configured UI and returning the user's selection
	 */
	handleCredentialSelection: (
		verifierInfo: OID4VPVerifierInfo,
		dcqlQuery?: DcqlQuery.Input,
		selectionOptions?: OID4VPCredentialSelectionOptions,
	) => Promise<OID4VPFlowResult>;
	/**
	 * Send authorization response with selected credentials
	 *
	 * @todo Take the flow's `IPresentationStrategy` instead of `zkpReq`.
	 */
	sendAuthorizationResponse: (
		selectedCredentials: OID4VPSelectedCredential[],
		zkpReq?: IZkpReq,
	) => Promise<OID4VPFlowResult>;
	/**
	 * Current transport type being used
	 */
	transportType: OIDFlowActiveTransportType;
	/**
	 * Whether a flow is currently in progress
	 */
	isLoading: boolean;
	/**
	 * Last error if any
	 */
	error: Error | null;
	/**
	 * Clear the last error
	 */
	clearError: () => void;
	/**
	 * Handle DC API request - parse URL, match credentials, store session
	 */
	handleDCAPIRequest: (
		request: DCAPIRequest,
		verifiedOrigin: string,
	) => Promise<OID4VPFlowResult>;
	/**
	 * Send DC API response - sign, record history, send via session
	 *
	 * @todo Take the flow's `IPresentationStrategy` instead of `zkpReq`.
	 */
	sendDCAPIResponse: (
		session: DCAPISession,
		credentials: OID4VPSelectedCredential[],
		zkpReq?: IZkpReq,
	) => Promise<OID4VPFlowResult>;
}

/**
 * Hook for verifiable presentation flows with transport abstraction
 *
 * Automatically selects the appropriate transport based on configuration:
 * - WebSocket: Delegates entire flow to backend over persistent connection
 * - HTTP: Uses existing IOpenID4VP implementation with HTTP proxy
 * - Direct: (Future) Browser makes direct CORS requests
 */
export function useOID4VPFlow(options: UseOID4VPFlowOptions = {}): UseOID4VPFlowReturn {
	const { onProgress, onError } = options;

	const transportContext = useOIDFlowTransportSafe();
	const { keystore, api } = useContext(SessionContext);
	const { vcEntityList } = useContext(CredentialsContext);
	const { signPresentation } = useOIDFlowSignHandler();

	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<Error | null>(null);

	const transportType = transportContext?.transportType ?? 'none';
	const transport = transportContext?.transport;

	const clearError = useCallback(() => {
		setError(null);
		transportContext?.clearError?.();
	}, [transportContext]);

	const vcEntityListRef = useRef(vcEntityList);
	const credentialsReadyResolvers = useRef<((list: ExtendedVcEntity[]) => void)[]>([]);
	const verifierAudienceRef = useRef<string>('');

	useEffect(() => {
		vcEntityListRef.current = vcEntityList;
		if (vcEntityList != null && credentialsReadyResolvers.current.length > 0) {
			for (const resolve of credentialsReadyResolvers.current) {
				resolve(vcEntityList);
			}
			credentialsReadyResolvers.current = [];
		}
	}, [vcEntityList]);

	/**
	 * Wait for credentials to be loaded before proceeding with flow steps that require them
	 */
	const waitForCredentials = useCallback((): Promise<ExtendedVcEntity[]> => {
		const current = vcEntityListRef.current;
		if (current != null) {
			return Promise.resolve(current);
		}
		return new Promise((resolve) => {
			credentialsReadyResolvers.current.push(resolve);
		});
	}, []);

	/**
	 * Handle authorization request using the appropriate transport
	 */
	const handleAuthorizationRequest = useCallback(async (
		authorizationRequestUrl: URL
	): Promise<OID4VPFlowResult> => {
		setIsLoading(true);
		setError(null);

		try {
			// WebSocket transport: delegate to backend
			if (transportType === 'websocket' && transport) {
				const unsubscribeProgress = onProgress
					? transport.onProgress(onProgress)
					: () => {};
				const unsubscribeError = onError
					? transport.onError(onError)
					: () => {};

				try {
					const requestUriRef = authorizationRequestUrl.searchParams.get('request_uri');
					const clientId = authorizationRequestUrl.searchParams.get('client_id');
					verifierAudienceRef.current = clientId ?? '';
					const result = await transport.startOID4VPFlow({
						requestUriRef,
						clientId,
					});

					if (!result.success) {
						throw new OIDFlowError(result.error);
					}

					return result;
				} finally {
					unsubscribeProgress();
					unsubscribeError();
				}
			}

			// HTTP proxy transport: use existing implementation
			if (transportType === 'http_proxy') {
				throw new OIDFlowError({
					code: 'DISCONTINUED_HTTP_PROXY_FLOW',
					message: 'HTTP proxy transport flow is discontinued. Please use WebSocket transport instead.',
				});
			}

			// No transport available
			throw new OIDFlowError({ code: 'NO_TRANSPORT', message: 'No transport available for verifiable presentation' });

		} catch (err) {
			const error = err instanceof OIDFlowError ? err : new OIDFlowError({ code: 'FLOW_ERROR', message: err instanceof Error ? err.message : String(err) });
			setError(error);
			onError?.(error);
			return {
				success: false,
				error: {
					code: error.code,
					message: error.message,
				},
			};
		} finally {
			setIsLoading(false);
		}
	}, [transportType, transport, onProgress, onError]);

	/**
	 * Handle credential selection by showing the configured UI and returning the user's selection
	 */
	const handleCredentialSelection = useCallback(async (
		verifierInfo: OID4VPVerifierInfo,
		dcqlQuery?: DcqlQuery.Input,
		{ selectedCredentialIDs = [], zkpReq }: OID4VPCredentialSelectionOptions = {},
	): Promise<OID4VPFlowResult> => {
		setIsLoading(true);
		setError(null);

		try {
			if (!options.onCredentialSelection) throw new OIDFlowError({
				code: 'NO_CREDENTIAL_SELECTION_POPUP',
				message: 'No credential selection popup configured'
			});

			// Pre-selected by the native picker (DC API); empty means all.
			const credentials = (await waitForCredentials())
				.filter(vc => selectedCredentialIDs.length === 0 || selectedCredentialIDs.includes(String(vc.batchId)));

			/**
			 * @todo Call the strategy's first step instead of branching on `zkpReq` here.
			 */
			if (zkpReq) {
				const match = await zkpReq.match();
				if (match.kind === 'failed') {
					throw new OIDFlowError({ code: 'ZKP_REQ_NO_MATCH', message: `zkp_req cannot be presented (${match.code})` });
				}

				const queries = zkpReqQueriesOf(dcqlQuery);

				/**
				 * @todo Fake fields from the `_req` items; replace with real display metadata.
				 */
				const conformant: ConformantCredentials = new Map(
					[...match.candidates].map(([queryId, candidate]) => [
						queryId,
						{
							credentials: credentials
								.filter((vc) => String(vc.credentialId) === candidate.credential_id)
								.map((vc) => vc.batchId),
							requestedFields: (queries.find((q) => q.id === queryId)?._req ?? []).map(
								({ fn_id, return: handle }) => ({ name: handle ?? fn_id, path: [fn_id] }),
							),
						},
					]),
				);

				// The selection is not read yet: each query presents its first candidate.
				await options.onCredentialSelection(
					verifierInfo,
					dcqlQuery,
					conformant,
				);

				const selected: OID4VPSelectedCredential[] = [];
				for (const [queryId, candidate] of match.candidates) {
					const instance = credentials.find((vc) => String(vc.credentialId) === candidate.credential_id);
					if (!instance) continue;

					selected.push({
						batchId: instance.batchId,
						credentialQueryId: queryId,
						walletCredentialRef: candidate.credential_id,
						credentialRaw: instance.data,
						holderKeyKid: instance.kid,
						disclosedClaims: [],
					});
				}

				return {
					success: true,
					selectedCredentials: selected,
				};
			}

			if (!dcqlQuery) {
				throw new OIDFlowError({ code: 'NO_DCQL_QUERY_OR_PREMATCHED_CREDENTIALS', message: 'No dcqlQuery provided' });
			}

			const { matches, no_match_reason, code } = matchCredentials(credentials, dcqlQuery);

			if (matches.length === 0) {
				throw new OIDFlowError({ code: code ?? 'NO_MATCHING_CREDENTIALS', message: no_match_reason || 'No matching credentials' });
			}

			const conformantCredentialsMap: ConformantCredentials = new Map(buildConformantCredentialsMap(matches, dcqlQuery));

			if (conformantCredentialsMap.size === 0) {
				throw new OIDFlowError({ code: 'INSUFFICIENT_CREDENTIALS', message: 'No credentials available for selection' });
			}

			// Show popup → user picks descriptorId → batchId
			const selectionMap = await options.onCredentialSelection(
				verifierInfo,
				dcqlQuery,
				conformantCredentialsMap,
			);

			// Convert to OID4VPSelectedCredential[]
			const selected: OID4VPSelectedCredential[] = [];
			for (const [descriptorId, batchId] of selectionMap.entries()) {
				// Pick least-used instance for unlinkability
				const walletState = keystore?.getCalculatedWalletState();
				if (!walletState) throw new OIDFlowError({ code: 'WALLET_STATE_UNAVAILABLE', message: 'Wallet state not available' });

				const instance = await getLeastUsedCredentialInstance(batchId, credentials, walletState);
				if (!instance) continue;

				selected.push({
					batchId,
					credentialQueryId: descriptorId,
					walletCredentialRef: String(instance.credentialId),
					credentialRaw: instance.data,
					holderKeyKid: instance.kid,
					disclosedClaims: (() => {
						const claims = dcqlQuery.credentials.find(c => c.id === descriptorId)?.claims;
						return Array.isArray(claims) ? claims.map(c => c.path?.join('.')) : [];
					})(),
				});
			}

			return {
				success: true,
				selectedCredentials: selected,
			};
		} catch (err) {
			if (err instanceof OIDFlowError && err.code === 'USER_CANCELLED') {
				return {
					success: false,
					error: {
						code: 'USER_CANCELLED',
						message: 'User cancelled',
					},
				};
			}

			const error = err instanceof OIDFlowError
				? err
				: new OIDFlowError({
						code: 'SELECTION_ERROR',
						message: err instanceof Error ? err.message : String(err),
					});

			setError(error);
			onError?.(error);
			return {
				success: false,
				error: {
					code: error.code,
					message: error.message,
				},
			};
		} finally {
			setIsLoading(false);
		}
	}, [
		keystore,
		options,
		waitForCredentials,
		onError,
	]);

	/**
	 * Send authorization response with selected credentials
	 */
	const sendAuthorizationResponse = useCallback(async (
		selectedCredentials: OID4VPSelectedCredential[],
		zkpReq?: IZkpReq,
	): Promise<OID4VPFlowResult> => {
		setIsLoading(true);
		setError(null);

		try {
			// WebSocket transport: continue flow on backend
			if (transportType === 'websocket' && transport) {
				const unsubscribeProgress = onProgress
					? transport.onProgress(onProgress)
					: () => {};

				/**
				 * @todo Pass the flow's `IPresentationStrategy` instead; the transport calls its `present` step.
				 */
				const signPresentation: SignRequestHandler | undefined = zkpReq && (async ({ params }) => {
					if (!params.nonce) {
						throw new Error('Missing nonce for zkp_req presentation');
					}
					return {
						vpToken: encodeZkpReqVpToken(await zkpReq.prove(await presentationSessionOf({
							nonce: params.nonce,
							clientId: params.audience,
							responseUri: params.responseUri,
							jwkThumbprint: params.verifierJwkThumbprint,
						}))),
					};
				});

				try {
					const result = await transport.startOID4VPFlow({
						selectedCredentials,
						signPresentation,
					});

					// Record presentation history for sigCount tracking
					if (keystore) {
						await recordPresentationHistory(keystore, api, selectedCredentials, verifierAudienceRef.current);
					}

					if (!result.success) {
						throw new OIDFlowError({ code: result.error?.code || 'AUTHORIZATION_RESPONSE_FAILED', message: result.error?.message || 'Authorization response failed' });
					}

					return result;
				} finally {
					unsubscribeProgress();
				}
			}

			// HTTP proxy transport: use existing implementation
			if (transportType === 'http_proxy') {
				throw new OIDFlowError({
					code: 'DISCONTINUED_HTTP_PROXY_FLOW',
					message: 'HTTP proxy transport flow is discontinued. Please use WebSocket transport instead.',
				});
			}

			throw new OIDFlowError({ code: 'NO_TRANSPORT_AVAILABLE', message: 'No transport available' });

		} catch (err) {
			const error = err instanceof OIDFlowError
				? err
				: new OIDFlowError({ code: 'RESPONSE_ERROR', message: err instanceof Error ? err.message : String(err) });
			setError(error);
			onError?.(error);
			return {
				success: false,
				error: {
					code: error.code,
					message: error.message,
				},
			};
		} finally {
			setIsLoading(false);
		}
	}, [transportType, transport, onProgress, onError, keystore, api]);

	/**
	 * Handle DC API request - parse URL, match credentials, store session
	 */
	const handleDCAPIRequest = useCallback(async (
		request: DCAPIRequest,
		verifiedOrigin: string
	): Promise<OID4VPFlowResult> => {
		setIsLoading(true);
		try {
			const clientIdForTrust = request.clientId ?? verifiedOrigin;
			const clientIdScheme = parseClientIdScheme(clientIdForTrust);

			const keyMaterial: KeyMaterial = request.isSigned
				? { type: request.keyMaterial.type, key: request.keyMaterial.value }
				: { type: 'resolution', key: [] }

			if (!request.isSigned) {
				logger.debug('Unsigned request, proceeding with resolution-based trust evaluation');
			}

			const trustResult = await transportContext?.trustEvaluators.evaluateVerifierTrust({
				clientIdScheme,
				keyMaterial,
			});

			if (!trustResult?.trusted) {
				throw new OIDFlowError({
					code: 'UNTRUSTED_VERIFIER',
					message: trustResult?.status ?? 'Verifier is not trusted',
				});
			}

			return {
				success: true,
				dcqlQuery: request.dcqlQuery,
				verifierInfo: {
					name: trustResult?.name ?? verifiedOrigin,
					purpose: String(request.dcqlQuery.credential_sets?.[0]?.purpose ?? ''),
					domain: clientIdScheme.identifier,
					trustStatus: trustResult?.status,
					trusted: trustResult?.trusted ?? false,
					logo: trustResult?.logo,
				},
			};
		} catch (err) {
			const error = err instanceof OIDFlowError
				? err
				: new OIDFlowError({ code: 'FLOW_ERROR', message: err instanceof Error ? err.message : String(err) });
			setError(error);
			onError?.(error);
			return {
				success: false,
				error: { code: error.code, message: error.message },
			};
		} finally {
			setIsLoading(false);
		}
	}, [onError, transportContext?.trustEvaluators]);

	/**
	 * Send DC API response - sign, record history, send via session
	 */
	const sendDCAPIResponse = useCallback(async (
		session: DCAPISession,
		selectedCredentials: OID4VPSelectedCredential[],
		zkpReq?: IZkpReq,
	): Promise<OID4VPFlowResult> => {
		setIsLoading(true);
		setError(null);

		try {
			// DC API audience format per OpenID4VP spec
			const audience = `origin:${session.verifiedOrigin}`;
			const verifierJwkThumbprint = await session.verifierJwkThumbprint();

			/**
			 * @todo Call the strategy's `present` step for both branches.
			 */
			const vpToken = zkpReq
				? encodeZkpReqVpToken(await zkpReq.prove(await presentationSessionOf({
					nonce: session.request.nonce,
					clientId: session.request.clientId,
					origin: session.verifiedOrigin,
					jwkThumbprint: verifierJwkThumbprint,
				})))
				: (await signPresentation({
					audience,
					nonce: session.request.nonce,
					origin: session.verifiedOrigin,
					verifierJwkThumbprint: verifierJwkThumbprint ?? undefined,
					credentialsToInclude: selectedCredentials.map(c => ({
						credentialId: c.walletCredentialRef,
						credentialQueryId: c.credentialQueryId,
						disclosedClaims: c.disclosedClaims,
						credentialRaw: c.credentialRaw,
					})),
				})).vpToken;

			if (keystore) {
				await recordPresentationHistory(keystore, api, selectedCredentials, audience);
			}

			if (!vpToken) {
				throw new OIDFlowError({ code: 'SIGNING_FAILED', message: 'Failed to generate VP token' });
			}

			await session.sendResponse(JSON.parse(vpToken));
			return { success: true };
		} catch (err) {
			const error = err instanceof OIDFlowError
				? err
				: new OIDFlowError({ code: 'RESPONSE_ERROR', message: err instanceof Error ? err.message : String(err) });
			setError(error);
			onError?.(error);
			return {
				success: false,
				error: { code: error.code, message: error.message },
			};
		} finally {
			setIsLoading(false);
		}
	}, [signPresentation, keystore, api, onError]);

	return {
		handleAuthorizationRequest,
		handleCredentialSelection,
		sendAuthorizationResponse,
		transportType,
		isLoading,
		error,
		clearError,
		handleDCAPIRequest,
		sendDCAPIResponse,
	};
}

export default useOID4VPFlow;

/**
 * The Handover follows the channel: redirects have a `responseUri`, the DC API an `origin`.
 *
 * @todo Move into the `zkp_req` presentation strategy.
 */
async function presentationSessionOf(p: {
	nonce: string;
	clientId?: string;
	origin?: string;
	responseUri?: string;
	jwkThumbprint?: string | null;
}): Promise<PresentationSession> {
	const transcript = p.responseUri
		? await buildOid4vpSessionTranscript({ clientId: p.clientId!, responseUri: p.responseUri, nonce: p.nonce, jwkThumbprint: p.jwkThumbprint ?? null })
		: await buildOid4vpDcApiSessionTranscript({ origin: p.origin!, nonce: p.nonce, jwkThumbprint: p.jwkThumbprint ?? null });

	return {
		handover: transcript.handover.encode(),
		nonce: p.nonce,
		/**
		 * @todo Use the form the trust framework fixes (`semantic_id:` or `x509_san_dns:`).
		 */
		verifier_id: p.clientId ?? p.origin!,
	};
}

/**
 * Build conformant credentials map from DCQL matches
 */
function buildConformantCredentialsMap(
	matches: Array<{ input_descriptor_id: string; credential_id: string }>,
	dcqlQuery: DcqlQuery.Input
): Map<string, { credentials: number[]; requestedFields: Array<{ name?: string; path?: string[] }> }> {
	const result = new Map<string, {
		credentials: number[];
		requestedFields: Array<{ name?: string; path?: string[] }>
	}>();

	for (const match of matches) {
		if (!result.has(match.input_descriptor_id)) {
			const credDef = dcqlQuery.credentials.find(c => c.id === match.input_descriptor_id);
			result.set(match.input_descriptor_id, {
				credentials: [],
				requestedFields: (Array.isArray(credDef?.claims) ? credDef.claims : []).map(c => ({
					name: c.path?.[c.path.length - 1],
					path: c.path,
				})),
			});
		}
		result.get(match.input_descriptor_id).credentials.push(Number.parseInt(match.credential_id));
	}

	return result;
}

/**
 * Record presentation history for sigCount tracking
 */
async function recordPresentationHistory(
	keystore: LocalStorageKeystore,
	api: BackendApi,
	selectedCredentials: OID4VPSelectedCredential[],
	audience: string
): Promise<void> {
	const transactionId = crypto.getRandomValues(new Uint32Array(1))[0];
	const presentations = await Promise.all(selectedCredentials.map(async (cred) => ({
		transactionId,
		// A circuit_zk presentation discloses no claims; keep the raw credential so history still records it.
		data: cred.disclosedClaims?.length
			? await applySelectiveDisclosure(cred.credentialRaw, cred.disclosedClaims)
			: cred.credentialRaw,
		usedCredentialIds: [Number.parseInt(cred.walletCredentialRef)],
		audience,
	})));
	const [, newPrivateData, keystoreCommit] = await keystore.addPresentations(presentations);
	await api.updatePrivateData(newPrivateData);
	await keystoreCommit();
}
