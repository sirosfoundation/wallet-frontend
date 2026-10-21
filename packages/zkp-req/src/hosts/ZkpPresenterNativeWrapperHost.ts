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
	ZkpRequest,
} from '../types';

/**
 * What this host needs from `window.nativeWrapper`.
 *
 * @todo Placeholder names until the wrapper defines them.
 */
interface NativeZkpBridge {
	zkpMatch(request: ZkpRequest): Promise<unknown>;
	zkpProve(
		candidate: Candidate,
		request: ZkpRequest,
		session: PresentationSession,
		inputs?: Inputs,
	): Promise<unknown>;
	zkpCancel(): Promise<void>;
	/**
	 * Native calls the presenter's {@link WalletContext} through `handler`.
	 * Returns a function that removes it.
	 */
	onZkpRequest(
		handler: (method: string, params: unknown[]) => Promise<unknown>,
	): () => void;
}

const WALLET_METHODS = [
	'credentials',
	'metadata',
	'anchors',
	'sign',
	'random',
	'now',
] as const;

/**
 * Runs the presenter in the native wrapper app.
 *
 * @todo Binary fields (`session.handover`, `proof`) need an encoding if the bridge only carries strings.
 * @todo Validate what native returns instead of casting it.
 */
export class ZkpPresenterNativeWrapperHost implements IZkpPresenterHost {
	readonly id = ZkpPresenterHosts.NATIVE_WRAPPER;
	readonly priority = ZkpPresenterHostPriority.NATIVE_WRAPPER;

	#wallet: WalletContext | null = null;
	#removeHandler: (() => void) | null = null;

	async initialize(wallet: WalletContext): Promise<void> {
		this.#wallet = wallet;
		this.#removeHandler =
			this.#bridge()?.onZkpRequest((method, params) =>
				this.#answerWalletCall(method, params),
			) ?? null;
	}

	async isAvailable(): Promise<boolean> {
		return this.#bridge() !== null;
	}

	async match(request: ZkpRequest): Promise<Match> {
		return (await this.#requireBridge().zkpMatch(request)) as Match;
	}

	async prove(
		candidate: Candidate,
		request: ZkpRequest,
		session: PresentationSession,
		inputs?: Inputs,
		signal?: AbortSignal,
	): Promise<ZkpPresentation> {
		const bridge = this.#requireBridge();
		signal?.throwIfAborted();

		const cancel = () => void bridge.zkpCancel();
		signal?.addEventListener('abort', cancel, { once: true });

		try {
			return (await bridge.zkpProve(candidate, request, session, inputs)) as ZkpPresentation;
		} catch (error) {
			throw isProveError(error) ? new ZkpProveError(error) : error;
		} finally {
			signal?.removeEventListener('abort', cancel);
		}
	}

	async dispose(): Promise<void> {
		this.#removeHandler?.();
		this.#removeHandler = null;
	}

	// Native may only call the WalletContext methods, nothing else on the page.
	async #answerWalletCall(method: string, params: unknown[]): Promise<unknown> {
		const wallet = this.#wallet;
		if (!wallet) {
			throw new Error('The native wrapper host is not initialized');
		}
		if (!isWalletMethod(method)) {
			throw new Error(`Unknown wallet method '${method}'`);
		}

		const walletMethod = wallet[method] as unknown as (...args: unknown[]) => unknown;
		return walletMethod.apply(wallet, params);
	}

	/**
	 * Null outside the native wrapper.
	 */
	#bridge(): NativeZkpBridge | null {
		const nativeWrapper = (globalThis as {
			nativeWrapper?: Partial<NativeZkpBridge>;
		}).nativeWrapper;

		return nativeWrapper &&
			typeof nativeWrapper.zkpMatch === 'function' &&
			typeof nativeWrapper.zkpProve === 'function' &&
			typeof nativeWrapper.zkpCancel === 'function' &&
			typeof nativeWrapper.onZkpRequest === 'function'
			? (nativeWrapper as NativeZkpBridge)
			: null;
	}

	#requireBridge(): NativeZkpBridge {
		const bridge = this.#bridge();
		if (!bridge) {
			throw new Error('The native wrapper bridge is not available');
		}
		return bridge;
	}
}

function isWalletMethod(method: string): method is (typeof WALLET_METHODS)[number] {
	return (WALLET_METHODS as readonly string[]).includes(method);
}
