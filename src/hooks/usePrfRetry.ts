import { useCallback, useState } from 'react';

export function usePrfRetry() {
	const [needPrfRetry, setNeedPrfRetry] = useState(false);
	const [prfRetryAccepted, setPrfRetryAccepted] = useState(false);
	const [resolvePrfRetryPrompt, setResolvePrfRetryPrompt] = useState<((accept: boolean) => void) | null>(null);

	const promptForPrfRetry = useCallback((): Promise<boolean> => {
		setNeedPrfRetry(true);
		return new Promise<boolean>((resolve) => setResolvePrfRetryPrompt(() => resolve)).finally(() => {
			setNeedPrfRetry(false);
			setPrfRetryAccepted(true);
			setResolvePrfRetryPrompt(null);
		});
	}, []);

	const reset = useCallback(() => {
		setNeedPrfRetry(false);
		setPrfRetryAccepted(false);
		setResolvePrfRetryPrompt(null);
	}, []);

	return { needPrfRetry, prfRetryAccepted, resolvePrfRetryPrompt, promptForPrfRetry, reset };
}
