import { useCallback, useMemo } from 'react';
import type { ClientState, ClientStateStore } from '@wwwallet/client-core'
import { jsonParseTaggedBinary } from '@/util';
import { generateRandomIdentifier } from '@/lib/utils/generateRandomIdentifier';
import pkceChallenge from 'pkce-challenge';
import { exportJWK, generateKeyPair } from 'jose';

const CLIENT_STATE_KEY = "clientStates"

export function useCoreClientStateStore(): ClientStateStore {
	const create = useCallback<ClientStateStore["create"]>(
		async (issuer, issuer_state) => {
			const userHandleB64u = jsonParseTaggedBinary(sessionStorage.getItem("userHandle"));
			const state = btoa(
				JSON.stringify({
					userHandleB64u: userHandleB64u,
					id: generateRandomIdentifier(12)
				})
			).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

			const { code_verifier } = await pkceChallenge()

			const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
			const clientState = {
				issuer,
				issuer_state,
				state,
				code_verifier,
				dpopKeyPair: {
					publicKey: await exportJWK(publicKey),
					privateKey: {
						alg: "ES256",
						...await exportJWK(privateKey)
					},
				},
			}

			if (!clientState.issuer_state?.length) {
				clientState.issuer_state = 'issuer_state'
			}

			return clientState;
		}, []);

	const commitChanges = useCallback<ClientStateStore["commitChanges"]>(
		async (clientState: ClientState): Promise<ClientState> => {
				const rawClientStates = localStorage.getItem(CLIENT_STATE_KEY) || '[]'

				let found = false;
				const newClientStates = JSON.parse(rawClientStates).map(
					(oldClientState) => {
						if (
							oldClientState.state === clientState.state &&
							oldClientState.issuer === clientState.issuer &&
							oldClientState.issuer_state === clientState.issuer_state
						) {
							found = true
							return clientState
						}
						return oldClientState;
					}
				)

				if (!found) {
					newClientStates.unshift(clientState)
				}

				localStorage.setItem(CLIENT_STATE_KEY, JSON.stringify(newClientStates.slice(0, 24)))

				return clientState;
		},
		[]
	)

	const fromIssuerState = useCallback<ClientStateStore["fromIssuerState"]>(
		async (issuer, issuer_state): Promise<ClientState> => {
				const rawClientStates = localStorage.getItem(CLIENT_STATE_KEY) || '[]'

				const clientState = JSON.parse(rawClientStates).find(
					({ issuer: e, issuer_state: f }) => {
						return e === issuer && f === (issuer_state || 'issuer_state')
					}
				)

				if (!clientState) {
					throw new Error("could not find client state")
				}

				return clientState;
		},
		[]
	)

	const fromState = useCallback<ClientStateStore["fromState"]>(
			async (state): Promise<ClientState> => {
				const rawClientStates = localStorage.getItem(CLIENT_STATE_KEY) || '[]'

				const clientState = JSON.parse(rawClientStates).find(({ state: e }) => e === state)

				if (!clientState) {
					throw new Error("could not find client state")
				}

				return clientState;
			},
			[]
	)

	const setCredentialConfigurationIds = useCallback<ClientStateStore["setCredentialConfigurationIds"]>(
		async (clientState, credentialConfigurationIds): Promise<ClientState> => {
			const newClientState: ClientState = {
				...clientState,
				credential_configuration_ids: credentialConfigurationIds,
			};

			return newClientState
		},
		[]
	)

	const setIssuerMetadata = useCallback<ClientStateStore["setIssuerMetadata"]>(
		async (clientState, issuerMetadata): Promise<ClientState> => {
			const newClientState: ClientState = {
				...clientState,
				issuer_metadata: issuerMetadata,
			};

		return newClientState
	}, [])

	return useMemo(() => ({
		create,
		commitChanges,
		fromIssuerState,
		fromState,
		setCredentialConfigurationIds,
		setIssuerMetadata,
	}), [
		create,
		commitChanges,
		fromIssuerState,
		fromState,
		setCredentialConfigurationIds,
		setIssuerMetadata,
	])
}
