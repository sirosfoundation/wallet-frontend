import { useCallback, useState } from 'react';

export function usePrfRetry() {
	const [needPrfRetry, setNeedPrfRetry] = useState(false);
	const [prfRetryAccepted, setPrfRetryAccepted] = useState(false);
	const [resolvePrfRetryPrompt, setResolve] = useState<((accept: boolean) => void) | null>(null);

	const promptForPrfRetry = useCallback((): Promise<boolean> => {
		setNeedPrfRetry(true);
		return new Promise<boolean>((resolve) => setResolve(() => resolve)).finally(() => {
			setNeedPrfRetry(false);
			setPrfRetryAccepted(true);
			setResolve(null);
		});
	}, []);

	const reset = useCallback(() => {
		setNeedPrfRetry(false);
		setPrfRetryAccepted(false);
		setResolve(null);
	}, []);

	return { needPrfRetry, prfRetryAccepted, resolvePrfRetryPrompt, promptForPrfRetry, reset };
}
