import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import SessionContext from '../context/SessionContext';
import { useAddSecurityKey } from './useAddSecurityKey';

vi.mock('@/services/keystore', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/services/keystore')>()),
	serializePrivateData: vi.fn(() => 'serialized-private-data'),
}));

const credential = {
	type: 'public-key',
	id: 'cred-2',
	rawId: new ArrayBuffer(8),
	authenticatorAttachment: 'platform',
	response: {
		clientDataJSON: new ArrayBuffer(8),
		attestationObject: new ArrayBuffer(8),
		getTransports: () => ['usb'],
	},
	getClientExtensionResults: () => ({}),
};

const beginResponse = {
	data: {
		challengeId: 'c1',
		createOptions: {
			publicKey: { authenticatorSelection: {} }
		}
	}
};
const finishResponse = {
	status: 200
};
const newPrivateData = {
	update: true
};

const setup = () => {
	const post = vi.fn((path: string): Promise<any> =>
		Promise.resolve(path.endsWith('register-begin') ? beginResponse : finishResponse)
	);
	const api = {
		post,
		updatePrivateDataEtag: vi.fn((resp) => resp),
		updateLocalPrivateData: vi.fn(),
	};
	const keystoreCommit = vi.fn();
	const keystore = { addPrf: vi.fn().mockResolvedValue([newPrivateData, keystoreCommit]) };
	const create = vi.fn().mockResolvedValue(credential);
	Object.defineProperty(navigator, 'credentials', {
		value: { create },
		configurable: true,
	});

	const { result } = renderHook(() => useAddSecurityKey(), {
		wrapper: ({ children }: { children: React.ReactNode }) => (
			<SessionContext.Provider value={{ api, keystore } as any}>
				{children}
			</SessionContext.Provider>
		),
	});

	const begin = () => act(() => result.current.begin('security-key'));
	const finish = async (nickname: Parameters<typeof result.current.finish>[0]) => {
		let ok: boolean | undefined;
		await act(async () => {
			ok = await result.current.finish(nickname);
		});
		return ok;
	};
	return { result, post, api, keystore, keystoreCommit, create, begin, finish };
};

describe('useAddSecurityKey', () => {
	it('creates a credential with the given hint', async () => {
		const { result, create, begin } = setup();
		await begin();

	expect(create.mock.calls[0][0].publicKey.hints).toEqual(['security-key']);
		expect(result.current.pendingCredential).toBe(credential);
		expect(result.current.isActive).toBe(true);
		expect(result.current.error).toBeNull();
	});

	it.each([
		['InvalidStateError', 'alreadyRegistered'],
		['NotAllowedError', 'cancelled'],
		['UnknownError', 'failed'],
	])('maps %s from the browser to %s', async (name, expected) => {
		const { result, create, begin } = setup();
		create.mockRejectedValue(Object.assign(new Error(), { name }));
		await begin();

		expect(result.current.error).toBe(expected);
		expect(result.current.isActive).toBe(false);
	});

	it('fails when register-begin returns no challenge', async () => {
		const { result, post, create, begin } = setup();
		post.mockResolvedValueOnce({ data: {} });
		await begin();

		expect(result.current.error).toBe('failed');
		expect(create).not.toHaveBeenCalled();
	});

	it('registers the key, updates private data and commits the keystore', async () => {
		const { result, post, api, keystore, keystoreCommit, begin, finish } = setup();
		await begin();

		expect(await finish('My key')).toBe(true);
		expect(keystore.addPrf).toHaveBeenCalledWith(credential, expect.any(Function));
		expect(post).toHaveBeenCalledWith('/user/session/webauthn/register-finish', expect.objectContaining({
			challengeId: 'c1',
			nickname: 'My key',
			privateData: 'serialized-private-data',
		}));
		expect(api.updatePrivateDataEtag).toHaveBeenCalledWith(finishResponse);
		expect(api.updateLocalPrivateData).toHaveBeenCalledWith(newPrivateData);
		expect(keystoreCommit).toHaveBeenCalled();
		expect(result.current.isActive).toBe(false);
	});

	it('asks for the label after the PRF step', async () => {
		const { post, keystore, begin, finish } = setup();
		await begin();
		const getLabel = vi.fn(async () => {
			expect(keystore.addPrf).toHaveBeenCalled();
			return 'Backup key';
		});

		expect(await finish(getLabel)).toBe(true);
		expect(getLabel).toHaveBeenCalledOnce();
		expect(post).toHaveBeenCalledWith('/user/session/webauthn/register-finish',
			expect.objectContaining({ nickname: 'Backup key' }));
	});

	it('does not register the key when the PRF step fails', async () => {
		const { result, post, keystore, keystoreCommit, begin, finish } = setup();
		keystore.addPrf.mockRejectedValue(new Error('prf failed'));
		await begin();

		expect(await finish('My key')).toBe(false);
		expect(post).not.toHaveBeenCalledWith('/user/session/webauthn/register-finish', expect.anything());
		expect(keystoreCommit).not.toHaveBeenCalled();
		expect(result.current.error).toBe('failed');
		expect(result.current.isActive).toBe(false);
	});

	it('throws on a private data version conflict', async () => {
		const { result, post, begin } = setup();
		await begin();
		post.mockRejectedValueOnce(Object.assign(new Error(), { cause: 'x-private-data-etag' }));

		await act(async () => {
			await expect(result.current.finish('My key')).rejects.toThrow('Private data version conflict');
		});
		expect(result.current.isActive).toBe(false);
	});

	it('cancels an in-progress registration', async () => {
		const { result, keystore, begin, finish } = setup();
		await begin();
		act(() => result.current.cancel());

		expect(result.current.isActive).toBe(false);
		expect(await finish('My key')).toBe(false);
		expect(keystore.addPrf).not.toHaveBeenCalled();
	});

	it('settles finish when canceled during the PRF retry prompt', async () => {
		const { result, keystore, keystoreCommit, begin } = setup();

		keystore.addPrf.mockImplementation(async (_credential, promptForPrfRetry) => {
			const accepted = await promptForPrfRetry();
			if (!accepted) {
				throw new Error('Canceled by user', {
					cause: { errorId: 'canceled' },
				});
			}
			return [newPrivateData, keystoreCommit];
		});

		await begin();

		let finishPromise!: Promise<boolean>;
		act(() => {
			finishPromise = result.current.finish('My key');
		});

		await waitFor(() => expect(result.current.needPrfRetry).toBe(true));
		act(() => result.current.cancel());

		await expect(finishPromise).resolves.toBe(false);
		expect(result.current.error).toBeNull();
	});
});
