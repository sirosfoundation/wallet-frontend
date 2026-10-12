export function pathWithBase(basePath: string | undefined, path: string): string {
	if (!basePath) return path;
	if (!path) return basePath;

	return `${
		// biome-ignore lint/performance/useTopLevelRegex: baseline: pre-existing debt. should be fixed
		basePath.replace(/\/+$/, '')
	}/${
		// biome-ignore lint/performance/useTopLevelRegex: baseline: pre-existing debt. should be fixed
		path.replace(/^\/+/, '')
	}`;
}
