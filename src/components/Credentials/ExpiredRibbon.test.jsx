import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import en from '@/locales/en.json';

// The app's i18n instance initialises from localStorage and navigator, neither of which belongs
// in a test of this component. Returning the key keeps the assertions about which label the
// ribbon asks for; that the keys resolve to real text is checked against en.json below.
vi.mock('react-i18next', () => ({
	useTranslation: () => ({ t: (key) => key }),
}));

const ExpiredRibbon = (await import('./ExpiredRibbon')).default;

describe('ExpiredRibbon', () => {
	// The ribbon reports the outcome of the DIIP v5 validity and revocation algorithm, so every
	// outcome needs its own label — a revoked credential must not read as merely expired.
	it.each(['expired', 'notYetValid', 'revoked', 'suspended'])(
		'asks for the %s label',
		(credentialStatus) => {
			render(<ExpiredRibbon vcEntity={{ credentialStatus }} />);
			expect(screen.getByText(`expiredRibbon.${credentialStatus}`)).toBeTruthy();
		},
	);

	it('has real text behind every status it can show', () => {
		// A status with no translation would render its raw key to the user.
		for (const status of ['expired', 'notYetValid', 'revoked', 'suspended']) {
			expect(en.expiredRibbon?.[status], `missing en.expiredRibbon.${status}`).toBeTruthy();
		}
	});

	it('distinguishes the states that are recoverable from the ones that are not', () => {
		// Suspension and a not-yet-started validity window can both resolve on their own; expiry
		// and revocation cannot. Colour is the only thing carrying that distinction.
		const classOf = (credentialStatus) =>
			render(<ExpiredRibbon vcEntity={{ credentialStatus }} />).container.firstChild.className;
		expect(classOf('revoked')).toContain('bg-lm-red');
		expect(classOf('expired')).toContain('bg-lm-red');
		expect(classOf('suspended')).toContain('bg-lm-orange');
		expect(classOf('notYetValid')).toContain('bg-lm-orange');
	});

	it('still honours the isExpired flag call sites have not migrated off', () => {
		render(<ExpiredRibbon vcEntity={{ isExpired: true }} />);
		expect(screen.getByText('expiredRibbon.expired')).toBeTruthy();
	});

	it('renders nothing for a credential that is currently usable', () => {
		const { container } = render(<ExpiredRibbon vcEntity={{ isExpired: false }} />);
		expect(container.firstChild).toBeNull();
	});

	it('renders nothing without a credential', () => {
		const { container } = render(<ExpiredRibbon />);
		expect(container.firstChild).toBeNull();
	});

	it('falls back to the expired styling for a status it does not recognise', () => {
		// Forward compatibility: a newer wallet-common may report a status this build predates,
		// and an unstyled ribbon would be worse than a conservative one.
		const { container } = render(<ExpiredRibbon vcEntity={{ credentialStatus: 'somethingNew' }} />);
		expect(container.firstChild.className).toContain('bg-lm-red');
	});

	it('takes a caller-supplied border colour', () => {
		const { container } = render(
			<ExpiredRibbon vcEntity={{ credentialStatus: 'expired' }} borderColor="border-test" />,
		);
		expect(container.firstChild.className).toContain('border-test');
	});
});
