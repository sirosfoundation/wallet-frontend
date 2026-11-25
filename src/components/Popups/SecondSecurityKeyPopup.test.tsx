import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor} from '@testing-library/react';
import Modal from 'react-modal';
import i18n from '@/i18n';
import StatusContext from '@/context/StatusContext';
import SecondSecurityKeyPopup from './SecondSecurityKeyPopup';

const addKey = vi.hoisted(() => ({} as any));
vi.mock('@/hooks/useAddSecurityKey', () => ({ useAddSecurityKey: () => addKey }));

const renderPopup = ({ isOnline = true } = {}) => {
	const onDone = vi.fn();
	const onInlineChange = vi.fn();
	render(
		<StatusContext.Provider value={{ isOnline } as any}>
			<SecondSecurityKeyPopup onDone={onDone} onInlineChange={onInlineChange} />
		</StatusContext.Provider>
	);
	return { onDone, onInlineChange };
};

beforeEach(() => {
	i18n.changeLanguage('en');
	Modal.setAppElement(document.createElement('div'));
	Object.assign(addKey, {
		beginData: null,
		pendingCredential: null,
		error: null,
		isSubmitting: false,
		needPrfRetry: false,
		prfRetryAccepted: false,
		resolvePrfRetryPrompt: vi.fn(),
		begin: vi.fn(),
		finish: vi.fn(),
		cancel: vi.fn(),
	});
});

describe('SecondSecurityKeyPopup', () => {
	it('starts registration with a security key on Yes', () => {
		renderPopup();
		fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
		expect(addKey.begin).toHaveBeenCalledWith('security-key');
	});

	it('closes on Skip', () => {
		const { onDone } = renderPopup();
		fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
		expect(onDone).toHaveBeenCalled();
	});

	it('closes when offline', () => {
		const { onDone } = renderPopup({ isOnline: false });
		expect(onDone).toHaveBeenCalled();
	});

	it('shows the registration error', () => {
		addKey.error = 'alreadyRegistered';
		renderPopup();
		expect(screen.getByText('This security key is already registered. Please use a different one.')).toBeTruthy();
	});

	it('shows progress inline while waiting for the key', () => {
		addKey.beginData = {};
		const { onInlineChange } = renderPopup();

		expect(onInlineChange).toHaveBeenLastCalledWith(true);
		expect(screen.queryByRole('dialog')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(addKey.cancel).toHaveBeenCalled();
	});

	it('continues the PRF step', () => {
		addKey.beginData = {};
		addKey.needPrfRetry = true;
		renderPopup();
		fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		expect(addKey.resolvePrfRetryPrompt).toHaveBeenCalledWith(true);
	});

	it.each([
		['Confirm', 'Backup key'],
		['Skip', ''],
	])('asks for the label after PRF and finishes on %s', async (button, expectedLabel) => {
		let label: string | undefined;
		addKey.beginData = {};
		addKey.pendingCredential = {};
		addKey.finish = vi.fn(async (getLabel: () => Promise<string>) => {
			label = await getLabel();
			return true;
		});
		const { onDone } = renderPopup();

		fireEvent.change(await screen.findByPlaceholderText('Enter label'), { target: { value: '  Backup key  ' } });
		fireEvent.click(screen.getByRole('button', { name: button }));

		await waitFor(() => expect(onDone).toHaveBeenCalled());
		expect(label).toBe(expectedLabel);
		expect(addKey.finish).toHaveBeenCalledOnce();
	});
});
