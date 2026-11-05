import { useCallback, useContext, useSyncExternalStore } from 'react';
import { OpenIdReissuanceContext } from '@/context/OpenIdReissuanceContext';
import { ReissueNotice } from '@/lib/openid-reissuance';

export function useOpenIdReissuaNotice() {
	const reissuer = useContext(OpenIdReissuanceContext);

	const state = useSyncExternalStore(
		useCallback(
			(onchange) => reissuer?.subscribe(onchange) ?? (() => {}),
			[reissuer],
		),
		() => reissuer?.getSnapshot(),
	);

	const getNotice = useCallback(
		(batchId: number): ReissueNotice | undefined => {
			return state?.notices.get(batchId)
		},
		[state],
	);

	return {
		getNotice,
	}
}
