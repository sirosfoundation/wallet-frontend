import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '@/i18n';
import ScanPhysicalID from './ScanPhysicalID';

const mockNavigate = vi.fn();
const mockBuildPath = vi.fn((subPath?: string) => (subPath ? `/${subPath}` : '/'));

const mockConfig = vi.hoisted(() => ({ SCAN_PHYSICAL_ID_ENABLED: true }));

vi.mock('react-router', async () => {
	const actual = await vi.importActual('react-router');
	return {
		...actual,
		useNavigate: () => mockNavigate,
	};
});

vi.mock('@/context/TenantContext', () => ({
	useTenant: () => ({ buildPath: mockBuildPath }),
}));

vi.mock('@/config', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/config')>();
	return {
		...actual,
		get SCAN_PHYSICAL_ID_ENABLED() {
			return mockConfig.SCAN_PHYSICAL_ID_ENABLED;
		},
	};
});

beforeEach(() => {
	i18n.changeLanguage('en');
	mockNavigate.mockClear();
	mockBuildPath.mockClear();
	mockConfig.SCAN_PHYSICAL_ID_ENABLED = true;
	// @ts-expect-error - test-only global, cleared/reset per test
	delete window.nativeWrapper;
});

afterEach(() => {
	i18n.changeLanguage('en');
	// @ts-expect-error - test-only global
	delete window.nativeWrapper;
});

describe('ScanPhysicalID', () => {
	it('renders the title, all three steps, and all three prerequisites', () => {
		render(<ScanPhysicalID />);

		expect(screen.getByText('Scan Physical ID')).toBeInTheDocument();

		expect(screen.getByText('Step 1')).toBeInTheDocument();
		expect(screen.getByText('Scan your face to show you are a real, live human')).toBeInTheDocument();
		expect(screen.getByText('Step 2')).toBeInTheDocument();
		expect(screen.getByText('Scan your document')).toBeInTheDocument();
		expect(screen.getByText('Step 3')).toBeInTheDocument();
		expect(screen.getByText('Place your phone on your document to read the NFC-chip')).toBeInTheDocument();

		expect(screen.getByText('Before you begin')).toBeInTheDocument();
		expect(screen.getByText('Have passport ready')).toBeInTheDocument();
		expect(screen.getByText('Have good lightning')).toBeInTheDocument();
		expect(screen.getByText('Have good internet connection')).toBeInTheDocument();
	});

	it('renders the "why face scan" explanation with a privacy policy link', () => {
		render(<ScanPhysicalID />);

		// Rendered twice (desktop + mobile layout variants), so use getAllBy*
		const headings = screen.getAllByText('Why face scan?');
		expect(headings.length).toBeGreaterThan(0);

		const links = screen.getAllByRole('link', { name: 'Privacy Policy' });
		expect(links.length).toBeGreaterThan(0);
		links.forEach((link) => {
			expect(link).toHaveAttribute('href', 'https://siros.org/policies/privacy-policy');
			expect(link).toHaveAttribute('target', '_blank');
			expect(link).toHaveAttribute('rel', 'noopener noreferrer');
		});
	});

	it('navigates back when the back button is clicked', () => {
		render(<ScanPhysicalID />);

		fireEvent.click(screen.getByLabelText('Go back'));

		expect(mockNavigate).toHaveBeenCalledWith(-1);
	});

	it('keeps the Start Scan button disabled when consent has not been given, even if the native bridge is available', () => {
		// @ts-expect-error - test-only global
		window.nativeWrapper = { startScanPhysicalId: vi.fn() };
		render(<ScanPhysicalID />);

		const startButtons = screen.getAllByRole('button', { name: 'Start Scan' });
		startButtons.forEach((button) => expect(button).toBeDisabled());
	});

	it('keeps the Start Scan button disabled when the native bridge is unavailable, even after consenting', () => {
		render(<ScanPhysicalID />);

		const checkboxes = screen.getAllByRole('checkbox');
		checkboxes.forEach((checkbox) => fireEvent.click(checkbox));

		const startButtons = screen.getAllByRole('button', { name: 'Start Scan' });
		startButtons.forEach((button) => expect(button).toBeDisabled());
	});

	it('enables the Start Scan button once consent is given and the native bridge is available, and invokes it on click', () => {
		const startScanPhysicalId = vi.fn();
		// @ts-expect-error - test-only global
		window.nativeWrapper = { startScanPhysicalId };
		render(<ScanPhysicalID />);

		const [checkbox] = screen.getAllByRole('checkbox');
		fireEvent.click(checkbox);

		const [startButton] = screen.getAllByRole('button', { name: 'Start Scan' });
		expect(startButton).not.toBeDisabled();

		fireEvent.click(startButton);
		expect(startScanPhysicalId).toHaveBeenCalledTimes(1);
	});

	it('treats a non-function nativeWrapper.startScanPhysicalId as unavailable', () => {
		// @ts-expect-error - test-only global, deliberately wrong shape
		window.nativeWrapper = { startScanPhysicalId: 'not-a-function' };
		render(<ScanPhysicalID />);

		const checkboxes = screen.getAllByRole('checkbox');
		checkboxes.forEach((checkbox) => fireEvent.click(checkbox));

		const startButtons = screen.getAllByRole('button', { name: 'Start Scan' });
		startButtons.forEach((button) => expect(button).toBeDisabled());
	});

	describe('when SCAN_PHYSICAL_ID_ENABLED is false', () => {
		beforeEach(() => {
			mockConfig.SCAN_PHYSICAL_ID_ENABLED = false;
		});

		it('renders nothing', () => {
			// @ts-expect-error - test-only global
			window.nativeWrapper = { startScanPhysicalId: vi.fn() };
			const { container } = render(<ScanPhysicalID />);

			expect(container).toBeEmptyDOMElement();
		});

		it('redirects away to the tenant-aware add-credentials path', () => {
			render(<ScanPhysicalID />);

			expect(mockBuildPath).toHaveBeenCalledWith('add');
			expect(mockNavigate).toHaveBeenCalledWith('/add', { replace: true });
		});
	});
});
