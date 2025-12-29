import axios from "axios";
import { exportJWK, generateKeyPair, JWK, jwtDecrypt, SignJWT } from "jose";
import { EncryptJWT, JWTPayload } from 'jose';
import { createAsyncThunk } from "@reduxjs/toolkit";
import { ExtendedVcEntity } from "@/context/CredentialsContext";
import { jsonParseTaggedBinary, jsonStringifyTaggedBinary } from "@/util";
import { CredentialKeyPair, importMainKey } from "@/services/keystore";
import { WalletStateCredential } from "@/services/WalletStateSchemaVersion1";
import { AppState } from ".";

// @ts-ignore
const walletBackendServerUrl = import.meta.env.VITE_WALLET_BACKEND_URL;

type Snapshot = {};

type WalletState = {
	credentials: ExtendedVcEntity[],
	keypairs: CredentialKeyPair[],
}

type AddressingTable = Array<{
	hash: string;
	encryption_key: JWK;
}>

type EncryptedEvents = Array<{
	hash: string;
	payload: string;
	encryption_key: JWK;
}>

type WalletEvent = AddCredentialEvent | DeleteCredentialEvent

type AddCredentialEvent = {
	hash: string;
	payload: {
		type: "add_credential";
		timestamp: number;
		payload: WalletStateCredential & {
			proofs: {
				proofKey: JWK;
				proof: string;
			}[];
		};
	};
}

type DeleteCredentialEvent = {
	hash: string;
	payload: {
		type: "delete_credential";
		timestamp: number;
		payload: {
			batchId: number;
		};
	};
}

export class EventStore {
	snapshot: Snapshot = {};
	walletState: WalletState = {
		credentials: [],
		keypairs: []
	};
	encryptedEvents: EncryptedEvents = [];

	constructor(snapshot: Snapshot = {}) {
		this.snapshot = snapshot
	}

	get currentState() {
		return {
			credentials: [],
			keypairs: [],
		}
	}

}

export const storeEvent = createAsyncThunk('sessions/addEvent', async (
	{ hash, payload } : WalletEvent,
) => {
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

	const encryption_key = await crypto.subtle.generateKey(
		{ name: "AES-GCM", length: 256 },
		true,
		["encrypt", "decrypt"]
	);
	const data = await new EncryptJWT(payload as JWTPayload)
	.setProtectedHeader({ alg: "A256GCMKW", enc: "A256GCM" })
	.encrypt(encryption_key)

	const mainKey = jsonParseTaggedBinary(sessionStorage.getItem("mainKey"))

	const iv = crypto.getRandomValues(new Uint8Array(12));
	const wrappedKey = await crypto.subtle.wrapKey(
	  "jwk",
	  encryption_key,
	  await importMainKey(mainKey),
	  { name: "AES-GCM", iv }
	);

	const addressing_table = [{
		hash,
		encryption_key: {
			wrappedKey: jsonStringifyTaggedBinary(new Uint8Array(wrappedKey)),
			iv: jsonStringifyTaggedBinary(iv),
		}
	}]
	const body = {
		addressing_table: await Promise.all(
			addressing_table.map(addressing_record => new SignJWT(addressing_record)
				.setProtectedHeader({ "alg": "HS256" })
				.sign(new TextEncoder().encode("secret")))
		),
		events: [{ payload: data, hash }],
	}

	return await axios.put<{ addressing_table: AddressingTable, events: EncryptedEvents }>(`${walletBackendServerUrl}/event-store/events/${hash}`, body, {
		headers: {
			"Authorization": `Bearer ${appToken}`,
			"DPoP": dpop,
		}
	}).then(({ data }) => {
		return data.events.map(event => {
			return {
				...event,
				encryption_key: addressing_table
					.find(({ hash: address }) => address === event.hash)?.encryption_key
			}
		})
	})
})

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

	return axios.get<{ addressing_table: AddressingTable, events: EncryptedEvents }>(`${walletBackendServerUrl}/event-store/events`, {
		headers: {
			"Authorization": `Bearer ${appToken}`,
			"DPoP": dpop,
		}
	}).then(({ data }) => {
		eventStore.encryptedEvents = data.events
		return eventStore
	})
})

export const buildWalletState = createAsyncThunk('sessions/buildWalletState', async (
	{
		credentialEngine,
	}: { credentialEngine: any },
	{ getState },
) => {
	const mainKey = jsonParseTaggedBinary(sessionStorage.getItem("mainKey"))
	const eventStore = (getState() as AppState).sessions.eventStore;
	const rawEvents = eventStore.encryptedEvents

	const clearEvents: Array<WalletEvent["payload"]> = await Promise.all(
		rawEvents
			.map(async (event) => {
				const { wrappedKey, iv } = event.encryption_key
				const unwrappedKey = await crypto.subtle.unwrapKey(
				  "jwk",
				  jsonParseTaggedBinary(wrappedKey as string),
				  await importMainKey(mainKey),
				  { name: "AES-GCM", iv: jsonParseTaggedBinary(iv as string) },
				  { name: "AES-GCM", length: 256 },
				  true,
				  ["encrypt", "decrypt"]
				);
				const { payload } = await jwtDecrypt(
					event.payload,
					unwrappedKey,
				)
				return payload as WalletEvent["payload"]
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
	}

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
