import { useCallback, useContext, useState } from 'react';
import SessionContext from '@/context/SessionContext';
import { serializePrivateData } from '@/services/keystore';
import { withAuthenticatorAttachmentFromHints } from '@/lib/utils/webauthn';
import { logger } from '@/logger';
import { usePrfRetry } from '@/hooks/usePrfRetry';

export type AddSecurityKeyError = 'cancelled' | 'alreadyRegistered' | 'failed';

export function useAddSecurityKey() {
	const { api, keystore } = useContext(SessionContext);
	const { needPrfRetry, prfRetryAccepted, resolvePrfRetryPrompt, promptForPrfRetry, reset: resetPrf } = usePrfRetry();
	const [beginData, setBeginData] = useState<any>(null);
	const [pendingCredential, setPendingCredential] = useState<PublicKeyCredential | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<AddSecurityKeyError | null>(null);

	const cancel = useCallback(() => {
		logger.debug('onCancel');
		setBeginData(null);
		setPendingCredential(null);
		setIsSubmitting(false);
		resetPrf();
	}, [resetPrf]);

	const begin = useCallback(async (webauthnHint: string): Promise<boolean> => {
		setBeginData(null);
		setIsSubmitting(true);
		setPendingCredential(null);
		setError(null);

		try {
			const beginResponse = await api.post('/user/session/webauthn/register-begin', {});
			logger.debug('begin', beginResponse);
			const beginData = beginResponse.data;

			if (!beginData.challengeId) {
				setError('failed');
				return false;
			}
			setBeginData(beginData);

			const hints = [webauthnHint];
			const createOptions = {
				...beginData.createOptions,
				publicKey: {
					...beginData.createOptions.publicKey,
					hints,
					authenticatorSelection: withAuthenticatorAttachmentFromHints(beginData.createOptions.publicKey.authenticatorSelection, hints),
				},
			};

			const credential = await navigator.credentials.create(createOptions) as PublicKeyCredential;
			logger.debug('created', credential);
			setPendingCredential(credential);
			return true;

		} catch (e) {
			logger.error('Failed to register', e);
			if (e?.name === 'InvalidStateError') {
				setError('alreadyRegistered');
			} else if (e?.name === 'NotAllowedError') {
				setError('cancelled');
			} else {
				setError('failed');
			}
			setBeginData(null);
			setPendingCredential(null);
			return false;

		} finally {
			setIsSubmitting(false);
		}
	}, [api]);

	const finish = useCallback(async (nickname: string | (() => Promise<string>)): Promise<boolean> => {
		if (!beginData || !pendingCredential) {
			logger.error('Invalid state:', beginData, pendingCredential);
			return false;
		}
		try {
			const [newPrivateData, keystoreCommit] = await keystore.addPrf(
				pendingCredential,
				promptForPrfRetry,
			);
			const label = typeof nickname === 'function' ? await nickname() : nickname;
			setIsSubmitting(true);
			const response = pendingCredential.response as AuthenticatorAttestationResponse;
			api.updatePrivateDataEtag(await api.post('/user/session/webauthn/register-finish', {
				challengeId: beginData.challengeId,
				nickname: label,
				credential: {
					type: pendingCredential.type,
					id: pendingCredential.id,
					rawId: pendingCredential.rawId,
					response: {
						attestationObject: response.attestationObject,
						clientDataJSON: response.clientDataJSON,
						transports: response.getTransports(),
					},
					authenticatorAttachment: pendingCredential.authenticatorAttachment,
					clientExtensionResults: pendingCredential.getClientExtensionResults(),
				},
				privateData: serializePrivateData(newPrivateData),
			}));
			await api.updateLocalPrivateData(newPrivateData);
			await keystoreCommit();
			return true;

		} catch (e) {
			logger.error('Failed to finish registration', e);
			setError('failed');
			if (e?.cause === 'x-private-data-etag') {
				throw new Error('Private data version conflict', { cause: e });
			}
			return false;

		} finally {
			cancel();
		}
	}, [api, keystore, beginData, pendingCredential, promptForPrfRetry, cancel]);

	return {
		beginData,
		pendingCredential,
		isSubmitting,
		error,
		isActive: Boolean(beginData || pendingCredential),
		needPrfRetry,
		prfRetryAccepted,
		resolvePrfRetryPrompt,
		begin,
		finish,
		cancel,
	};
}
