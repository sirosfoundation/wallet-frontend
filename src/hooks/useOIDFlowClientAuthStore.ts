import { exportJWK, generateKeyPair } from 'jose';
import { useCallback, useMemo, useRef } from 'react';
import {
	OIDFlowClientAuthMaterial,
	type SerializedClientAuthMaterial,
} from '@/lib/openid-flow/OIDFlowClientAuthMaterial';
import { generateRandomIdentifier } from '@/lib/utils/generateRandomIdentifier';

export type OIDFlowClientAuthStore = {
	getAuthMaterial(flowId: string): Promise<OIDFlowClientAuthMaterial>;
	exportAuthMaterial(): Promise<SerializedClientAuthMaterial | undefined>;
	attachWia(flowId: string, wia: string): void;
	seedMaterial(material: SerializedClientAuthMaterial): void;
	clear(): void;
};

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline: pre-existing debt. should be fixed
export function useOIDFlowClientAuthStore(): OIDFlowClientAuthStore {
	const ref = useRef<{
		flowId: string;
		material: OIDFlowClientAuthMaterial;
	} | null>(null);
	// A key persisted across an authorization-code redirect, seeded before the
	// resumed flow starts and consumed once by the next getFlowClientAuthKey mint.
	const seedRef = useRef<SerializedClientAuthMaterial | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: baseline: pre-existing debt. should be fixed
	const getAuthMaterial = useCallback(
		async (flowId: string) => {
			// Reuse a key persisted across an authorization-code redirect so the
			// resumed token leg presents the same key + WIA the PAR leg did (the
			// issuer binds the WIA to the issuance session). Consumed once.
			const seed = seedRef.current;
			if (seed) {
				seedRef.current = null;
				const material = await OIDFlowClientAuthMaterial.fromSerialized(seed);
				ref.current = { flowId, material };
				return material;
			}

			// Same flow (multiple sign_client_auth calls in one leg) reuses its key.
			const current = ref.current;
			if (current?.flowId === flowId) return current.material;

			const { privateKey, publicKey } = await generateKeyPair('ES256', {
				extractable: true,
			});
			const publicKeyJwk = await exportJWK(publicKey);
			const material = new OIDFlowClientAuthMaterial(generateRandomIdentifier(16), {
				privateKey,
				publicKeyJwk,
			});

			ref.current = { flowId, material };

			return material;
		},
		[seedRef, ref],
	);

	// biome-ignore lint/suspicious/useAwait: baseline: pre-existing debt. should be fixed
	// biome-ignore lint/correctness/useExhaustiveDependencies: baseline: pre-existing debt. should be fixed
	const exportAuthMaterial = useCallback(async () => {
		const material = ref.current?.material;
		if (!material) return;
		return material.serialize();
	}, [ref]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: baseline: pre-existing debt. should be fixed
	const attachWia = useCallback(
		(flowId: string, wia: string) => {
			const current = ref.current;
			if (current?.flowId === flowId) {
				current.material = new OIDFlowClientAuthMaterial(
					current.material.dpopKeyId,
					current.material.keyPair,
					wia,
				);
			}
		},
		[ref],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: baseline: pre-existing debt. should be fixed
	const seedMaterial = useCallback(
		(material: SerializedClientAuthMaterial) => {
			seedRef.current = material;
		},
		[seedRef],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: baseline: pre-existing debt. should be fixed
	const clear = useCallback(() => {
		ref.current = null;
		seedRef.current = null;
	}, [ref, seedRef]);

	return useMemo(
		() => ({
			getAuthMaterial,
			exportAuthMaterial,
			attachWia,
			seedMaterial,
			clear,
		}),
		[getAuthMaterial, exportAuthMaterial, attachWia, seedMaterial, clear],
	);
}
