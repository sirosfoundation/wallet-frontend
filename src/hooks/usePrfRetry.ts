import { useCallback, useState } from 'react';

export function usePrfRetry() {
	const [needPrfRetry, setNeedPrfRetry] = useState(false);
	const [prfRetryAccepted, setPrfRetryAccepted] = useState(false);
	const [resolvePrfRetryPrompt, setResolvePrfRetryPrompt] = useState<((accept: boolean) => void) | null>(null);

	const promptForPrfRetry = useCallback((): Promise<boolean> => {
		setNeedPrfRetry(true);
		setPrfRetryAccepted(false);
		return new Promise<boolean>((resolve) => setResolvePrfRetryPrompt(() => resolve))
			.then((accepted) => {
				setPrfRetryAccepted(accepted);
				return accepted;
			})
			.finally(() => {
				setNeedPrfRetry(false);
				setResolvePrfRetryPrompt(null);
			});
	}, []);

	const reset = useCallback(() => {
		resolvePrfRetryPrompt?.(false);
		setNeedPrfRetry(false);
		setPrfRetryAccepted(false);
		setResolvePrfRetryPrompt(null);
	}, [resolvePrfRetryPrompt]);

	return { needPrfRetry, prfRetryAccepted, resolvePrfRetryPrompt, promptForPrfRetry, reset };
}
