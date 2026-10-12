import { useCallback, useEffect, useState } from 'react';
import type { ExtendedVcEntity } from '@/context/CredentialsContext';
import { logger } from '../logger';

export const useVcEntity = (
	fetchVcData: (batchId: number) => Promise<ExtendedVcEntity[] | null>,
	vcEntityList: ExtendedVcEntity[] | null,
	batchId: string,
) => {
	const [vcEntity, setVcEntity] = useState(null);

	const fetchAndSetVcEntity = useCallback(async () => {
		try {
			if (vcEntityList) {
				const vcEntity = vcEntityList.find(
					(vcEntity) => vcEntity.batchId === parseInt(batchId, 10)
				);
				if (!vcEntity) {
					throw new Error("Credential not found");
				}

				setVcEntity(vcEntity);
			} else {
				const fetchedList = await fetchVcData(parseInt(batchId, 10));
				// null here means the credential engine/wallet state isn't ready
				// yet (still loading), not that the credential is missing - keep
				// vcEntity as null so callers don't redirect as "not found".
				if (fetchedList == null) {
					setVcEntity(null);
					return;
				}
				if (!fetchedList[0]) {
					throw new Error("Credential not found");
				}
				setVcEntity(fetchedList[0]);
			}
		} catch (err) {
			logger.error('Error fetching VC entity:', err);
			setVcEntity(undefined); // Clear the state on error
		}
	}, [fetchVcData, vcEntityList, batchId]);

	useEffect(() => {
		fetchAndSetVcEntity();
	}, [fetchAndSetVcEntity]);

	return vcEntity;
};
