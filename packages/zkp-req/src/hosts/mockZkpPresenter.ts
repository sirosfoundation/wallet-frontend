import type {
	Candidate,
	Inputs,
	JsonValue,
	Match,
	PresentationSession,
	WalletContext,
	ZkpPresentation,
	ZkpPresenter,
	ZkpRequest,
} from '../types';

const MOCK_SYSTEM_ID = 'urn:mock:zkp_req';
const MOCK_PROOF_SYSTEM = 'mock';

const logger = (...args: unknown[]) => console.debug('[zkp-req mock]', ...args);

/**
 * Development stand-in for the presenter package: every stored credential of the
 * requested format is a candidate, and proofs are random bytes. Never use in production.
 */
export function createMockZkpPresenter(wallet: WalletContext): ZkpPresenter {
	logger('created');

	return {
		async match(req: ZkpRequest): Promise<Match> {
			logger('match: request', req);
			logger('match: query', req.query);
			logger('match: _req items', req.query._req);
			logger('match: formats', req.formats);
			logger('match: trusted_authorities', req.query.trusted_authorities);
			logger('match: require_cryptographic_holder_binding', req.query.require_cryptographic_holder_binding);

			const { source_format, ...meta } = req.query.meta;
			logger('match: asking wallet for credentials', { source_format, meta });

			const credentials = await wallet.credentials(source_format, meta as Record<string, JsonValue>);
			logger(`match: wallet returned ${credentials.length} credential(s)`, credentials.map(({ id, format, kid }) => ({ id, format, kid })));

			const candidates = credentials.map((credential): Candidate => ({
				credential_id: credential.id,
				system_id: MOCK_SYSTEM_ID,
				proof_system: MOCK_PROOF_SYSTEM,
			}));
			logger('match: candidates', candidates);

			const [first, ...rest] = candidates;
			if (!first) {
				logger('match: no candidates, rejecting');
				return { rejected: [] };
			}

			logger(`match: returning ${candidates.length} candidate(s), first is ${first.credential_id}`);
			return { candidates: [first, ...rest] };
		},

		async prove(
			candidate: Candidate,
			req: ZkpRequest,
			session: PresentationSession,
			inputs?: Inputs,
			signal?: AbortSignal,
		): Promise<ZkpPresentation> {
			logger('prove: candidate', candidate);
			logger('prove: request', req);
			logger('prove: session', {
				nonce: session.nonce,
				verifier_id: session.verifier_id,
				handover_bytes: session.handover.length,
			});
			logger('prove: inputs', inputs);
			logger('prove: signal aborted?', signal?.aborted ?? 'no signal');

			const results = Object.fromEntries(
				req.query._req
					.filter((item) => {
						if (!item.return) logger(`prove: skipping assertion-only item ${item.fn_id}`);
						return item.return;
					})
					.map((item) => {
						const value = item.fn_id === 'pseudonym' ? wallet.random(32) : true;
						logger(`prove: result ${item.return} (${item.fn_id})`, value);
						return [item.return, value];
					}),
			);

			const presentation: ZkpPresentation = {
				system_id: candidate.system_id,
				proof_system: candidate.proof_system,
				proof: wallet.random(32),
				proof_time: wallet.now(),
				results,
			};
			logger('prove: presentation', presentation);

			return presentation;
		},
	};
}
