import { ZkpReqRegistry } from './src/registry/ZkpReqRegistry';
import { ZkpReqRequest } from './src/request/ZkpReqRequest';
import { ZkpReqVpFormat } from './src/request/ZkpReqVpFormat';
import { ZkpReqError } from './src/resources';
import {
	IZkpReqProver,
	ProofSystem,
	ZkpReqCredentialCriteria,
} from './src/types';
import {
	isZkpReqDcqlQuery as dcqlHasZkpReqCredentials,
	isPureZkpReqDcqlQuery,
} from './src/utils';

class OIDFlowError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
		this.name = 'OIDFlowError';
	}
}

class ZkpReqProver implements IZkpReqProver {
	async supportedProofSystems(): Promise<ReadonlySet<ProofSystem>> {
		return new Set(['longfellow-libzk-v1']);
	}
	async supports(proofSystem: ProofSystem): Promise<boolean> {
		return (await this.supportedProofSystems()).has(proofSystem);
	}
	async prove(input: unknown): Promise<unknown> {
		// Parked: real proof generation. Placeholder keeps the flow shape visible.
		return {
			system_id: (input as any)?.selection?.systemId,
			proof: '<proof-bytes>',
		};
	}
	async dispose(): Promise<void> {}
}

// -- mock wallet store (stands in for ExtendedVcEntity from CredentialsContext) --
type MockVcEntity = {
	credentialId: string;
	batchId: number;
	parsedCredential: {
		metadata: { credential: { doctype?: string; vct?: string } };
		signedClaims: Record<string, unknown>;
	};
};

const walletCredentials: MockVcEntity[] = [
	{
		credentialId: 'cred-nym-1',
		batchId: 1,
		parsedCredential: {
			metadata: { credential: { doctype: 'eu.europa.ec.eudi.nym_auth.1' } },
			signedClaims: { birth_date: '1990-01-01', ssc: 'SE-1234' },
		},
	},
];

// In the app this is CredentialMatchingService.matchCircuitZkCredentials.
function matchZkpReqCredentials(
	criteria: ZkpReqCredentialCriteria[],
	creds: MockVcEntity[],
): Map<string, MockVcEntity[]> {
	const result = new Map<string, MockVcEntity[]>();
	for (const c of criteria) {
		const wanted = c.doctype ? [c.doctype] : (c.vct ?? []);
		const candidates = creds.filter((vc) => {
			const m = vc.parsedCredential.metadata.credential;
			const type = m.vct ?? m.doctype ?? '';
			if (!wanted.includes(type)) return false;
			return c.requiredAttributes.every(
				(a) => a in vc.parsedCredential.signedClaims,
			);
		});
		result.set(c.credentialQueryId, candidates);
	}
	return result;
}

// -- mock signed request (DC API, unencrypted) ----------------------------------
const signedRequest = {
	response_type: 'vp_token',
	response_mode: 'dc_api.jwt',
	nonce: 'n-0S6_WzA2Mj',
	client_id: 'x509_san_dns:rp.example.com',
	expected_origins: ['https://rp.example.com'],
	client_metadata: {
		vp_formats_supported: {
			zkp_req: {
				proof_system_values: ['longfellow-libzk-v1'],
				system_id_values: ['urn:circuits:longfellow:nym_auth:v1'],
			},
		},
	},
	dcql_query: {
		credentials: [
			{
				id: 'nym_attestation',
				format: 'zkp_req',
				meta: {
					source_format: 'mso_mdoc',
					doctype_value: 'eu.europa.ec.eudi.nym_auth.1',
				},
				require_cryptographic_holder_binding: true,
				_req: [
					{
						fn_id: 'pseudonym',
						return: 'nym',
						params: {
							config: 'known-offender-matching-ssc',
							ver: 1,
							prf: 'sha-256',
						},
					},
					{
						fn_id: 'age_check',
						return: 'age-range-123',
						params: {
							ge: '2008-10-10',
							le: '2013-10-09',
						},
					},
				],
			},
		],
	},
} as const;

const prover = new ZkpReqProver();

// mirrors useOID4VPFlow().handleAuthorizationRequest, parse the request and
// surface what the flow needs (verifier, resolved request, matched credentials).
async function handleAuthorizationRequest(request: typeof signedRequest) {
	const dcqlQuery = request.dcql_query;

	if (!dcqlHasZkpReqCredentials(dcqlQuery)) {
		// standard dcql path would run here; not mocked
		throw new OIDFlowError('invalid_request', 'not a zkp_req request');
	}
	if (!isPureZkpReqDcqlQuery(dcqlQuery)) {
		throw new OIDFlowError(
			'invalid_request',
			'mixing zkp_req with other credentials is unsupported',
		);
	}

	const vpFormat = ZkpReqVpFormat.fromClientMetadata(
		request.client_metadata,
	);
	const registry = new ZkpReqRegistry();
	const zkpReqRequest = new ZkpReqRequest({
		dcqlQuery,
		vpFormat,
		registry,
		prover,
	});

	await zkpReqRequest.resolveRequestSystems();

	const conformantCredentials = matchZkpReqCredentials(
		zkpReqRequest.credentialCriteria(),
		walletCredentials,
	);

	return {
		verifierInfo: { name: request.client_id },
		zkpReqRequest,
		conformantCredentials,
	};
}

// mirrors handleCredentialSelection, overview screen; user picks one per query.
async function handleCredentialSelection(
	conformant: Map<string, MockVcEntity[]>,
) {
	const selected = new Map<string, MockVcEntity>();
	for (const [queryId, creds] of conformant) {
		if (creds.length === 0)
			throw new OIDFlowError(
				'access_denied',
				`no credential matches query '${queryId}'`,
			);
		selected.set(queryId, creds[0]); // mock: user takes the first candidate
	}
	return selected;
}

// mirrors sendAuthorizationResponse, prove each query, assemble + post vp_token.
async function sendAuthorizationResponse(
	request: ZkpReqRequest,
	selected: Map<string, MockVcEntity>,
	sessionBinding: { nonce: string; clientId: string; origin: string },
) {
	const vpToken: Record<string, unknown> = {};
	for (const cred of request.credentials) {
		const credential = selected.get(cred.id);
		vpToken[cred.id] = await prover.prove({
			selection: cred.selection(),
			functions: cred.functions.map((f) => f.serialize()),
			credential,
			...sessionBinding,
		});
	}
	// POST vpToken to the verifier (or hand back via the DC API session)
	return { success: true as const, vpToken };
}

// mirrors OpenID4VPFlow.processAuthorizationRequest
async function processAuthorizationRequest(request: typeof signedRequest) {
	try {
		const { verifierInfo, zkpReqRequest, conformantCredentials } =
			await handleAuthorizationRequest(request);

		const selected = await handleCredentialSelection(conformantCredentials);

		// displaySendingScreen()
		const sendResult = await sendAuthorizationResponse(
			zkpReqRequest,
			selected,
			{
				nonce: request.nonce,
				clientId: request.client_id,
				origin: request.expected_origins[0],
			},
		);

		// displayCompletedScreen({ verifierName: verifierInfo.name })
		console.log('[vp-flow] response sent:', {
			verifier: verifierInfo.name,
			vpToken: sendResult.vpToken,
		});
		return sendResult;
	} catch (err) {
		if (err instanceof ZkpReqError) {
			throw new OIDFlowError(err.code, `zkp_req: ${err.message}`);
		}
		throw err;
	}
}

processAuthorizationRequest(signedRequest).catch((e) =>
	console.error('[vp-flow]', e),
);
