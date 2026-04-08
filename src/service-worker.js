/* eslint-disable no-restricted-globals */

import { clientsClaim } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL, } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { StaleWhileRevalidate, CacheFirst, NetworkFirst } from "workbox-strategies";

const basePath = new URL(self.registration.scope).pathname.replace(/\/?$/, '/') || '/';

clientsClaim();

precacheAndRoute(self.__WB_MANIFEST, {
	ignoreURLParametersMatching: [/^v$/],
});

/**
 * Handle SKIP_WAITING message from client.
 * This allows the client to force the waiting service worker to activate immediately,
 * which is needed when switching tenants to ensure fresh precached content.
 */
self.addEventListener('message', (event) => {
	if (event.data && event.data.type === 'SKIP_WAITING') {
		self.skipWaiting();
	}
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

registerRoute(
	({ request, url }) => {
		if (request.mode !== "navigate") return false;
		if (url.pathname.startsWith("/_")) return false;
		if (/\.[a-zA-Z0-9]+$/.test(url.pathname)) return false;

		const pathname = url.pathname.replace(/^(\/id\/([a-z0-9-]+))/, '');

		return SPA_ROUTE_ALLOWLIST.some((re) => re.test(pathname));
	},
	createHandlerBoundToURL(`${basePath}index.html`)
);

/**
 * Tenant-specific logo files should use NetworkFirst to ensure fresh branding.
 * This prevents showing stale logos when switching between tenants.
 */
registerRoute(
	({ url }) =>
		url.pathname.includes('logo_') ||
		url.pathname.includes('Logo') ||
		url.pathname.endsWith('/logo.svg') ||
		url.pathname.endsWith('/logo.png'),
	new NetworkFirst({
		cacheName: "logos",
		plugins: [
			new ExpirationPlugin({
				maxEntries: 20,
				maxAgeSeconds: 60 * 60, // 1 hour
			}),
		],
	})
);

/**
 * Other images use StaleWhileRevalidate for better performance.
 */
registerRoute(
	({ url }) =>
		(url.pathname.endsWith(".png") ||
		url.pathname.endsWith(".jpg") ||
		url.pathname.endsWith(".jpeg") ||
		url.pathname.endsWith(".svg") ||
		url.pathname.endsWith(".webp")) &&
		// Exclude logos (handled above)
		!url.pathname.includes('logo_') &&
		!url.pathname.includes('Logo') &&
		!url.pathname.endsWith('/logo.svg') &&
		!url.pathname.endsWith('/logo.png'),
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
	})
);

let isFirstVisit = false;

self.addEventListener('install', (event) => {
	isFirstVisit = !self.registration.active;
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			// Clean old Workbox precache caches
			await cleanupOutdatedCaches();

			// Delete runtime image and logo caches
			const cacheNames = await caches.keys();
			await Promise.all(
				cacheNames
					.filter((name) => name === "images" || name === "logos")
					.map((name) => caches.delete(name))
			);

			// Claim and reload clients
			await self.clients.claim();

			if (!isFirstVisit) {
				const clients = await self.clients.matchAll();
				clients.forEach((client) => {
					client.navigate(client.url);
				});
			}
		})()
	);
});
