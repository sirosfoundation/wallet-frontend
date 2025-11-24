import axios from 'axios';
import { EncryptJWT, importJWK } from 'jose';
import { useDispatch } from "react-redux";
import { PresentationRequest, PresentationResponse } from '@wwwallet/client-core';
import { AppDispatch, signJwtPresentation } from '@/store';

const retrieveKeys = async (presentation_request: PresentationRequest) => {
	if (presentation_request.client_metadata.jwks) {
		const jwk = presentation_request.client_metadata.jwks.keys.filter(k => {
			return k.use === 'enc' && k.kty === 'EC'
		})[0];
		if (!jwk) {
			throw new Error("Could not find Relying Party public key for encryption");
		}
		return { jwk, alg: "ECDH-ES" };
	}
	if (presentation_request.client_metadata.jwks_uri) {
		const response = await axios.get(presentation_request.client_metadata.jwks_uri).catch(() => null);
		if (response && 'keys' in response.data) {
			const jwk = response.data.keys.filter((k) => {
				return k.use === 'enc' && k.kty === "EC"
			})[0];
			if (!jwk) {
				throw new Error("Could not find Relying Party public key for encryption");
			}
			return { jwk, alg: "ECDH-ES" };
		}
	}
	throw new Error("Could not find Relying Party public key for encryption");
};

export const useCoreVpTokenSigner = () => {
	const dispatch = useDispatch() as AppDispatch;

	return {
		sign: async (payload: unknown, presentation_request: PresentationRequest) => {
			// TODO manage MSoMDoc presentation signature
			const result = await dispatch(signJwtPresentation({
				nonce: presentation_request.nonce,
				audience: presentation_request.client_id,
				verifiableCredentials: Object.values(payload).flat(),
			}));

			if (result.payload) return (result.payload as { vpjwt }).vpjwt;

			// @ts-expect-error
			throw new Error(JSON.stringify(result.error));
		},
		encryptResponse: async (response: PresentationResponse, presentation_request: PresentationRequest) => {
			const { jwk, alg } = await retrieveKeys(presentation_request);
			const publicKey = await importJWK(jwk, alg);
			const vp_token = {};
			presentation_request.dcql_query.credentials.forEach(({ id }) => {
				vp_token[id] = response.vp_token
			})
			return await new EncryptJWT({
				vp_token,
				state: response.state,
				presentation_submission: {},
			})
				// .setKeyManagementParameters({ apu: new TextEncoder().encode(apu), apv: new TextEncoder().encode(apv) })
				.setProtectedHeader({
					alg: presentation_request.client_metadata.authorization_encrypted_response_alg,
					enc: presentation_request.client_metadata.authorization_encrypted_response_enc,
					kid: jwk.kid
				})
				.encrypt(publicKey);
		},
	}
}
