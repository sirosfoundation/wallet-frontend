import type {
	Candidate,
	Inputs,
	IZkpPresenterClient,
	IZkpReq,
	Match,
	PresentationSession,
	ZkpFormats,
	ZkpPresentation,
	ZkpQuery,
	ZkpReqFailureCode,
	ZkpReqMatchResult,
	ZkpRequest,
} from './types';

const FAILURE_PRECEDENCE: ZkpReqFailureCode[] = [
	'invalid_request',
	'vp_formats_not_supported',
	'access_denied',
];

/**
 * Presents the `zkp_req` queries of one OpenID4VP request through the presenter:
 * `match`, then the wallet's one consent screen, then `prove`.
 */
export class ZkpReq implements IZkpReq {
	/**
	 * The presenter is a abstraction for different host environemnts,
	 * like a web worker or wrapper app.
	 * Since it is stateless, we can mix different presenters as needed.
	 */
	readonly #presenter: IZkpPresenterClient;
	/**
	 * Corresponds to each "credential" in the DCQL query.
	 */
	readonly #requests: Map<string, ZkpRequest>;
	/**
	 * Kept from the last `ready` match; `prove` presents these.
	 */
	#candidates: Map<string, Candidate> | null = null;

	/**
	 * Expects only the `zkp_req` queries, already validated.
	 * Mixed requests are refused before this point.
	 */
	constructor(options: {
		queries: Array<{ id: string } & ZkpQuery>;
		formats: ZkpFormats;
		presenter: IZkpPresenterClient;
	}) {
		this.#presenter = options.presenter;

		this.#requests = new Map(
			options.queries.map(({ id, ...query }) => [
				id,
				{
					query,
					formats: options.formats,
				},
			]),
		);
	}

	/**
	 * Matches every query. Only `ready` when all of them have a candidate.
	 *
	 * `credential_sets` is not handled yet: one failing query fails the whole request.
	 * When queries fail differently, the code sent is
	 * `invalid_request` > `vp_formats_not_supported` > `access_denied`.
	 * The `matches` in a `failed` result are for display only, never sent.
	 *
	 * @todo should this return metadata strings that the wallet uses
	 * 			 in the consent screen? Does it need to be handled by the
	 * 			 presenter or can it be done here by the wallet?
	 */
	async match(): Promise<ZkpReqMatchResult> {
		this.#candidates = null;

		const matches = new Map(
			await Promise.all(
				[...this.#requests].map(
					async ([queryId, request]) =>
						[queryId, await this.#presenter.match(request)] as const,
				),
			),
		);

		const candidates = new Map<string, Candidate>();
		for (const [queryId, match] of matches) {
			if (!('candidates' in match)) {
				return { kind: 'failed', code: failureCodeOf(matches), matches };
			}
			// Switching between candidates is not supported yet.
			// @todo figure that out.
			candidates.set(queryId, match.candidates[0]);
		}

		this.#candidates = candidates;
		return { kind: 'ready', candidates };
	}

	/**
	 * Only after a `ready` match and the user's consent. Rejects with a `ZkpProveError`.
	 *
	 * `inputs`: the values each candidate's `inputs` asks for, by query id.
	 * A query with none gets none; the presenter rejects if it needed some.
	 * One presentation per query; `multiple` is ignored.
	 */
	async prove(
		session: PresentationSession,
		inputs?: Map<string, Inputs>,
		signal?: AbortSignal,
	): Promise<Map<string, ZkpPresentation>> {
		const candidates = this.#candidates;
		if (!candidates) {
			throw new Error('prove called before a ready match');
		}

		const presentations = new Map<string, ZkpPresentation>();

		// Assumes a presenter may run only one proof at a time.
		for (const [queryId, candidate] of candidates) {
			const request = this.#requests.get(queryId);
			if (!request) {
				throw new Error(`Unknown credential query '${queryId}'`);
			}
			presentations.set(
				queryId,
				await this.#presenter.prove(candidate, request, session, inputs?.get(queryId), signal),
			);
		}

		return presentations;
	}
}

function failureCodeOf(matches: Map<string, Match>): ZkpReqFailureCode {
	const codes = new Set<ZkpReqFailureCode>();

	for (const match of matches.values()) {
		if ('refused' in match) {
			codes.add(match.refused === 'invalid' ? 'invalid_request' : 'vp_formats_not_supported');
		} else if ('rejected' in match) {
			codes.add('access_denied');
		}
	}

	return FAILURE_PRECEDENCE.find((code) => codes.has(code)) ?? 'access_denied';
}
