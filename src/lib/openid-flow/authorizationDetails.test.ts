import { describe, expect, it } from 'vitest';

import { buildAuthorizationDetails } from './authorizationDetails';

describe('buildAuthorizationDetails', () => {
	it('names the credential configuration DIIP v5 requires asking for', () => {
		expect(buildAuthorizationDetails('urn:eudi:pid:1')).toEqual([
			{ type: 'openid_credential', credential_configuration_id: 'urn:eudi:pid:1' },
		]);
	});

	it('builds details when the Authorization Server metadata is unknown', () => {
		// The engine-driven transports discover the AS server-side, so the wallet states its
		// intent and lets the engine decide. Withholding it would fail the requirement outright.
		expect(buildAuthorizationDetails('ehic', undefined)).toHaveLength(1);
		expect(buildAuthorizationDetails('ehic', null)).toHaveLength(1);
	});

	it('builds details when the Authorization Server advertises openid_credential', () => {
		expect(buildAuthorizationDetails('ehic', {
			authorization_details_types_supported: ['openid_credential'],
		})).toEqual([
			{ type: 'openid_credential', credential_configuration_id: 'ehic' },
		]);
	});

	it('takes an Authorization Server that lists other types at its word', () => {
		expect(buildAuthorizationDetails('ehic', {
			authorization_details_types_supported: ['payment_initiation'],
		})).toBeNull();
	});

	it('returns null without a credential configuration to name', () => {
		// An offer that names no configuration leaves the request to `scope`.
		expect(buildAuthorizationDetails(undefined)).toBeNull();
		expect(buildAuthorizationDetails('')).toBeNull();
	});
});
