import { useState, useEffect, useCallback } from 'react';
import { logger } from '../logger';

export const useVcEntity = (fetchVcData, vcEntityList, batchId) => {
	const [vcEntity, setVcEntity] = useState(null);

	const fetchAndSetVcEntity = useCallback(async () => {
		try {
			if (vcEntityList) {
				const vcEntity = vcEntityList.find(
					(vcEntity) => vcEntity.batchId === parseInt(batchId)
				);
				if (!vcEntity) {
					throw new Error("Credential not found");
				}

				setVcEntity(vcEntity);
			} else {
				const vcEntityList = await fetchVcData(parseInt(batchId));
				setVcEntity(vcEntityList?.[0]);

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
