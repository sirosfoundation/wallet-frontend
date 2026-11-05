import type { ExtendedVcEntity } from '@/context/CredentialsContext';
import { reissueBlocker, reissueDueAt } from './rules';
import {
	OpenIdReissue,
	OpenIdReissuerOptions,
	OpenIdGetRefreshEntry,
	WithLock,
	OpenIdSnapshot,
} from './types';
import { ReissueNotice } from './resources';
import { sameNotices } from './utils';
import { logger } from '@/logger';

export class OpenIdReissuer {
	readonly #reissue: OpenIdReissue;
	readonly #getRefreshEntry: OpenIdGetRefreshEntry;
	readonly #withLock: WithLock;

	#credentials: ExtendedVcEntity[] = [];
	#listeners: Set<() => void> = new Set();
	#snapshot: OpenIdSnapshot = { notices: new Map() };
	#timer?: ReturnType<typeof setTimeout>;
	#failed: Set<number> = new Set();
	#canRun = false;
	#running = false;
	#disposed = false;

	constructor({ reissue, getRefreshEntry, withLock }: OpenIdReissuerOptions) {
		this.#reissue = reissue;
		this.#getRefreshEntry = getRefreshEntry;
		this.#withLock = withLock;
	}

	setCredentials(credentials: ExtendedVcEntity[]): void {
		this.#credentials = credentials;
		this.#update();
	}

	setCanRun(canRun: boolean): void {
		this.#canRun = canRun;
		this.#update();
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	getSnapshot(): OpenIdSnapshot {
		return this.#snapshot;
	}

	dispose(): void {
		logger.debug('[OpenId reissue] disposed');
		this.#disposed = true;
		clearTimeout(this.#timer);
		this.#listeners.clear();
		this.#snapshot = { notices: new Map() };
		this.#credentials = [];
		this.#failed.clear();
	}

	#update() {
		if (this.#disposed) return;
		clearTimeout(this.#timer);

		const now = new Date();
		const queue: number[] = [];
		const notices = new Map<number, ReissueNotice>();

		let earliest: Date | null = null;

		for (const credential of this.#credentials) {
			const dueAt = reissueDueAt(credential, now);
			if (!dueAt) continue;

			const dueNow = dueAt <= now;

			if (!dueNow && (!earliest || dueAt < earliest)) {
				earliest = dueAt;
			}

			if (dueNow) {
				const blocker = reissueBlocker(
					credential,
					this.#getRefreshEntry(credential.batchId),
				);

				if (blocker) {
					notices.set(credential.batchId, blocker);
					continue;
				}

				if (this.#failed.has(credential.batchId)) {
					notices.set(credential.batchId, ReissueNotice.REISSUE_FAILED);
					continue;
				}

				queue.push(credential.batchId);
			}
		}

		if (!sameNotices(notices, this.#snapshot.notices)) {
			logger.debug(
				'[OpenId reissue] notices changed',
				Object.fromEntries(notices),
			);
			this.#snapshot = { notices };
			for (const listener of this.#listeners) listener();
		}

		let delay: number | undefined;
		if (earliest) {
			// cap earliest to 2h
			delay = Math.min(earliest.getTime() - now.getTime(), 2 * 60 * 60 * 1000);
			this.#timer = setTimeout(() => this.#update(), delay);
		}

		logger.debug('[OpenId reissue] update', {
			queue,
			notices: Object.fromEntries(notices),
			canRun: this.#canRun,
			running: this.#running,
			nextUpdateInSeconds:
				delay === undefined ? undefined : Math.round(delay / 1000),
		});

		if (this.#canRun && !this.#running && queue.length) {
			this.#run(queue[0]);
		}
	}

	async #run(batchId: number): Promise<void> {
		logger.debug('[OpenId reissue] reissuing batch', batchId);
		this.#running = true;
		let ran = false;

		try {
			await this.#withLock(async () => {
				ran = true;
				const success = await this.#reissue(batchId);
				logger.debug(
					'[OpenId reissue] batch',
					batchId,
					success ? 'reissued' : 'failed',
				);
				if (!success) this.#failed.add(batchId);
			});
		} catch (error) {
			logger.debug('[OpenId reissue] reissue threw for batch', batchId, error);
			this.#failed.add(batchId);
		} finally {
			this.#running = false;
		}

		if (!ran) {
			logger.debug(
				'[OpenId reissue] lock busy, waiting for the next update',
				batchId,
			);
		}

		// Lock busy: a page flow is running,
		// its end flips canRun and triggers an update.
		if (ran) this.#update();
	}
}
