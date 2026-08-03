import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
	plugins: [react()],
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
		coverage: {
			provider: 'v8',
			reporter: ['text', 'lcov'],
			reportsDirectory: 'coverage',
			include: ['src/**/*.{ts,tsx,js,jsx}'],
			exclude: [
				'src/**/*.test.{ts,tsx,js,jsx}',
				'src/**/*.d.ts',
			],
		},
	},
});
