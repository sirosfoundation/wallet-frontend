import { describe, it, expect } from 'vitest';
import {
	extractTenantFromUserHandle,
	isDefaultTenant,
	isReservedTenantName,
	isValidTenantId,
	buildTenantRoutePath,
	DEFAULT_TENANT_ID,
	TENANT_PATH_PREFIX,
} from './tenant';

describe('tenant utilities', () => {
	describe('extractTenantFromUserHandle', () => {
		it('should extract tenant from userHandle with format "tenantId:userId"', () => {
			const userHandle = new TextEncoder().encode('acme-corp:550e8400-e29b-41d4-a716-446655440000');
			expect(extractTenantFromUserHandle(userHandle)).toBe('acme-corp');
		});

		it('should extract tenant from string userHandle', () => {
			expect(extractTenantFromUserHandle('acme-corp:550e8400-e29b-41d4-a716-446655440000')).toBe('acme-corp');
		});

		it('should extract "default" tenant from userHandle', () => {
			const userHandle = new TextEncoder().encode('default:550e8400-e29b-41d4-a716-446655440000');
			expect(extractTenantFromUserHandle(userHandle)).toBe('default');
		});

		it('should return undefined for legacy userHandle without tenant prefix', () => {
			// Legacy format: just the userId without tenant prefix
			const userHandle = new TextEncoder().encode('550e8400-e29b-41d4-a716-446655440000');
			expect(extractTenantFromUserHandle(userHandle)).toBeUndefined();
		});

		it('should return undefined for null/undefined userHandle', () => {
			expect(extractTenantFromUserHandle(null)).toBeUndefined();
			expect(extractTenantFromUserHandle(undefined)).toBeUndefined();
		});

		it('should return undefined for empty userHandle', () => {
			expect(extractTenantFromUserHandle('')).toBeUndefined();
			expect(extractTenantFromUserHandle(new Uint8Array())).toBeUndefined();
		});

		it('should handle ArrayBuffer input', () => {
			const str = 'acme-corp:user-id-123';
			const encoder = new TextEncoder();
			const arrayBuffer = encoder.encode(str).buffer;
			expect(extractTenantFromUserHandle(arrayBuffer)).toBe('acme-corp');
		});

		it('should handle userHandle with empty tenant (just colon)', () => {
			const userHandle = new TextEncoder().encode(':user-id');
			// Empty string before colon should return undefined
			expect(extractTenantFromUserHandle(userHandle)).toBeUndefined();
		});
	});

	// Note: buildLoginFinishPath, buildLoginBeginPath, and buildTenantApiPath were removed.
	// Both login and registration now use global endpoints with tenantId in request body.
	// Backend discovers tenant from userHandle (login) or tenantId parameter (registration).

	describe('isDefaultTenant', () => {
		it('should return false for undefined', () => {
			expect(isDefaultTenant(undefined)).toBe(false);
		});

		it('should return false for empty string', () => {
			expect(isDefaultTenant('')).toBe(false);
		});

		it('should return true for "default"', () => {
			expect(isDefaultTenant(DEFAULT_TENANT_ID)).toBe(true);
			expect(isDefaultTenant('default')).toBe(true);
		});

		it('should return false for non-default tenant', () => {
			expect(isDefaultTenant('acme-corp')).toBe(false);
			expect(isDefaultTenant('my-tenant')).toBe(false);
		});
	});

	describe('isReservedTenantName', () => {
		it('should return true for "id" (tenant path prefix)', () => {
			expect(isReservedTenantName('id')).toBe(true);
			expect(isReservedTenantName('ID')).toBe(true);
			expect(isReservedTenantName('Id')).toBe(true);
		});

		it('should return true for "default"', () => {
			expect(isReservedTenantName('default')).toBe(true);
			expect(isReservedTenantName('DEFAULT')).toBe(true);
		});

		it('should return false for regular tenant names', () => {
			expect(isReservedTenantName('acme-corp')).toBe(false);
			expect(isReservedTenantName('my-tenant')).toBe(false);
			expect(isReservedTenantName('settings')).toBe(false);
		});
	});

	describe('buildTenantRoutePath', () => {
		it('should return root path when tenantId is undefined or empty', () => {
			expect(buildTenantRoutePath(undefined)).toBe('/');
			expect(buildTenantRoutePath('')).toBe('/');
		});

		it('should return root subpath when tenantId is undefined', () => {
			expect(buildTenantRoutePath(undefined, 'settings')).toBe('/settings');
		});

		it('should use /id/ prefix for all tenants including default', () => {
			expect(buildTenantRoutePath(DEFAULT_TENANT_ID)).toBe(`/${TENANT_PATH_PREFIX}/default/`);
			expect(buildTenantRoutePath('acme-corp')).toBe(`/${TENANT_PATH_PREFIX}/acme-corp/`);
			expect(buildTenantRoutePath('my-tenant')).toBe('/id/my-tenant/');
		});

		it('should use /id/ prefix for tenants with subPath', () => {
			expect(buildTenantRoutePath(DEFAULT_TENANT_ID, 'login')).toBe('/id/default/login');
			expect(buildTenantRoutePath('acme-corp', 'settings')).toBe('/id/acme-corp/settings');
			expect(buildTenantRoutePath('acme-corp', '/login')).toBe('/id/acme-corp/login');
		});
	});

	describe('TENANT_PATH_PREFIX', () => {
		it('should be "id"', () => {
			expect(TENANT_PATH_PREFIX).toBe('id');
		});
	});

	describe('isValidTenantId', () => {
		it('should accept valid tenant IDs', () => {
			expect(isValidTenantId('acme')).toBe(true);
			expect(isValidTenantId('acme-corp')).toBe(true);
			expect(isValidTenantId('my-tenant-1')).toBe(true);
			expect(isValidTenantId('a1')).toBe(true);
			expect(isValidTenantId('default')).toBe(true);
		});

		it('should reject IDs starting with a digit', () => {
			expect(isValidTenantId('1acme')).toBe(false);
		});

		it('should reject IDs ending with a hyphen', () => {
			expect(isValidTenantId('acme-')).toBe(false);
		});

		it('should reject IDs with uppercase letters', () => {
			expect(isValidTenantId('Acme')).toBe(false);
			expect(isValidTenantId('ACME')).toBe(false);
		});

		it('should reject IDs with special characters', () => {
			expect(isValidTenantId('acme_corp')).toBe(false);
			expect(isValidTenantId('acme.corp')).toBe(false);
			expect(isValidTenantId('acme/corp')).toBe(false);
			expect(isValidTenantId('../etc/passwd')).toBe(false);
			expect(isValidTenantId('acme corp')).toBe(false);
		});

		it('should reject empty or undefined values', () => {
			expect(isValidTenantId('')).toBe(false);
			expect(isValidTenantId(undefined)).toBe(false);
		});

		it('should reject a single character (too short for pattern)', () => {
			// Pattern requires start-char + at least one more char + end-char
			expect(isValidTenantId('a')).toBe(false);
		});
	});
});
