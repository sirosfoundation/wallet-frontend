import axios, { AxiosResponse } from 'axios';
import { Err, Ok, Result } from 'ts-results';

import * as config from '../config';
import { logger } from '../logger';
import { fromBase64Url, jsonParseTaggedBinary, jsonStringifyTaggedBinary, toBase64Url, transformTaggedResponse } from '../util';
import { EncryptedContainer, makeAssertionPrfExtensionInputs, parsePrivateData, serializePrivateData } from '../services/keystore';
import { CachedUser, LocalStorageKeystore } from '../services/LocalStorageKeystore';
import { UserId, Verifier } from './types';
import { useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { UseStorageHandle, useClearStorages, useLocalStorage, useSessionStorage } from '../hooks/useStorage';
import { addItem, getItem, EXCLUDED_INDEXEDDB_PATHS } from '../indexedDB';
import { loginWebAuthnBeginOffline } from './LocalAuthentication';
import { withAuthenticatorAttachmentFromHints, withHintsFromAllowCredentials } from '@/util-webauthn';
import { getTenantFromUrlPath, setStoredTenant, clearStoredTenant } from '../lib/tenant';
import { clearOIDCState } from '../lib/oidc';
import { AuthTokens } from '@/lib/auth';
import { useAuthServerClient } from '@/hooks/useAuthServerClient';

const walletBackendUrl = config.BACKEND_URL;

type SessionState = {
	uuid: string;
	username: string,
	displayName: string,
	webauthnCredentialCredentialId: string,
	authenticationType: 'signup' | 'login',
	showWelcome: boolean,
}

type SignupWebauthnError = (
	'passkeySignupFailedServerError'
	| 'passkeySignupFailedTryAgain'
	| 'passkeySignupFinishFailedServerError'
	| 'passkeySignupKeystoreFailed'
	| 'passkeySignupPrfNotSupported'
	| 'inviteRequired'
	| 'inviteInvalid'
	| 'oidcTokenExpired'
	| { errorId: 'prfRetryFailed', retryFrom: SignupWebauthnRetryParams }
);
type SignupWebauthnRetryParams = { beginData: any, credential: PublicKeyCredential };


export type ClearSessionEvent = {};
export const CLEAR_SESSION_EVENT = 'clearSession';
export type ApiEventType = typeof CLEAR_SESSION_EVENT;
const events: EventTarget = new EventTarget();


export interface BackendApi {
	del(path: string): Promise<AxiosResponse>,
	get(path: string): Promise<AxiosResponse>,
	getExternalEntity(path: string, options?: { headers?: { [header: string]: string } }, forceIndexDB?: boolean): Promise<AxiosResponse>,
	post(path: string, body: object): Promise<AxiosResponse>,

	getSession(): SessionState,
	isLoggedIn(): boolean,
	clearSession(): void,

	authTokens: AuthTokens,

	getAllVerifiers(): Promise<Verifier[]>,
	getAllPresentations(): Promise<{ vp_list: any[] }>,
	initiatePresentationExchange(verifier_id: number, scope_name: string): Promise<{ redirect_to?: string }>,

	loginWebauthn(
		keystore: LocalStorageKeystore,
		promptForPrfRetry: () => Promise<boolean | AbortSignal>,
		webauthnHints: string[],
		cachedUser: CachedUser | undefined,
		urlTenantId?: string,
		oidcIdToken?: string,
	): Promise<
		Result<void,
			| 'loginKeystoreFailed'
			| 'passkeyInvalid'
			| 'passkeyLoginFailedTryAgain'
			| 'passkeyLoginFailedServerError'
			| 'oidcTokenExpired'
			| 'x-private-data-etag'
		>
	>,
	signupWebauthn(
		name: string,
		keystore: LocalStorageKeystore,
		promptForPrfRetry: () => Promise<boolean | AbortSignal>,
		webauthnHints: string[],
		retryFrom?: SignupWebauthnRetryParams,
		tenantId?: string,
		inviteCode?: string,
		oidcIdToken?: string,
	): Promise<Result<void, SignupWebauthnError>>,
	updatePrivateData(newPrivateData: EncryptedContainer): Promise<void>,
	updatePrivateDataEtag(resp: AxiosResponse): AxiosResponse,

	updateShowWelcome(showWelcome: boolean): void,

	addEventListener(type: ApiEventType, listener: EventListener, options?: boolean | AddEventListenerOptions): void,
	removeEventListener(type: ApiEventType, listener: EventListener, options?: boolean | EventListenerOptions): void,
	/** Register a storage hook handle to be cleared when `useApi().clearSession()` is invoked. */
	useClearOnClearSession<T>(storageHandle: UseStorageHandle<T>): UseStorageHandle<T>,

	syncPrivateData(
		cachedUser: CachedUser | undefined,
		keystore?: LocalStorageKeystore,
	): Promise<Result<void,
		| 'syncFailed'
		| 'loginKeystoreFailed'
		| 'passkeyInvalid'
		| 'passkeyLoginFailedTryAgain'
		| 'passkeyLoginFailedServerError'
		| 'x-private-data-etag'
	>>;
}

export function useApi(isOnlineProp: boolean = true): BackendApi {
	const isOnline = useMemo(() => isOnlineProp === null ? true : isOnlineProp, [isOnlineProp]);
	const authServer = useAuthServerClient();
	const tenantId = getTenantFromUrlPath() ?? 'default';
	const [userHandle,] = useSessionStorage<string | null>("userHandle", null);
	const [cachedUsers] = useLocalStorage<CachedUser[] | null>("cachedUsers", null);
	const [sessionState, setSessionState, clearSessionState] = useSessionStorage<SessionState | null>("sessionState", null);

	const authTokens = useMemo(
		() => AuthTokens.fromStorage({ authServerClient: authServer, tenantId, storage: window.sessionStorage }),
		[authServer, tenantId]
	);

	/**
	 * Synchronization tag for the encrypted private data. To prevent data loss,
	 * this MUST be refreshed only when a new version of the private data is
	 * loaded into the keystore or successfully uploaded to the server.
	 */
	const getPrivateDataEtag = useCallback(() => {
		return jsonParseTaggedBinary(localStorage.getItem('privateDataEtag'));
	}, []);

	const setPrivateDataEtag = useCallback((v: string) => {
		localStorage.setItem('privateDataEtag', jsonStringifyTaggedBinary(v));
	}, []);

	const removePrivateDataEtag = useCallback(() => {
		localStorage.removeItem('privateDataEtag');
	}, []);

	const authedRequest = useTokenRequest(authTokens, 'backend', getPrivateDataEtag);
	const anonRequest   = useTokenRequest(authTokens, 'anonymous');

	const navigate = useNavigate();
	const clearSessionStorage = useClearStorages(clearSessionState);

	// Define clearSession early so it can be used by token refresh config
	const clearSession = useCallback((): void => {
		authServer.logout(tenantId ?? 'default').catch((e) => logger.error('Failed to clear server session', e));
		clearSessionStorage();
		authTokens.clear();
		removePrivateDataEtag();
		clearStoredTenant(); // Clear tenant on logout
		clearOIDCState('registration'); // Clear OIDC gate tokens on logout
		clearOIDCState('login');
		events.dispatchEvent(new CustomEvent<ClearSessionEvent>(CLEAR_SESSION_EVENT));
	}, [authServer, authTokens, clearSessionStorage, removePrivateDataEtag, tenantId]);

	// Stable ref for clearSession to avoid stale closures in token refresh
	const clearSessionRef = useRef<() => void>(clearSession);

	useEffect(() => {
		clearSessionRef.current = clearSession;
	}, [clearSession]);


	const updatePrivateDataEtag = useCallback((resp: AxiosResponse): AxiosResponse => {
		const newValue = resp.headers['x-private-data-etag']
		if (newValue) {
			setPrivateDataEtag(newValue);
		}
		return resp;
	}, [setPrivateDataEtag]);

	const getWithLocalDbKey = useCallback(async (
		doGet: (path: string, headers?: Record<string, string>) => Promise<AxiosResponse>,
		path: string,
		dbKey: string,
		options?: { headers?: { [header: string]: string } },
		forceIndexDB: boolean = false,
	): Promise<AxiosResponse> => {
		logger.debug(`Get: ${path} ${isOnline ? 'online' : 'offline'} mode ${isOnline}`);

		if (!isOnline && !EXCLUDED_INDEXEDDB_PATHS.has(path)) {
			return { data: await getItem(path, dbKey) } as AxiosResponse;
		}
		if (forceIndexDB && !EXCLUDED_INDEXEDDB_PATHS.has(path)) {
			const data = await getItem(path, dbKey);
			if (data) return { data } as AxiosResponse;
		}

		const respBackend = await doGet(path, options?.headers ?? {});
		if (!EXCLUDED_INDEXEDDB_PATHS.has(path)) {
			await addItem(path, dbKey, respBackend.data);
		}
		return respBackend;
	}, [isOnline]);

	const get = useCallback(async (
		path: string,
		options?: {
			headers?: { [header: string]: string },
			userUuid?: string,
		},
	): Promise<AxiosResponse> => {
		return getWithLocalDbKey(authedRequest.get, path, sessionState?.uuid || options?.userUuid, options);
	}, [getWithLocalDbKey, authedRequest, sessionState?.uuid]);

	const getExternalEntity = useCallback(async (
		path: string,
		options?: { headers?: { [header: string]: string } },
		force: boolean = false
	): Promise<AxiosResponse> => {
		const tenantId = getTenantFromUrlPath() || 'default';
		// Include tenant in cache key so different tenants have separate caches
		const cacheKey = `${tenantId}:${path}`;
		return getWithLocalDbKey(anonRequest.get, path, cacheKey, options, force);
	}, [getWithLocalDbKey, anonRequest]);

	const fetchInitialData = useCallback(async (
		userUuid: string
	): Promise<void> => {
		try {
			// get('/storage/vc') on home page ('/')
			// get('/storage/vp') on home page ('/')
			await get('/user/session/account-info', { userUuid });
			await getExternalEntity('/verifier/all', undefined, false);
			// getExternalEntity('/issuer/all') on credentialContext
			// getCredentialIssuerMetadata() on credentialContext
		} catch (error) {
			logger.error('Failed to perform get requests', error);
		}
	}, [get, getExternalEntity]);

	const post = useCallback(async (
		path: string,
		body: object,
		options?: { headers?: { [header: string]: string } },
	): Promise<AxiosResponse> => {
		return authedRequest.post(path, body, options?.headers ?? {});
	}, [authedRequest]);

	const del = useCallback(async (
		path: string,
		options?: { headers?: { [header: string]: string } },
	): Promise<AxiosResponse> => {
		return authedRequest.del(path, options?.headers ?? {});
	}, [authedRequest]);

	/**
	 * Lock to prevent concurrent syncs that would race on the main-key rotation
	 * and the private-data etag.
	 */
	const syncInFlightRef = useRef<Promise<
		Result<void,
			| 'syncFailed'
			| 'loginKeystoreFailed'
			| 'passkeyInvalid'
			| 'passkeyLoginFailedTryAgain'
			| 'passkeyLoginFailedServerError'
			| 'x-private-data-etag'
		>
	> | null>(null);

	const doSyncPrivateData = useCallback(async (
		cachedUser: CachedUser | undefined,
		keystore?: LocalStorageKeystore,
	): Promise<Result<void,
		| 'syncFailed'
		| 'loginKeystoreFailed'
		| 'passkeyInvalid'
		| 'passkeyLoginFailedTryAgain'
		| 'passkeyLoginFailedServerError'
		| 'x-private-data-etag'
	>> => {

		try {
			if (!isOnline) {
				return Ok.EMPTY;
			}
			const getPrivateDataResponse = await get('/user/session/private-data', { headers: { 'If-None-Match': getPrivateDataEtag() } });
			if (getPrivateDataResponse.status === 304) {
				return Ok.EMPTY; // already synced
			}

			// Try to merge without re-authentication if keystore is available
			if (keystore) {
				try {
					const remotePrivateData = getPrivateDataResponse.data.privateData;
					const mergeResult = await keystore.syncWithRemoteData(remotePrivateData);
					if (mergeResult.ok) {
						const newEtag =
							getPrivateDataResponse.headers?.['x-private-data-etag'] ??
							getPrivateDataResponse.headers?.['etag'];
						const updateResp = updatePrivateDataEtag(
							await post('/user/session/private-data', serializePrivateData(mergeResult.val), {
								headers: newEtag ? { 'X-Private-Data-If-Match': newEtag } : {},
							}),
						);
						if (updateResp.status === 204) {
							console.debug('syncPrivateData: merged remote and local data successfully');
							return Ok.EMPTY;
						}
					}
				} catch (mergeErr) {
					console.debug('syncPrivateData: silent merge threw, falling back to re-auth', mergeErr);
				}
				console.debug('syncPrivateData: merge failed, falling back to re-authentication flow');
			}

			// Fallback: navigate to sync-fail state for re-authentication
			const queryParams = new URLSearchParams(window.location.search);
			queryParams.delete('user');
			queryParams.delete('sync');

			if (cachedUser && cachedUser.userHandleB64u) {
				queryParams.append('user', cachedUser.userHandleB64u);
			}
			queryParams.append('sync', 'fail');

			navigate(`${window.location.pathname}?${queryParams.toString()}`, { replace: true });
			return Err('syncFailed');
		}
		catch (err) {
			if (typeof err === 'object' && err !== null && 'cause' in err && err.cause === 'x-private-data-etag') {
				logger.debug('syncPrivateData: private data etag conflict', err);
				return Err('x-private-data-etag');
			}
			logger.error('syncPrivateData failed', err);
			return Err('syncFailed');
		}

	}, [getPrivateDataEtag, get, navigate, isOnline, post, updatePrivateDataEtag]);

	const syncPrivateData = useCallback((
		cachedUser: CachedUser | undefined,
		keystore?: LocalStorageKeystore,
	): Promise<Result<void,
		| 'syncFailed'
		| 'loginKeystoreFailed'
		| 'passkeyInvalid'
		| 'passkeyLoginFailedTryAgain'
		| 'passkeyLoginFailedServerError'
		| 'x-private-data-etag'
	>> => {
		// If a sync is already running, reuse it instead of starting a concurrent
		// one that would race on the main-key rotation and the private-data etag.
		if (syncInFlightRef.current !== null) {
			return syncInFlightRef.current;
		}

		const run = (async () => {
			try {
				return await doSyncPrivateData(cachedUser, keystore);
			} finally {
				syncInFlightRef.current = null;
			}
		})();

		syncInFlightRef.current = run;

		return run;
	}, [doSyncPrivateData]);

	const updateShowWelcome = useCallback((showWelcome: boolean): void => {
		if (sessionState) {
			setSessionState((prevState) => ({
				...prevState,
				showWelcome: showWelcome,
			}));
		}
	}, [sessionState, setSessionState]);

	const getSession = useCallback((): SessionState => {
		return sessionState;
	}, [sessionState]);

	const isLoggedIn = useCallback((): boolean => {
		return getSession() !== null;
	}, [getSession]);

	const setSession = useCallback(async (
		userRecord: any,
		credential: PublicKeyCredential | null,
		authenticationType: 'signup' | 'login'
	): Promise<void> => {
		setSessionState({
			uuid: userRecord.uuid,
			displayName: userRecord.displayName,
			username: userRecord.username,
			webauthnCredentialCredentialId: credential?.id,
			authenticationType,
			showWelcome: authenticationType === 'signup',
		});

		await addItem('users', userRecord.uuid, userRecord);
		if (isOnline) {
			await fetchInitialData(userRecord.uuid).catch((error) => logger.error('Error in performGetRequests', error));
		}
	}, [setSessionState, fetchInitialData, isOnline]);

	const updatePrivateData = useCallback(async (
		newPrivateData: EncryptedContainer,
	): Promise<void> => {
		try {
			async function writeOnIndexedDB() {
				if (!userHandle) {
					return;
				}
				const userId = UserId.fromUserHandle(fromBase64Url(userHandle));
				const userObject = await getItem("users", userId.id);
				if (!userObject) {
					throw new Error(`Could not find user with userHandle ${userHandle} on indexedDB 'users' table`);
				}
				userObject.privateData = serializePrivateData(newPrivateData);
				await addItem("users", userId.id, userObject);
			}

			if (!isOnline) {
				await writeOnIndexedDB();
				logger.debug("Cannot write to remote keystore while offline");
				return;
			}
			const updateResp = updatePrivateDataEtag(
				await post('/user/session/private-data', serializePrivateData(newPrivateData)),
			);
			if (updateResp.status === 204) {
				await writeOnIndexedDB();
				return;
			} else {
				logger.error("Failed to update private data", updateResp.status, updateResp);
				return Promise.reject(updateResp);
			}
		} catch (e) {
			logger.error("Failed to update private data", e, e?.response?.status);
			if ((e?.response?.status === 412 && (e?.headers ?? {})['x-private-data-etag']) || (e.cause === 'x-private-data-etag')) {
				logger.error("Private data version conflict", { cause: 'x-private-data-etag' });
				const cachedUser = cachedUsers.filter((u) => u.userHandleB64u === userHandle)[0];
				await syncPrivateData(cachedUser);
				return;
			}
			throw e;
		}
	}, [post, updatePrivateDataEtag, cachedUsers, userHandle, syncPrivateData, isOnline]);

	const getAllVerifiers = useCallback(async (): Promise<Verifier[]> => {
		try {
			const result = await getExternalEntity('/verifier/all', undefined, true);
			const verifiers = result.data;
			logger.debug("verifiers = ", verifiers)
			return verifiers;
		}
		catch (error) {
			logger.error("Failed to fetch all verifiers", error);
			throw error;
		}
	}, [getExternalEntity]);

	const getAllPresentations = useCallback(async (): Promise<{ vp_list: any[] }> => {
		try {
			const result = await get('/storage/vp');
			return result.data; // Return the Axios response.
		}
		catch (error) {
			logger.error("Failed to fetch all presentations", error);
			throw error;
		}
	}, [get]);

	const initiatePresentationExchange = useCallback(async (
		verifier_id: number,
		scope_name: string
	): Promise<{ redirect_to?: string }> => {
		try {
			const result = await post('/presentation/initiate', { verifier_id, scope_name });
			const { redirect_to } = result.data;
			return { redirect_to };
		}
		catch (error) {
			logger.error("Failed to fetch all verifiers", error);
			throw error;
		}
	}, [post]);

	const loginWebauthn = useCallback(async (
		keystore: LocalStorageKeystore,
		promptForPrfRetry: () => Promise<boolean | AbortSignal>,
		webauthnHints: string[],
		cachedUser: CachedUser | undefined,
		urlTenantId?: string,
		oidcIdToken?: string
	): Promise<Result<void,
		| 'loginKeystoreFailed'
		| 'passkeyInvalid'
		| 'passkeyLoginFailedTryAgain'
		| 'passkeyLoginFailedServerError'
		| 'oidcTokenExpired'
		| 'x-private-data-etag'
	>> => {
		try {
			// Login always uses global endpoints - the backend discovers the tenant
			// from the userHandle which contains a hashed tenant ID.
			// The urlTenantId is kept for redirect handling after tenant discovery.
			logger.debug("Login: using global endpoint, urlTenant for redirect:", urlTenantId);

			const loginTenantId = urlTenantId || 'default';

			const beginData = isOnline
				? await authServer.loginBegin(loginTenantId, oidcIdToken)
				: loginWebAuthnBeginOffline();

			const prfInputs = cachedUser && makeAssertionPrfExtensionInputs(cachedUser.prfKeys);

			// Build credential options with PRF inputs
			// allowCredentials improves UX by filtering the credential picker to show only matching passkeys
			// PRF extension inputs (evalByCredential) are needed for passkey decryption
			const getOptions = prfInputs
				? {
					...beginData.getOptions,
					publicKey: {
						...beginData.getOptions.publicKey,
						allowCredentials: prfInputs.allowCredentials,
						extensions: {
							...beginData.getOptions.publicKey.extensions,
							prf: prfInputs.prfInput,
						},
					},
				}
				: beginData.getOptions;
			const credential = await navigator.credentials.get({
				...getOptions,
				publicKey: withHintsFromAllowCredentials({
					...getOptions.publicKey,
					hints: webauthnHints,
				}),
			}) as PublicKeyCredential;
			const response = credential.response as AuthenticatorAssertionResponse;

			// Finish the ceremony and load the user's private data. Online, the
			// finish response only establishes the session cookie; private data is
			// fetched separately using a freshly-minted access token (which also
			// validates that the new session works end-to-end).
			let userRecord: any;
			let serializedPrivateData: Uint8Array;
			if (isOnline) {
				const finishResult = await authServer.loginFinish(
					beginData.challengeId!,
					credential,
					loginTenantId,
					oidcIdToken,
				);
				const privateDataResp = updatePrivateDataEtag(
					await authedRequest.get('/user/session/private-data'),
				);
				serializedPrivateData = privateDataResp.data.privateData;
				userRecord = {
					uuid: finishResult.uuid,
					displayName: finishResult.displayName,
					tenantId: finishResult.tenantId,
					tenantDisplayName: finishResult.tenantDisplayName,
					privateData: serializedPrivateData,
				};
			} else {
				const userId = UserId.fromUserHandle(response.userHandle);
				const user = await getItem("users", userId.id);
				serializedPrivateData = user.privateData;
				userRecord = user;
			}

			const privateData = await parsePrivateData(serializedPrivateData);
			const privateDataUpdate = await keystore.unlockPrf(
				privateData,
				credential,
				promptForPrfRetry,
				cachedUser || {
					...userRecord,
					userHandle: new Uint8Array(response.userHandle),
				},
			);
			if (privateDataUpdate) {
				const [newPrivateData, keystoreCommit] = privateDataUpdate;
				try {
					await updatePrivateData(newPrivateData);
					await keystoreCommit();
				} catch (e) {
					logger.error("Failed to upgrade PRF key", e, e.status);
					if (e?.cause === 'x-private-data-etag') {
						return Err('x-private-data-etag');
					}
					return Err('loginKeystoreFailed');
				}
			}

			// Store the tenant from response, falling back to 'default' if not provided
			// This ensures we always have a valid tenant context
			const tenantToStore = userRecord.tenantId ?? 'default';
			setStoredTenant(tenantToStore);

			// Store tenant metadata on the cached user for tenant selector
			if (response.userHandle) {
				const userHandleB64u = toBase64Url(response.userHandle);
				keystore.updateCachedUserTenant(userHandleB64u, {
					id: tenantToStore,
					displayName: userRecord.tenantDisplayName,
				});
			}

			await setSession(userRecord, credential, 'login');
			return Ok.EMPTY;

		} catch (e) {
			logger.error("Login failed", e);


			if (e?.response?.status === 401) {
				// OIDC gate token expired or invalid - user must re-authenticate via IdP
				return Err('oidcTokenExpired');
			}
			if (e?.response?.status === 403) {
				// Tenant access denied - passkey belongs to different tenant
				return Err('passkeyLoginFailedTryAgain');
			}
			if (e?.name === 'NotAllowedError') {
				// User cancelled or passkey not available
				return Err('passkeyLoginFailedTryAgain');
			}
			return Err('passkeyLoginFailedServerError');
		}
	}, [authServer, authedRequest, updatePrivateDataEtag, updatePrivateData, setSession, isOnline]);

	const signupWebauthn = useCallback(async (
		name: string,
		keystore: LocalStorageKeystore,
		promptForPrfRetry: () => Promise<boolean | AbortSignal>,
		webauthnHints: string[],
		retryFrom?: SignupWebauthnRetryParams,
		tenantId?: string,
		inviteCode?: string,
		oidcIdToken?: string,
	): Promise<Result<void, SignupWebauthnError>> => {
		// Registration uses the global endpoint with tenantId in request body
		// This ensures the passkey's userHandle encodes the tenant for proper isolation
		const storedTenant = tenantId || getTenantFromUrlPath();

		try {
			const beginData = retryFrom?.beginData || await authServer.registerBegin(
				storedTenant,
				inviteCode,
				oidcIdToken,
			);
			logger.debug("begin", beginData);

			try {
				const prfSalt = crypto.getRandomValues(new Uint8Array(32))
				const credential = retryFrom?.credential || await navigator.credentials.create({
					...beginData.createOptions,
					publicKey: {
						...beginData.createOptions.publicKey,
						user: {
							...beginData.createOptions.publicKey.user,
							name,
							displayName: name,
						},
						extensions: {
							prf: {
								eval: {
									first: prfSalt,
								},
							},
						},
						hints: webauthnHints,
						authenticatorSelection: withAuthenticatorAttachmentFromHints(beginData.createOptions.publicKey.authenticatorSelection, webauthnHints),
					},
				}) as PublicKeyCredential;
				// const response = credential.response as AuthenticatorAttestationResponse;
				logger.debug("created", credential);

				try {
					const privateData = await keystore.initPrf(
						credential,
						prfSalt,
						promptForPrfRetry,
						{ displayName: name, userHandle: beginData.createOptions.publicKey.user.id },
					);

					try {
						const serializedPrivateData = serializePrivateData(privateData);
						const finishResult = await authServer.registerFinish(
							beginData.challengeId,
							credential,
							name,
							serializedPrivateData,
							storedTenant,
							oidcIdToken,
						);

						// Store the tenant from the response, falling back to 'default' if not provided
						// This ensures we always have a valid tenant context
						const tenantToStore = finishResult.tenantId ?? 'default';
						setStoredTenant(tenantToStore);

						// Store tenant metadata on the cached user for tenant selector
						const userHandleB64u = toBase64Url(beginData.createOptions.publicKey.user.id);
						keystore.updateCachedUserTenant(userHandleB64u, {
							id: tenantToStore,
							displayName: finishResult.tenantDisplayName,
						});

						await setSession(
							{
								uuid: finishResult.uuid,
								displayName: finishResult.displayName,
								tenantId: finishResult.tenantId,
								privateData: serializedPrivateData,
							},
							credential,
							'signup',
						);
						return Ok.EMPTY;

					} catch (e) {
						if (e?.response?.status === 401) {
							// OIDC gate token expired or invalid - user must re-authenticate via IdP
							return Err('oidcTokenExpired');
						}
						return Err('passkeySignupFailedServerError');
					}

				} catch (e) {
					if (e?.cause?.errorId === "prf_retry_failed") {
						return Err({ errorId: 'prfRetryFailed', retryFrom: { credential, beginData } });
					} else if (e?.cause?.errorId === "prf_not_supported") {
						return Err('passkeySignupPrfNotSupported');
					} else {
						return Err('passkeySignupKeystoreFailed');
					}
				}

			} catch (e) {
				return Err('passkeySignupFailedTryAgain');
			}

		} catch (e) {
			if (e?.response?.status === 401) {
				// OIDC gate token expired or invalid - user must re-authenticate via IdP
				return Err('oidcTokenExpired');
			}
			const errorMsg = e?.response?.data?.error;
			if (errorMsg === 'invite_required') return Err('inviteRequired');
			if (errorMsg === 'invite_invalid') return Err('inviteInvalid');
			return Err('passkeySignupFinishFailedServerError');
		}
	}, [authServer, setSession]);

	const addEventListener = useCallback((type: ApiEventType, listener: EventListener, options?: boolean | AddEventListenerOptions): void => {
		events.addEventListener(type, listener, options);
	}, []);

	const removeEventListener = useCallback((type: ApiEventType, listener: EventListener, options?: boolean | EventListenerOptions): void => {
		events.removeEventListener(type, listener, options);
	}, []);

	const stableUseClearOnClearSession = useMemo(() => {
		return function useClearOnClearSession<T>(storageHandle: UseStorageHandle<T>): UseStorageHandle<T> {
			const [, , clearHandle] = storageHandle;

			useEffect(() => {
				const listener = () => clearHandle();
				events.addEventListener(CLEAR_SESSION_EVENT, listener);
				return () => {
					events.removeEventListener(CLEAR_SESSION_EVENT, listener);
				};
			}, [clearHandle]);

			return storageHandle;
		};
	}, []);


	const memoizedApi = useMemo(() => ({
		del,
		get,
		getExternalEntity,
		post,

		updateShowWelcome,

		getSession,
		isLoggedIn,
		clearSession,

		getAllVerifiers,
		getAllPresentations,
		initiatePresentationExchange,
		authTokens,

		loginWebauthn,
		signupWebauthn,
		updatePrivateData,
		updatePrivateDataEtag,

		addEventListener,
		removeEventListener,

		syncPrivateData,
	}), [
		del,
		get,
		getExternalEntity,
		post,

		updateShowWelcome,

		getSession,
		isLoggedIn,
		clearSession,

		getAllVerifiers,
		getAllPresentations,
		initiatePresentationExchange,
		authTokens,

		loginWebauthn,
		signupWebauthn,
		updatePrivateData,
		updatePrivateDataEtag,

		addEventListener,
		removeEventListener,

		syncPrivateData,
	]);

	return {
		...memoizedApi,
		useClearOnClearSession: stableUseClearOnClearSession,
	};
}

/**
 * Helper hook to create a set of request functions that automatically include
 * the appropriate authorization headers for the given token kind.
 */
function useTokenRequest(
	authTokens: AuthTokens,
	tokenKind: keyof typeof AuthTokens.MANIFEST,
	getPrivateDataEtag?: () => string,
) {
	const authHeaders = useCallback(async (
		headers: Record<string, string> = {},
	): Promise<Record<string, string>> => {
		const tenantId = getTenantFromUrlPath() || 'default';
		const token = await authTokens.ensureToken(tokenKind);
		return {
			'X-Tenant-ID': tenantId,
			...headers,
			Authorization: `Bearer ${token.token()}`,
		};
	}, [authTokens, tokenKind]);

	const mutationHeaders = useCallback(async (
		headers: Record<string, string> = {},
	): Promise<Record<string, string>> => {
		const etag = getPrivateDataEtag?.();
		return {
			...(etag ? { 'X-Private-Data-If-Match': etag } : {}),
			...(await authHeaders(headers)),
		};
	}, [authHeaders, getPrivateDataEtag]);

	const withTokenRejection = useCallback(async <T>(send: () => Promise<T>): Promise<T> => {
		const tryRequest = async (send: () => Promise<T>) => {
			try {
				return await send();
			} catch (e) {
				if (
					e?.response?.status !== 401 ||
					e?.response?.data?.error !== 'Invalid token'
				) throw e;

				const shouldRetry = authTokens.registerTokenRejection(tokenKind);
				if (!shouldRetry) {
					// Threshold crossed
					throw e;
				}

				// retry with fresh token
				return await tryRequest(send);
			}
		}

		return tryRequest(send);
	}, [authTokens, tokenKind]);

	const get = useCallback(async (
		path: string,
		headers: Record<string, string> = {},
	): Promise<AxiosResponse> => withTokenRejection(async () => {
		return axios.get(`${walletBackendUrl}${path}`, {
			headers: await authHeaders(headers),
			withCredentials: true,
			validateStatus: status => (status >= 200 && status < 300) || status === 304,
			transformResponse: transformTaggedResponse,
		});
	}), [withTokenRejection, authHeaders]);

	const post = useCallback(async (
		path: string,
		body: object,
		headers: Record<string, string> = {},
	): Promise<AxiosResponse> => withTokenRejection(async () => {
		try {
			return await axios.post(`${walletBackendUrl}${path}`, body, {
				headers: { 'Content-Type': 'application/json', ...(await mutationHeaders(headers)) },
				withCredentials: true,
				transformRequest: (data) => jsonStringifyTaggedBinary(data),
				transformResponse: transformTaggedResponse,
			});
		} catch (e: any) {
			if (e?.response?.status === 412 && (e?.response?.headers ?? {})['x-private-data-etag']) {
				return Promise.reject({ cause: 'x-private-data-etag' });
			}
			throw e;
		}
	}), [withTokenRejection, mutationHeaders]);

	const del = useCallback(async (
		path: string,
		headers: Record<string, string> = {},
	): Promise<AxiosResponse> => withTokenRejection(async () => {
		try {
			return await axios.delete(`${walletBackendUrl}${path}`, {
				headers: await mutationHeaders(headers),
				withCredentials: true,
				transformResponse: transformTaggedResponse,
			});
		} catch (e: any) {
			if (e?.response?.status === 412 && (e?.response?.headers ?? {})['x-private-data-etag']) {
				return Promise.reject({ cause: 'x-private-data-etag' });
			}
			throw e;
		}
	}), [withTokenRejection, mutationHeaders]);

	return useMemo(() => ({ get, post, del }), [get, post, del]);
}
