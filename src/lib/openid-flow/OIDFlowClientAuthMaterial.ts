import { exportJWK, importJWK, KeyLike, type JWK } from 'jose';

export interface SerializedClientAuthMaterial {
	dpopKeyId: string;
	privateJwk: JWK;
	publicJwk: JWK;
	wia?: string;
}

export type ClientAuthKeyPair = {
	privateKey: KeyLike | Uint8Array;
	publicKeyJwk: JWK;
}

/**
 * Represents a client auth key used in Open ID flows.
 */
export class OIDFlowClientAuthMaterial {
	readonly dpopKeyId: string;
	readonly keyPair: ClientAuthKeyPair;
	readonly wia?: string;

	/**
	 * Creates OIDFlowClientAuthMaterial instance from a serialized representation.
	 */
	public static async fromSerialized(
		{ dpopKeyId, privateJwk, publicJwk, wia }:
		SerializedClientAuthMaterial): Promise<OIDFlowClientAuthMaterial> {
		const keyPair: ClientAuthKeyPair = {
			privateKey: await importJWK(privateJwk, 'ES256'),
			publicKeyJwk: publicJwk,
		};
		return new OIDFlowClientAuthMaterial(dpopKeyId, keyPair, wia);
	}

	constructor(dpopKeyId: string, keyPair: ClientAuthKeyPair, wia?: string) {
		this.dpopKeyId = dpopKeyId;
		this.keyPair = keyPair;
		this.wia = wia;
	}

	/**
	 * Serializes the OIDFlowClientAuthMaterial instance into a plain object
	 * suitable for storage or transmission.
	 */
	public async serialize(): Promise<SerializedClientAuthMaterial> {
		return {
			dpopKeyId: this.dpopKeyId,
			privateJwk: await exportJWK(this.keyPair.privateKey),
			publicJwk: this.keyPair.publicKeyJwk,
			wia: this.wia,
		};
	}
}
