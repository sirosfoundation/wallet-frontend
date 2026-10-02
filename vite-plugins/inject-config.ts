import * as fs from 'node:fs';
import { resolve } from 'node:path';
import { Plugin } from 'vite';
import {
	ConfigManager,
	JsFs,
	Tag,
} from '@sirosfoundation/wallet-frontend-config-manager';

export function InjectConfigPlugin(env: Record<string, string>): Plugin {
	const configManager = new ConfigManager(
		new JsFs(fs),
		resolve('.schemas'),
		resolve('branding'),
		resolve('public'),
		env,
	);

	const tagsToInject = new Map<string, Tag>();

	const brandingHash = configManager.getHash();
	process.env.BRANDING_HASH = brandingHash; // import.meta.env.BRANDING_HASH works in TS/JS
	env.BRANDING_HASH = brandingHash; // BRANDING_HASH% works in index.html

	const runInjectConfigFiles = () => {
		const tags = configManager.injectConfigFiles();
		Object.entries(tags).forEach(([key, tag]) => {
			tagsToInject.set(key, tag);
		});
	};

	return {
		name: 'inject-config',
		transformIndexHtml: {
			order: 'pre',
			handler(html) {
				html = configManager.injectHtml(html, Object.fromEntries(tagsToInject));

				return {
					html,
					tags: [], // No additional tags to inject since we're directly modifying the HTML string
				}
			},
		},
		buildStart() {
			runInjectConfigFiles();
		},
		configureServer(server) {
			runInjectConfigFiles();

			server.watcher.on('change', (file) => {
				if (file.endsWith('.env')) {
					console.log('Environment file changed. Reinjecting config...');
					runInjectConfigFiles();
				}
			});

			// Make sure paths resolve in dev server
			server.middlewares.use((req, res, next) => {
				if (!env.BASE_PATH.startsWith('/id/')) {
					return next();
				}

				if (req.url === '/' && env.BASE_PATH.startsWith('/id/')) {
					res.writeHead(302, { Location: env.BASE_PATH });
					res.end();
					return;
				}

				if (req.url?.startsWith(env.BASE_PATH) && req.headers['content-type'] !== 'text/html') {
					req.url = req.url.slice(env.BASE_PATH.length, req.url.length);
				}

				next();
			});
		},
	};
}
