import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ShareInPerson from "./ShareInPerson";
import i18n from "@/i18n";

const mockDebug = vi.hoisted(() => vi.fn());

vi.mock('@/logger', () => ({
	logger: {
		debug: mockDebug,
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	},
}));

beforeEach(() => {
	i18n.changeLanguage("en");
	mockDebug.mockClear();
});

describe("ShareInPerson", () => {
	it("renders the component", () => {
		render(<ShareInPerson />);
		expect(screen.getByRole('heading', { level: 1, name: 'Share In-Person' })).toBeInTheDocument();
		expect(screen.getByText('Share a credential with a nearby device in one of three ways:')).toBeInTheDocument();
	});

	it('renders all three options with the title and the description', () => {
		render(<ShareInPerson />);
		expect(screen.getByText('Tap another device')).toBeInTheDocument();
		expect(screen.getByText('Share data with a requester by holding your device to theirs.')).toBeInTheDocument();
		expect(screen.getByText('Show QR code')).toBeInTheDocument();
		expect(screen.getByText('Show your QR code for the device to scan.')).toBeInTheDocument();
		expect(screen.getByText('Scan QR code')).toBeInTheDocument();
		expect(screen.getByText("Scan the device's QR code with your phone.")).toBeInTheDocument();

		expect(screen.getAllByRole('button')).toHaveLength(3);
	});

	it.each([
		['share-in-person-tap', '[ShareInPerson] tap selected'],
		['share-in-person-showQr', '[ShareInPerson] show QR selected'],
		['share-in-person-scanQr', '[ShareInPerson] scan QR selected']
	])('clicking %s calls its handler', (id, expectedLog) => {
		render(<ShareInPerson />);
		fireEvent.click(document.getElementById(id));
		expect(mockDebug).toHaveBeenCalledWith(expectedLog);
	});
});