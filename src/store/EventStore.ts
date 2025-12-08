import axios from "axios";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { EncryptJWT, importJWK, JWTPayload } from 'jose';

// @ts-ignore
const walletBackendServerUrl = import.meta.env.VITE_WALLET_BACKEND_URL;

export class EventStore {
	static async fetchEvents() {
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

		return axios.get(`${walletBackendServerUrl}/event-store/events`, {
			headers: {
				"Authorization": `Bearer ${appToken}`,
				"DPoP": dpop,
			}
		}).then(({ data }) => data)
	}

	static	async storeEvent(hash: string, payload: JWTPayload) {
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

		await axios.put(`${walletBackendServerUrl}/event-store/events/${hash}`, data, {
			headers: {
				"Content-Type": "application/jose",
				"Authorization": `Bearer ${appToken}`,
				"DPoP": dpop,
			}
		})
	}
}

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
