import { base64url, calculateJwkThumbprint, JWK } from 'jose';
import {
	buildVcdm2Presentation,
	holderIdFromCredential,
	holderJwkFromCredential,
} from 'wallet-common';

/**
 * Prepares a VCDM 2.0 presentation for signing.
 */
export async function prepareVcdm2Presentation(
	verifiableCredentials: unknown[],
	nonce: string,
	audience: string,
	transactionDataResponseParams?: Record<string, unknown>,
): Promise<{ kid: string; signingInput: string }> {
	// One enveloping JWS has exactly one signer, so every credential in the
	// presentation has to be bound to the same holder key.
	const holderJwks = verifiableCredentials.map((credential) =>
		holderJwkFromCredential(credential),
	);

	if (holderJwks.some((jwk) => !jwk)) {
		throw new Error(
			'Holder public key could not be resolved from the VCDM 2.0 credential',
		);
	}

	const kids = await Promise.all(
		holderJwks.map((jwk) => calculateJwkThumbprint(jwk as JWK, 'sha256')),
	);
	const distinctKids = [...new Set(kids)];
	if (distinctKids.length > 1) {
		throw new Error(
			'All credentials in a presentation must be bound to the same holder key, but ' +
				distinctKids.length +
				' different keys were found',
		);
	}

	const kid = distinctKids[0];
	const holderJwk = holderJwks[0];

	const holder = holderIdFromCredential(verifiableCredentials[0]);
	const presentation = buildVcdm2Presentation(verifiableCredentials, {
		holder,
	});

	// Strip any private key material before publishing the key in the header.
	const { d: _omitted, ...publicJwk } = holderJwk as JWK & { d?: string };

	const header = { typ: 'vp+jwt', alg: 'ES256', jwk: publicJwk };
	const payload = {
		...presentation,
		nonce,
		aud: audience,
		iat: Math.floor(Date.now() / 1000),
		...transactionDataResponseParams,
	};

	const signingInput = [header, payload]
		.map((obj) => {
			return base64url.encode(JSON.stringify(obj));
		})
		.join('.');

	return {
		kid,
		signingInput,
	};
}
