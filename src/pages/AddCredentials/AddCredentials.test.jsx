import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '@/i18n';
import AddCredentials from './AddCredentials';

const mockNavigate = vi.fn();
const mockBuildPath = vi.fn((subPath) => (subPath ? `/${subPath}` : '/'));

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
	const actual = await importOriginal();
	return {
		...actual,
		get SCAN_PHYSICAL_ID_ENABLED() {
			return mockConfig.SCAN_PHYSICAL_ID_ENABLED;
		},
	};
});

vi.mock('@/lib/services/OpenID4VCIHelper', () => ({
	useOpenID4VCIHelper: () => ({ getCredentialIssuerMetadata: vi.fn() }),
}));

beforeEach(() => {
	i18n.changeLanguage('en');
	mockNavigate.mockClear();
	mockBuildPath.mockClear();
	mockConfig.SCAN_PHYSICAL_ID_ENABLED = true;
	delete window.nativeWrapper;
});

afterEach(() => {
	i18n.changeLanguage('en');
	delete window.nativeWrapper;
});

describe('AddCredentials scan-physical-id entry point', () => {
	it('renders the Scan Physical ID section hidden when the native bridge is unavailable', () => {
		render(<AddCredentials />);

		const widget = document.querySelector('[data-widget="scan-physical-id"]');
		expect(widget).toBeInTheDocument();
		expect(widget).toHaveClass('hidden');
	});

	it('renders the Scan Physical ID section visible when the native bridge is available', () => {
		window.nativeWrapper = { startScanPhysicalId: vi.fn() };
		render(<AddCredentials />);

		const widget = document.querySelector('[data-widget="scan-physical-id"]');
		expect(widget).toBeInTheDocument();
		expect(widget).not.toHaveClass('hidden');
		expect(screen.getByText('Digital ID (scanned passport)')).toBeInTheDocument();
		expect(screen.getByText('Use your passport to create a digital ID.')).toBeInTheDocument();
	});

	it('navigates to add/digital-id when the Scan Physical ID card is clicked', () => {
		window.nativeWrapper = { startScanPhysicalId: vi.fn() };
		render(<AddCredentials />);

		fireEvent.click(screen.getByText('Digital ID (scanned passport)'));

		expect(mockBuildPath).toHaveBeenCalledWith('add/digital-id');
		expect(mockNavigate).toHaveBeenCalledWith('/add/digital-id');
	});

	it('treats a non-function nativeWrapper.startScanPhysicalId as the bridge being unavailable', () => {
		window.nativeWrapper = { startScanPhysicalId: 'not-a-function' };
		render(<AddCredentials />);

		const widget = document.querySelector('[data-widget="scan-physical-id"]');
		expect(widget).toHaveClass('hidden');
	});

	it('hides the section when SCAN_PHYSICAL_ID_ENABLED is false, even if the native bridge is available', () => {
		mockConfig.SCAN_PHYSICAL_ID_ENABLED = false;
		window.nativeWrapper = { startScanPhysicalId: vi.fn() };
		render(<AddCredentials />);

		const widget = document.querySelector('[data-widget="scan-physical-id"]');
		expect(widget).toHaveClass('hidden');
	});
});
