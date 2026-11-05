import { test, expect, type BrowserContext, type Page } from '@playwright/test';

const LOCK_NAME = 'wallet-active-tab';

test.beforeEach(async ({ context, baseURL }) => {
	// Only the frontend runs; fail backend calls fast instead of waiting on timeouts.
	const origin = new URL(baseURL!).origin;
	await context.route(
		(url) => url.origin !== origin,
		(route) => route.abort(),
	);
});

test('only one tab is active', async ({ context }) => {
	const first = await openActiveTab(context);
	const second = await openTab(context);

	await expectInactive(second);
	await expectActive(first);
});

test('taking over moves the wallet to the new tab', async ({ context }) => {
	const first = await openActiveTab(context);
	const second = await openTab(context);
	await expectInactive(second);

	await takeOver(second, first);

	await expectActive(second);
	await expectInactive(first);
});

test('a tab that handed over does not take the wallet back on its own', async ({
	context,
}) => {
	const first = await openActiveTab(context);
	const second = await openTab(context);
	await expectInactive(second);
	await takeOver(second, first);

	await second.close();
	await first.waitForTimeout(1_000);

	await expectInactive(first);
	const held = await first.evaluate(
		async () => (await navigator.locks.query()).held ?? [],
	);
	expect(held).toHaveLength(0);
});

test('a new tab becomes active once the active tab is closed', async ({
	context,
}) => {
	const first = await openActiveTab(context);
	const second = await openTab(context);
	await expectInactive(second);

	await first.close();
	const third = await openActiveTab(context);

	await expectActive(third);
	await expectInactive(second);
});

test('tabs can take over back and forth', async ({ context }) => {
	const first = await openActiveTab(context);
	const second = await openTab(context);
	await expectInactive(second);
	await takeOver(second, first);
	await expectInactive(first);

	await takeOver(first, second);

	await expectActive(first);
	await expectInactive(second);
});

async function openTab(context: BrowserContext): Promise<Page> {
	const page = await context.newPage();
	await page.goto('/');
	return page;
}

// Only use while a single tab could be asking for the lock.
async function waitForLockHeld(page: Page): Promise<void> {
	await page.waitForFunction(async (name) => {
		const { held = [] } = await navigator.locks.query();
		return held.some((lock) => lock.name === name);
	}, LOCK_NAME);
}

async function openActiveTab(context: BrowserContext): Promise<Page> {
	const page = await openTab(context);
	await waitForLockHeld(page);
	await expectActive(page);
	return page;
}

function takeOverPopup(page: Page) {
	return page.getByRole('heading', {
		name: 'The wallet is active in another tab',
	});
}

async function expectActive(page: Page): Promise<void> {
	await expect(takeOverPopup(page)).toBeHidden();
	await expect(page).not.toHaveTitle(/^\[Inactive\]/);
}

async function expectInactive(page: Page): Promise<void> {
	await expect(takeOverPopup(page)).toBeVisible();
	await expect(page).toHaveTitle(/^\[Inactive\]/);
}

// The tab that hands over reloads; wait for it so the next step sees the reloaded page.
async function takeOver(page: Page, from: Page): Promise<void> {
	const reloaded = from.waitForEvent('load');
	await page.getByRole('button', { name: 'Take Over' }).click();
	await reloaded;
}
