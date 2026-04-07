import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
	resolve: {
		alias: {
			'@': resolve(__dirname, './src'),
		},
	},
	test: {
		globals: true,
		setupFiles: ['./setup-vitest.ts'],
		exclude: [
			'lib/**',
			'node_modules/**',
			// Temporarily excluded: wallet-common/dcql ESM compatibility issue
			// TODO: Re-enable once wallet-common handles ESM deps properly
			'**/CredentialInfo.test.jsx',
		],
		environmentMatchGlobs: [
			['**/services/*.test.ts', 'node'],
			['**', 'happy-dom']
		],
		typecheck: {
			enabled: true,
		},
	},
});
