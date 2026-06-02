import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CredentialInfo from './CredentialInfo';
import i18n from 'i18next';

beforeEach(() => {
	i18n.changeLanguage('en');
});

afterEach(() => {
	i18n.changeLanguage('en');
});

describe('CredentialInfo sensitive claim masking', () => {
	it('masks sensitive claims by default and reveals on toggle', () => {
		const parsedCredential = {
			signedClaims: {
				given_name: "John",
				document_number: "AA123456",
				family_name: "Doe",
			},
			metadata: {
				credential: {
					TypeMetadata: {
						claims: [
							{
								path: ["given_name"],
								display: [{ locale: "en-US", label: "Given Name" }],
								sd: "always",
							},
							{
								path: ["document_number"],
								display: [{ locale: "en-US", label: "Document Number" }],
							},
							{
								path: ["family_name"],
								display: [{ locale: "en-US", label: "Family Name" }],
							}
						]
					}
				}
			}
		};

		render(<CredentialInfo parsedCredential={parsedCredential} />);

		expect(screen.queryByText('John')).not.toBeInTheDocument();
		expect(screen.queryByText('AA123456')).not.toBeInTheDocument();
		expect(screen.getByText('Doe')).toBeInTheDocument();
		expect(screen.getAllByText('••••••••')).toHaveLength(2);

		const revealButtons = screen.getAllByRole('button', { name: 'Reveal sensitive value' });
		fireEvent.click(revealButtons[0]);
		expect(screen.getByText('John')).toBeInTheDocument();
	});

	it('shows sensitive badge when requested', () => {
		const parsedCredential = {
			signedClaims: {
				birth_date: "1990-10-15",
			},
			metadata: {
				credential: {
					TypeMetadata: {
						claims: [
							{
								path: ["birth_date"],
								display: [{ locale: "en-US", label: "Birth Date" }],
							}
						]
					}
				}
			}
		};

		render(<CredentialInfo parsedCredential={parsedCredential} showSensitiveBadge />);
		expect(screen.getByLabelText('Sensitive field')).toBeInTheDocument();
	});
});
