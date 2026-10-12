export function truncateByWords(
	input: string,
	maxLength: number,
): { text: string; truncated: boolean } {
	const words = input.split(' ');
	let currentLength = 0;
	const result = words.reduce((acc, word) => {
		if (currentLength + word.length + 1 <= maxLength) {
			currentLength += word.length + 1;
			// biome-ignore lint/performance/noAccumulatingSpread: baseline: pre-existing debt. should be fixed
			return [...acc, word];
		}
		return acc;
	}, [] as string[]);

	const joined = result.join(' ');
	return {
		// biome-ignore lint/style/useTemplate: baseline: pre-existing debt. should be fixed
		text: joined !== input ? joined + '...' : joined,
		truncated: joined !== input,
	};
}
