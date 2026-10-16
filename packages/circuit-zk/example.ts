import { CircuitZkRegistry } from './src/registry/CircuitZkRegistry';
import { CircuitZkRequest } from './src/request/CircuitZkRequest';
import { CircuitZkVpFormat } from './src/request/CircuitZkVpFormat';
import { CircuitZkError } from './src/resources';
import {
	ICircuitZkProver,
	ProofSystem,
	CircuitZkCredentialCriteria,
} from './src/types';
import {
	isCircuitZkDcqlQuery as dcqlHasCircuitZkCredentials,
	isPureCircuitZkDcqlQuery,
} from './src/utils';

class OIDFlowError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
		this.name = 'OIDFlowError';
	}
}

class CircuitZkProver implements ICircuitZkProver {
	async supportedProofSystems(): Promise<ReadonlySet<ProofSystem>> {
		return new Set(['longfellow-libzk-v1']);
	}
	async supports(proofSystem: ProofSystem): Promise<boolean> {
		return (await this.supportedProofSystems()).has(proofSystem);
	}
	async prove(input: unknown): Promise<unknown> {
		// Parked: real proof generation. Placeholder keeps the flow shape visible.
		return {
			circuit_id: (input as any)?.selection?.circuitId,
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
function matchCircuitZkCredentials(
	criteria: CircuitZkCredentialCriteria[],
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
	response_mode: 'dc_api',
	nonce: 'n-0S6_WzA2Mj',
	client_id: 'x509_san_dns:rp.example.com',
	expected_origins: ['https://rp.example.com'],
	client_metadata: {
		vp_formats_supported: {
			circuit_zk: {
				circuit_proof_system_values: ['longfellow-libzk-v1'],
				circuit_id_values: ['urn:circuits:longfellow:nym_auth:v1'],
			},
		},
	},
	dcql_query: {
		credentials: [
			{
				id: 'nym_attestation',
				format: 'circuit_zk',
				meta: {
					source_format: 'mdoc_mso',
					doctype_value: 'eu.europa.ec.eudi.nym_auth.1',
				},
				require_cryptographic_holder_binding: true,
				claims: {
					_req: [
						{
							fn_id: 'pseudonym-v1-sha256',
							id: 'nym-123',
							params: {
								config: 'known-offender-matching-ssc',
								verifier_id_type: 'x509_san_dns',
								source: { path: ['ssc'] },
							},
						},
						{
							fn_id: 'age_check',
							id: 'age-range-123',
							params: {
								ge: '2008-10-10',
								le: '2013-10-09',
								source: { path: ['birth_date'] },
							},
						},
					],
				},
			},
		],
	},
} as const;

const prover = new CircuitZkProver();

// mirrors useOID4VPFlow().handleAuthorizationRequest, parse the request and
// surface what the flow needs (verifier, resolved request, matched credentials).
async function handleAuthorizationRequest(request: typeof signedRequest) {
	const dcqlQuery = request.dcql_query;

	if (!dcqlHasCircuitZkCredentials(dcqlQuery)) {
		// standard dcql path would run here; not mocked
		throw new OIDFlowError('invalid_request', 'not a circuit_zk request');
	}
	if (!isPureCircuitZkDcqlQuery(dcqlQuery)) {
		throw new OIDFlowError(
			'invalid_request',
			'mixing circuit_zk with other credentials is unsupported',
		);
	}

	const vpFormat = CircuitZkVpFormat.fromClientMetadata(
		request.client_metadata,
	);
	const registry = new CircuitZkRegistry();
	const circuitZkRequest = new CircuitZkRequest({
		dcqlQuery,
		vpFormat,
		registry,
		prover,
	});

	await circuitZkRequest.resolveRequestCircuits();

	const conformantCredentials = matchCircuitZkCredentials(
		circuitZkRequest.credentialCriteria(),
		walletCredentials,
	);

	return {
		verifierInfo: { name: request.client_id },
		circuitZkRequest,
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
	request: CircuitZkRequest,
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
		const { verifierInfo, circuitZkRequest, conformantCredentials } =
			await handleAuthorizationRequest(request);

		const selected = await handleCredentialSelection(conformantCredentials);

		// displaySendingScreen()
		const sendResult = await sendAuthorizationResponse(
			circuitZkRequest,
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
		if (err instanceof CircuitZkError) {
			throw new OIDFlowError(err.code, `circuit_zk: ${err.message}`);
		}
		throw err;
	}
}

processAuthorizationRequest(signedRequest).catch((e) =>
	console.error('[vp-flow]', e),
);
