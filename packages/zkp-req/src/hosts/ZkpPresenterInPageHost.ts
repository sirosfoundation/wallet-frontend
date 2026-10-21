import {
	isProveError,
	ZkpPresenterHostPriority,
	ZkpPresenterHosts,
	ZkpProveError,
} from '../resources';
import type {
	Candidate,
	Inputs,
	IZkpPresenterHost,
	Match,
	PresentationSession,
	WalletContext,
	ZkpPresentation,
	ZkpPresenter,
	ZkpRequest,
} from '../types';
import { createMockZkpPresenter } from './mockZkpPresenter';

/**
 * Runs the presenter in the page.
 */
export class ZkpPresenterInPageHost implements IZkpPresenterHost {
	readonly id = ZkpPresenterHosts.IN_PAGE;
	readonly priority = ZkpPresenterHostPriority.IN_PAGE;

	#presenter: ZkpPresenter | null = null;

	async initialize(wallet: WalletContext): Promise<void> {
		try {
			/**
			 * @todo Replace the mock with the presenter package's `create_zkp_presenter`.
			 */
			this.#presenter = createMockZkpPresenter(wallet);
		} catch (error) {
			console.warn('[zkp-req] in-page presenter could not be created:', error);
			this.#presenter = null;
		}
	}

	async isAvailable(): Promise<boolean> {
		return this.#presenter !== null;
	}

	async match(request: ZkpRequest): Promise<Match> {
		return this.#requirePresenter().match(request);
	}

	async prove(
		candidate: Candidate,
		request: ZkpRequest,
		session: PresentationSession,
		inputs?: Inputs,
		signal?: AbortSignal,
	): Promise<ZkpPresentation> {
		try {
			return await this.#requirePresenter().prove(candidate, request, session, inputs, signal);
		} catch (error) {
			throw isProveError(error) ? new ZkpProveError(error) : error;
		}
	}

	async dispose(): Promise<void> {
		this.#presenter = null;
	}

	#requirePresenter(): ZkpPresenter {
		if (!this.#presenter) {
			throw new Error('The in-page presenter is not available');
		}
		return this.#presenter;
	}
}
