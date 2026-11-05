import {
	FC,
	PropsWithChildren,
	useContext,
	useState,
	useEffect,
	useRef,
} from 'react';
import SessionContext from '@/context/SessionContext';
import CredentialsContext from '@/context/CredentialsContext';
import { OID4VCI_FLOW_LOCK, useOID4VCIFlow } from '@/hooks/useOID4VCIFlow';
import { OpenIdGetRefreshEntry, OpenIdReissue, OpenIdReissuer } from '@/lib/openid-reissuance';
import { withLock } from '@/lib/utils/lock';
import StatusContext from '@/context/StatusContext';
import { logger } from '@/logger';
import { OpenIdReissuanceContext } from './OpenIdReissuanceContext';
import { WalletStateExtension } from '@/services/WalletStateSchema';
import { parseOID4VCIRefreshEntry } from '@/services/extensions/oid4vci-refresh';

export const OpenIdReissuanceContextProvider: FC<PropsWithChildren> = ({
	children,
}) => {
	const { isOnline, isSafeToUpdate, blockUpdates } = useContext(StatusContext);
	const { isLoggedIn, keystore } = useContext(SessionContext);
	const { vcEntityList } = useContext(CredentialsContext);

	const { refreshCredential, handleReceivedCredentials } = useOID4VCIFlow();

	const [reissuer, setReissuer] = useState<OpenIdReissuer | null>(null);

	const getRefreshEntryRef = useRef<OpenIdGetRefreshEntry | null>(null);
	getRefreshEntryRef.current = (batchId) => {
		const refreshEntries = keystore.getCalculatedWalletState()
			?.extensions
			?.[WalletStateExtension.OID4VCI_REFRESH];

		return parseOID4VCIRefreshEntry(refreshEntries?.[String(batchId)]);
	};

	const reissueRef = useRef<OpenIdReissue>(null);
	reissueRef.current = async (batchId) => {
		const unblockUpdates = blockUpdates('oid4vci-reissue');

		try {
			const refreshResult = await refreshCredential(batchId);
			if (!refreshResult.success || !refreshResult?.credentials?.length) {
				logger.warn('Failed to refresh credentials');
				return false;
			}

			const handleResult = await handleReceivedCredentials(
				refreshResult.credentials,
				refreshResult.credentialIssuerIdentifier,
				refreshResult.selectedCredentialConfigurationId,
				refreshResult.flowId,
				{
					dpopJwk: refreshResult.dpopJwk,
					dpopKeyId: refreshResult.dpopKeyId,
					refreshToken: refreshResult.refreshToken,
				},
				batchId,
			);

			if (!handleResult.success) {
				logger.warn('Failed to handle received credentials');
				return false;
			}

			return true;
		} finally {
			unblockUpdates();
		}
	};

	useEffect(() => {
		if (!isLoggedIn) return;

		const instance = new OpenIdReissuer({
			reissue: (batchId) => reissueRef.current!(batchId),
			getRefreshEntry: (batchId) => getRefreshEntryRef.current!(batchId),
			withLock: (task) => withLock(OID4VCI_FLOW_LOCK, task),
		});
		setReissuer(instance);

		return () => {
			instance?.dispose();
			setReissuer(null);
		};
	}, [isLoggedIn]);

	useEffect(() => {
		if (!vcEntityList) return;
		reissuer?.setCredentials(vcEntityList);
	}, [reissuer, vcEntityList]);

	useEffect(() => {
		reissuer?.setCanRun(isOnline && isSafeToUpdate);
	}, [reissuer, isOnline, isSafeToUpdate]);

	return (
		<OpenIdReissuanceContext.Provider value={reissuer}>
			{children}
		</OpenIdReissuanceContext.Provider>
	);
};
