/* eslint-disable no-restricted-globals */

import { clientsClaim } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import {
	precacheAndRoute,
	cleanupOutdatedCaches,
	matchPrecache,
} from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import {
	NetworkFirst,
	StaleWhileRevalidate,
	CacheFirst,
} from "workbox-strategies";

const basePath =
	new URL(self.registration.scope).pathname.replace(/\/?$/, "/") || "/";

clientsClaim();
cleanupOutdatedCaches();

precacheAndRoute(self.__WB_MANIFEST, {
	ignoreURLParametersMatching: [/^v$/],
	directoryIndex: null,
});

const SPA_ROUTE_ALLOWLIST = [
	/^\/$/,                              // Home
	/^\/settings$/,                      // Settings
	/^\/history$/,                       // History list
	/^\/pending$/,                       // Pending
	/^\/add$/,                           // Add credentials
	/^\/send$/,                          // Send credentials
	/^\/verification\/result$/,          // Verification result
	/^\/login$/,                         // Login
	/^\/login-state$/,                   // Login state
	/^\/cb(\/.*)?$/,                     // Callback routes
	/^\/credential\/[^/]+$/,             // Credential
	/^\/credential\/[^/]+\/history$/,    // Credential history
	/^\/credential\/[^/]+\/details$/,    // Credential details
	/^\/history\/[^/]+$/,                // History detail
];

/**
 * Network-first strategy for the app shell (HTML) ensures that users
 * always get the latest version when online, while still providing
 * offline support by falling back to the cached shell.
 */
registerRoute(
	({ request, url }) => {
		if (request.mode !== "navigate") return false;
		if (url.pathname.startsWith("/_")) return false;
		if (/\.[a-zA-Z0-9]+$/.test(url.pathname)) return false;

		const pathname = url.pathname.replace(/^(\/id\/([a-z0-9-]+))/, '');

		return SPA_ROUTE_ALLOWLIST.some((re) => re.test(pathname));
	},
	new NetworkFirst({
		cacheName: "app-shell",
		plugins: [
			{
				cacheKeyWillBeUsed: async () => `${basePath}index.html`,
				handlerDidError: async () => {
					const cachedResponse = await matchPrecache(`${basePath}index.html`);
					return cachedResponse ?? Response.error();
				},
			},
		],
	}),
);

/**
 * Cache hashed build assets using a cache-first strategy.
 * This ensures that assets are available offline and
 * new versions are cached when updated.
 */
registerRoute(
	({ request, url }) =>
		request.destination === "script" ||
		request.destination === "style" ||
		request.destination === "worker" ||
		url.pathname.endsWith(".wasm"),
	new CacheFirst({
		cacheName: "assets",
		plugins: [
			new ExpirationPlugin({ maxEntries: 300, purgeOnQuotaError: true }),
		],
	}),
);

registerRoute(
	({ url }) =>
		url.pathname.endsWith(".png") ||
		url.pathname.endsWith(".jpg") ||
		url.pathname.endsWith(".jpeg") ||
		url.pathname.endsWith(".svg") ||
		url.pathname.endsWith(".webp"),
	new StaleWhileRevalidate({
		cacheName: "images",
		plugins: [
			new ExpirationPlugin({
				maxEntries: 200,
			}),
		],
	})
);

registerRoute(
	({ request }) => request.destination === "font",
	new CacheFirst({
		cacheName: "fonts",
		plugins: [
			new ExpirationPlugin({
				maxEntries: 50,
			}),
		],
	}),
);
