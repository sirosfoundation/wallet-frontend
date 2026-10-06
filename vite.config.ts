import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import checker from 'vite-plugin-checker';
import { VitePWA } from 'vite-plugin-pwa';
import tailwindcss from '@tailwindcss/vite';
import { InjectConfigPlugin } from './vite-plugins';

export default defineConfig(async ({ mode, command }) => {
	const env = loadEnv(mode, process.cwd(), '');

	mkdirSync(resolve('public'), { recursive: true });

	// each build gets a unique ID with UTC timestamp
	const buildId = [
		process.env.npm_package_version,
		Date.now().toString(),
	].join('--');

	return {
		base: './',
		define: {
			'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.npm_package_version),
			'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId)
		},
		plugins: [
			InjectConfigPlugin(env),
			react(),
			tailwindcss(),
			svgr(),
			checker({
				eslint: {
					lintCommand: 'eslint "./src/**/*.{js,jsx,ts,tsx}"',
				}
			}),
			VitePWA({
				registerType: 'autoUpdate',
				injectRegister: null,
				srcDir: 'src',
				filename: 'service-worker.js', // Custom service worker (MUST exist in `src/`)
				strategies: 'injectManifest', // Uses `src/service-worker.js` for caching
				manifest: false, // Vite will use `public/manifest.json` automatically
				injectManifest: {
					globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2,wasm}'],
					maximumFileSizeToCacheInBytes: env.GENERATE_SOURCEMAP === 'true' ? 16 * 1024 * 1024 : 8 * 1024 * 1024,
					additionalManifestEntries: [
						{ url: './manifest.json', revision: env.BRANDING_HASH },
					],
				},
			}),

		],
		resolve: {
			alias: {
				'@': '/src',
			},
		},
		server: {
			host: true,
			port: 3000,
			open: true,
		},
		preview: {
			host: true,
			port: 3000,
			open: true,
		},
		build: {
			manifest: true,
			sourcemap: true,
			minify: mode === 'production',
		},
	}
});
