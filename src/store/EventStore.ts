import axios from "axios";
import { exportJWK, generateKeyPair, jwtDecrypt, SignJWT } from "jose";
import { EncryptJWT, importJWK, JWTPayload } from 'jose';
import { createAsyncThunk } from "@reduxjs/toolkit";
import { ExtendedVcEntity } from "@/context/CredentialsContext";
import { CredentialKeyPair } from "@/services/keystore";
import { AppState } from ".";

// @ts-ignore
const walletBackendServerUrl = import.meta.env.VITE_WALLET_BACKEND_URL;

type Snapshot = {};

type WalletState = {
	credentials: ExtendedVcEntity[],
	keypairs: CredentialKeyPair[]
}

type EncryptedEvents = Record<string, string>

export class EventStore {
	snapshot: Snapshot = {};
	walletState: WalletState = {
		credentials: [],
		keypairs: []
	};
	encryptedEvents: EncryptedEvents = {};

	constructor(snapshot: Snapshot = {}) {
		this.snapshot = snapshot
	}

	get currentState() {
		return {
			credentials: [],
			keypairs: [],
		}
	}

	static storeEvent(hash: string, payload: JWTPayload) {
		return async (eventStore: EventStore) => {
			const sessionPublicKeyJwk = JSON.parse(sessionStorage.getItem("sessionPublicKeyJwk") || "{}");
			const appToken= JSON.parse(sessionStorage.getItem("appToken") || "");

			const { publicKey, privateKey } = await generateKeyPair("ES256");
			const ath = await sha256Base64Url(appToken);
			const claims = {
				jti: "jti",
				htm: "PUT",
				htu: `${walletBackendServerUrl}/event-store/events/${hash}`,
				iat: Math.floor(Date.now() / 1000),
				ath,
			};
			const dpop = await new SignJWT(claims)
			.setProtectedHeader({
				typ: "dpop+jwt",
				alg: "ES256",
				jwk: await exportJWK(publicKey),
			})
			.sign(privateKey);

			const data = await new EncryptJWT(payload as JWTPayload)
			.setProtectedHeader({ alg: "RSA-OAEP-256", enc: "A256GCM" })
			.encrypt(await importJWK(sessionPublicKeyJwk, "RSA-OAEP-256"))

			await axios.put<EncryptedEvents>(`${walletBackendServerUrl}/event-store/events/${hash}`, data, {
				headers: {
					"Content-Type": "application/jose",
					"Authorization": `Bearer ${appToken}`,
					"DPoP": dpop,
				}
			}).then(({ data }) => {
				Object.assign(eventStore.encryptedEvents, data)
				return eventStore
			})
		}
	}
}

export const fetchEvents = createAsyncThunk('sessions/fetchEvents', async (
	_payload,
	{ getState },
) => {
	const eventStore = (getState() as AppState).sessions.eventStore;
	const appToken= JSON.parse(sessionStorage.getItem("appToken") || "");

	const { publicKey, privateKey } = await generateKeyPair("ES256");
	const ath = await sha256Base64Url(appToken);
	const claims = {
		jti: "jti",
		htm: "GET",
		htu: `${walletBackendServerUrl}/event-store/events`,
		iat: Math.floor(Date.now() / 1000),
		ath,
	};
	const dpop = await new SignJWT(claims)
	.setProtectedHeader({
		typ: "dpop+jwt",
		alg: "ES256",
		jwk: await exportJWK(publicKey),
	})
	.sign(privateKey);

	return axios.get<{ events: EncryptedEvents }>(`${walletBackendServerUrl}/event-store/events`, {
		headers: {
			"Authorization": `Bearer ${appToken}`,
			"DPoP": dpop,
		}
	}).then(({ data }) => {
		eventStore.encryptedEvents = data.events
		console.log(eventStore)
		return eventStore
	})
})

export const buildWalletState = createAsyncThunk('sessions/buildWalletState', async (
	{
		credentialEngine,
	}: { credentialEngine: any },
	{ getState },
) => {
	const eventStore = (getState() as AppState).sessions.eventStore;
	const rawEvents = eventStore.encryptedEvents

	const sessionPrivateKeyJwk = JSON.parse(sessionStorage.getItem("sessionPrivateKeyJwk") || "{}");
	const clearEvents = await Promise.all(
		Object.values(rawEvents)
			.map(async (event: string) => {
				const { payload } = await jwtDecrypt(
					event,
					await importJWK(sessionPrivateKeyJwk, "RSA-OAEP-256")
				)
				return payload as { type: string, timestamp: number, payload: Record<string, unknown> }
			})
	)

	const walletState: EventStore["walletState"] = eventStore.currentState

	for (const event of clearEvents.sort((a, b) => a.timestamp - b.timestamp)) {
		if (event.type === "add_credential") {
			const {
				data,
				credentialIssuerIdentifier,
				credentialConfigurationId,
				instanceId,
			} = event.payload;

			const parse = await credentialEngine.credentialParsingEngine.parse({
				rawCredential: data,
				credentialIssuer: {
					credentialIssuerIdentifier: credentialIssuerIdentifier,
					credentialConfigurationId: credentialConfigurationId,
				},
			});

			if (parse.success) {
				walletState.credentials.push({
					...event.payload,
					instances: [{ instanceId, sigCount: 0 }],
					parsedCredential: parse.value
				} as ExtendedVcEntity)
			}
		}

		if (event.type === "delete_credential") {
			const deletedCredential = walletState.credentials
				.find(({ batchId }) => batchId === event.payload.batchId as number)

			walletState.credentials.splice(
				eventStore.walletState.credentials.indexOf(deletedCredential),
				1
			);
		}

		if (event.type === "add_keypair") {
			walletState.keypairs.push(event.payload as CredentialKeyPair)
		}
	}

	console.log("build", eventStore)
	return walletState
})

async function sha256Base64Url(input) {
	const encoder = new TextEncoder();
	const data = encoder.encode(input);

	// Compute SHA-256
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);

	// Convert ArrayBuffer → string
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const base64 = btoa(String.fromCharCode(...hashArray));

	// Convert base64 → base64url
	return base64
	.replace(/\+/g, "-")
	.replace(/\//g, "_")
		.replace(/=+$/g, "");
}
