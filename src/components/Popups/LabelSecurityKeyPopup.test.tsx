import React from 'react';
import { describe, it, expect, vi, beforeEach} from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Modal from 'react-modal';
import i18n from '@/i18n';
import SessionContext from '@/context/SessionContext';
import LabelSecurityKeyPopup from './LabelSecurityKeyPopup';

const renderPopup = (post: ReturnType<typeof vi.fn>) => {
	const onClose = vi.fn();
	render(
		<SessionContext.Provider value={{ api: { post } } as any}>
			<LabelSecurityKeyPopup isOpen={true} webauthnCredentialId="abc"onClose={onClose} />
		</SessionContext.Provider>
	);
	return { onClose };
};

beforeEach(() => {
	i18n.changeLanguage('en');
	Modal.setAppElement(document.createElement('div'));
});

describe('LabelSecurityKeyPopup', () => {
	it('disables Confirm button when input is empty', () => {
		renderPopup(vi.fn());
		expect(screen.getByRole('button', { name: 'Confirm' })).toHaveProperty('disabled', true);
	});

	it('labels the security key with a trimmed nickname', async () => {
		const post = vi.fn().mockResolvedValue({ status: 204 });
		const { onClose } = renderPopup(post);
		fireEvent.change( screen.getByLabelText('Security key label'), { target: { value: '  My Key  ' } });
		fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
		await waitFor(() =>
			expect(onClose).toHaveBeenCalledWith());

	expect(post).toHaveBeenCalledWith('/user/session/webauthn/credential/abc/rename', {
		nickname: 'My Key'});
	});

	it('skips without calling the API', () => {
		const post = vi.fn();
		const { onClose } = renderPopup(post);
		fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
		expect(onClose).toHaveBeenCalled();
		expect(post).not.toHaveBeenCalled();
	});

	it('shows an error and stays open when labelling fails', async () => {
		const post = vi.fn().mockRejectedValue(new Error('500'));
		const { onClose } = renderPopup(post);
		fireEvent.change(screen.getByLabelText('Security key label'), { target: { value: 'My Key' } });
		fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
		expect(await screen.findByText('Could not label the security key. Try again.')).toBeTruthy();
		expect(onClose).not.toHaveBeenCalled();
	});
});
