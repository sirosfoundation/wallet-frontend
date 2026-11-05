import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenStatus } from '@sirosfoundation/token-status-list';
import type { ExtendedVcEntity, Instance } from '@/context/CredentialsContext';
import type { OID4VCIRefreshEntry } from '@/services/extensions/oid4vci-refresh';
import { requirementsForCredential } from '@/lib/wscd-manager/utils';
import { WscdPlugin } from '@/lib/wscd-manager/resources';
import { reissueBlocker, reissueDueAt } from './rules';
import { ReissueNotice } from './resources';

vi.mock('@/lib/wscd-manager/utils', () => ({
	requirementsForCredential: vi.fn(),
}));

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-05T12:00:00Z');

const refreshEntry: OID4VCIRefreshEntry = {
	refreshToken: 'token',
	credentialIssuerIdentifier: 'https://issuer.example',
	credentialConfigurationId: 'pid',
};

describe('reissueDueAt', () => {
	it('is never due when the batch is revoked', () => {
		const revoked = credential({
			status: TokenStatus.INVALID,
			instances: [instance(), instance({ sigCount: 1 })],
			validFrom: new Date(NOW.getTime() - 100 * DAY),
			validUntil: new Date(NOW.getTime() + 1 * DAY),
		});

		expect(reissueDueAt(revoked, NOW)).toBeNull();
	});

	it('is never due when the batch is suspended', () => {
		const suspended = credential({
			status: TokenStatus.SUSPENDED,
			instances: [instance(), instance({ sigCount: 1 })],
		});

		expect(reissueDueAt(suspended, NOW)).toBeNull();
	});

	it('is due now when one usable instance is left', () => {
		const runningLow = credential({
			instances: [instance(), instance({ sigCount: 1 }), instance({ sigCount: 2 })],
		});

		expect(reissueDueAt(runningLow, NOW)).toEqual(NOW);
	});

	it('is due now when no usable instance is left', () => {
		const usedUp = credential({
			instances: [instance({ sigCount: 1 }), instance({ sigCount: 1 })],
		});

		expect(reissueDueAt(usedUp, NOW)).toEqual(NOW);
	});

	it('does not count blocked instances as usable', () => {
		const runningLow = credential({
			instances: [
				instance(),
				instance({ status: TokenStatus.INVALID }),
				instance({ status: TokenStatus.SUSPENDED }),
			],
		});

		expect(reissueDueAt(runningLow, NOW)).toEqual(NOW);
	});

	it('counts instances with a valid or unknown status as usable', () => {
		const plenty = credential({
			instances: [
				instance({ status: TokenStatus.VALID }),
				instance({ status: TokenStatus.UNKNOWN }),
			],
		});

		expect(reissueDueAt(plenty, NOW)).toBeNull();
	});

	it('ignores usage for a single-instance batch', () => {
		const single = credential({ instances: [instance({ sigCount: 5 })] });

		expect(reissueDueAt(single, NOW)).toBeNull();
	});

	it('is due when 10% of the validity is left', () => {
		const validFrom = new Date(NOW.getTime() + 10 * DAY);
		const validUntil = new Date(NOW.getTime() + 110 * DAY);

		expect(reissueDueAt(credential({ validFrom, validUntil }), NOW)).toEqual(
			new Date(NOW.getTime() + 100 * DAY),
		);
	});

	it('returns a past date when less than 10% is already left', () => {
		const validFrom = new Date(NOW.getTime() - 99 * DAY);
		const validUntil = new Date(NOW.getTime() + 1 * DAY);

		const dueAt = reissueDueAt(credential({ validFrom, validUntil }), NOW);

		expect(dueAt!.getTime()).toBeLessThan(NOW.getTime());
	});

	it('measures validity from the signing time without validFrom', () => {
		const signed = new Date(NOW.getTime());
		const validUntil = new Date(NOW.getTime() + 10 * DAY);

		expect(reissueDueAt(credential({ signed, validUntil }), NOW)).toEqual(
			new Date(NOW.getTime() + 9 * DAY),
		);
	});

	it('prefers validFrom over the signing time', () => {
		const validFrom = new Date(NOW.getTime());
		const signed = new Date(NOW.getTime() - 90 * DAY);
		const validUntil = new Date(NOW.getTime() + 10 * DAY);

		expect(
			reissueDueAt(credential({ validFrom, signed, validUntil }), NOW),
		).toEqual(new Date(NOW.getTime() + 9 * DAY));
	});

	it('is never due without an expiry', () => {
		const validFrom = new Date(NOW.getTime() - 10 * DAY);

		expect(reissueDueAt(credential({ validFrom }), NOW)).toBeNull();
	});

	it('is never due without a start date', () => {
		const validUntil = new Date(NOW.getTime() + 10 * DAY);

		expect(reissueDueAt(credential({ validUntil }), NOW)).toBeNull();
	});
});

describe('reissueBlocker', () => {
	beforeEach(() => {
		vi.mocked(requirementsForCredential).mockReturnValue({
			plugin: WscdPlugin.SOFTKEY,
			factors: [{ kind: 'none' }],
		});
	});

	it('is not blocked with a refresh token and a key that needs no user', () => {
		expect(reissueBlocker(credential(), refreshEntry)).toBeUndefined();
	});

	it('is blocked without a refresh token', () => {
		expect(reissueBlocker(credential(), undefined)).toBe(
			ReissueNotice.NO_REFRESH_TOKEN,
		);
	});

	it('is blocked when the refresh token is bound to a hardware key', () => {
		const entry = { ...refreshEntry, dpopKid: 'hw-key' };

		expect(reissueBlocker(credential(), entry)).toBe(
			ReissueNotice.HARDWARE_BOUND,
		);
	});

	it('is blocked when the credential key needs the user', () => {
		vi.mocked(requirementsForCredential).mockReturnValue({
			plugin: WscdPlugin.SOFTKEY,
			factors: [{ kind: 'webauthn', rpId: 'wallet.example' }],
		});

		expect(reissueBlocker(credential(), refreshEntry)).toBe(
			ReissueNotice.HARDWARE_BOUND,
		);
	});

	it('looks up the requirements by the credential key id', () => {
		reissueBlocker(credential(), refreshEntry);

		expect(requirementsForCredential).toHaveBeenCalledWith('kid-1');
	});
});

function instance(overrides: Partial<Instance> = {}): Instance {
	return { credentialId: 1, instanceId: 0, sigCount: 0, ...overrides };
}

function credential({
	instances = [instance()],
	status,
	validFrom,
	validUntil,
	signed,
}: {
	instances?: Instance[];
	status?: TokenStatus;
	validFrom?: Date;
	validUntil?: Date;
	signed?: Date;
} = {}): ExtendedVcEntity {
	return {
		kid: 'kid-1',
		instances,
		status,
		parsedCredential: { validityInfo: { validFrom, validUntil, signed } },
	} as unknown as ExtendedVcEntity;
}
