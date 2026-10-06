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

/**
 * We only skip waiting if the app requests it.
 */
self.addEventListener('message', (event) => {
	if (event.origin && event.origin !== self.location.origin) return;
	if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

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
 * App-shell navigations: network-first for freshness, precache fallback offline.
 */
registerRoute(
	({ request, url }) => {
		if (request.mode !== "navigate") return false;
		if (url.pathname.startsWith("/_")) return false;
		if (/\.[a-zA-Z0-9]+$/.test(url.pathname)) return false;

		const pathname = url.pathname.replace(/^(\/id\/([a-z0-9-]+))/, '');

		return SPA_ROUTE_ALLOWLIST.some((re) => re.test(pathname));
	},
	async ({ request }) => {
		try {
			// Online: always fresh HTML
			return await fetch(request);
		} catch {
			// Offline: the precached shell is atomically consistent with the
			// precached chunks it references, so lazy routes never 404.
			return (await matchPrecache(`${basePath}index.html`)) ?? Response.error();
		}
	},
);

/**
 * Hashed build assets are immutable, so any cached copy is valid. Match across
 * all caches (incl. a newer, still-waiting SW's precache) before hitting network.
 */
registerRoute(
	({ request, url }) =>
		request.destination === "script" ||
		request.destination === "style" ||
		request.destination === "worker" ||
		url.pathname.endsWith(".wasm"),
	async ({ request }) => {
		const cached = await caches.match(request);
		if (cached) return cached;
		try {
			const response = await fetch(request);
			if (response.ok) {
				(await caches.open("assets")).put(request, response.clone());
			}
			return response;
		} catch {
			return Response.error(); // → vite:preloadError → reload
		}
	},
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
