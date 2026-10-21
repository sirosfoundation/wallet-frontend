import { ZkpReqError } from './resources';
import type {
	Candidate,
	Inputs,
	IZkpPresenterClient,
	IZkpPresenterHost,
	Match,
	PresentationSession,
	WalletContext,
	ZkpPresentation,
	ZkpRequest,
} from './types';
import { ZkpPresenterNativeWrapperHost } from './hosts/ZkpPresenterNativeWrapperHost';
import { ZkpPresenterInPageHost } from './hosts/ZkpPresenterInPageHost';

/**
 * Hands each call to the highest-priority available {@link IZkpPresenterHost}.
 * One per wallet instance.
 */
export class ZkpPresenterClient implements IZkpPresenterClient {
	#ready: Promise<void>;
	#availableHosts: IZkpPresenterHost[] = [];

	constructor(options: {
		wallet: WalletContext;
		hosts?: IZkpPresenterHost[];
	}) {
		const hosts = options.hosts ?? [
			new ZkpPresenterNativeWrapperHost(),
			new ZkpPresenterInPageHost(),
		];
		this.#ready = this.#registerHosts(hosts, options.wallet);
	}

	async match(request: ZkpRequest): Promise<Match> {
		const host = await this.#selectHost();
		return host.match(request);
	}

	async prove(
		candidate: Candidate,
		request: ZkpRequest,
		session: PresentationSession,
		inputs?: Inputs,
		signal?: AbortSignal,
	): Promise<ZkpPresentation> {
		const host = await this.#selectHost();

		return host.prove(candidate, request, session, inputs, signal);
	}

	async dispose(): Promise<void> {
		await Promise.all(this.#availableHosts.map((host) => host.dispose?.()));
	}

	async #selectHost(): Promise<IZkpPresenterHost> {
		await this.#ready;

		const [host] = [...this.#availableHosts].sort(
			(a, b) => b.priority - a.priority,
		);
		if (!host) {
			throw new ZkpReqError('access_denied', 'No presenter host available');
		}

		return host;
	}

	async #registerHosts(
		hosts: IZkpPresenterHost[],
		wallet: WalletContext,
	): Promise<void> {
		await Promise.all(hosts.map((host) => host.initialize(wallet)));

		const availability = await Promise.all(
			hosts.map((host) => host.isAvailable()),
		);

		this.#availableHosts = hosts.filter((_, i) => availability[i]);
	}
}
