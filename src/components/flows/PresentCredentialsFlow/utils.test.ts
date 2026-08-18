import { describe, it, expect } from 'vitest';
import { buildRequestedGroups, getValueByPath, resolveClaimLabel } from './utils';
import type {
	PresentCredentialSet,
	PresentCredentialsMatch,
	PresentCredentialsQuery,
	PresentCredentialsRequest,
} from './types';

// getValueByPath is typed `string[]`, but supports null ("any key") and numeric
// (array index) segments at runtime; cast through this helper in those cases.
const getPath = getValueByPath as (
	path: Array<string | number | null>,
	obj: Record<string, unknown>,
) => unknown;

describe('getValueByPath', () => {
	it('reads a simple nested value', () => {
		expect(getValueByPath(['a', 'b'], { a: { b: 1 } })).toBe(1);
	});

	it('returns undefined for a missing key', () => {
		expect(getValueByPath(['a', 'x'], { a: { b: 1 } })).toBeUndefined();
	});

	it('returns undefined for an empty path', () => {
		expect(getValueByPath([], { a: 1 })).toBeUndefined();
	});

	it('maps over all values for a null segment', () => {
		const obj = { a: { x: { c: 1 }, y: { c: 2 } } };
		expect(getPath(['a', null, 'c'], obj)).toEqual([1, 2]);
	});

	it('filters out children that lack the trailing path on a null segment', () => {
		const obj = { a: { x: { c: 1 }, y: { d: 2 } } };
		expect(getPath(['a', null, 'c'], obj)).toEqual([1]);
	});

	it('collapses an empty-object result to undefined', () => {
		expect(getValueByPath(['a'], { a: {} })).toBeUndefined();
	});

	it('preserves falsy primitive values', () => {
		expect(getValueByPath(['a'], { a: 0 })).toBe(0);
		expect(getValueByPath(['a'], { a: false })).toBe(false);
		expect(getValueByPath(['a'], { a: '' })).toBe('');
	});

	it('returns undefined when a mid-path value is not an object', () => {
		expect(getValueByPath(['a', 'b'], { a: 5 })).toBeUndefined();
	});

	it('supports numeric (array index) segments', () => {
		expect(getPath(['a', 1], { a: ['x', 'y'] })).toBe('y');
	});
});

describe('resolveClaimLabel', () => {
	const claims = [
		{
			path: ['age_equal_or_over', '18'],
			display: [
				{ locale: 'en-US', label: 'Age over 18' },
				{ locale: 'sv-SE', label: 'Ålder över 18' },
			],
		},
		{
			path: ['family_name'],
			display: [{ locale: 'en-US', label: 'Last name' }],
		},
		{
			path: ['no_display'],
		},
	];

	it('returns the label for the first matching preferred language', () => {
		expect(
			resolveClaimLabel(claims, { path: ['age_equal_or_over', '18'] }, ['sv-SE', 'en-US']),
		).toBe('Ålder över 18');
	});

	it('falls back to the first display when no preferred locale matches', () => {
		expect(
			resolveClaimLabel(claims, { path: ['family_name'] }, ['fr-FR']),
		).toBe('Last name');
	});

	it('falls back to field.name when the claim has no display', () => {
		expect(
			resolveClaimLabel(claims, { name: 'Custom', path: ['no_display'] }, ['en-US']),
		).toBe('Custom');
	});

	it('falls back to a joined path when no claim matches and no name is given', () => {
		expect(
			resolveClaimLabel(claims, { path: ['address', 'locality'] }, ['en-US']),
		).toBe('address › locality');
	});

	it('returns "Unknown" when nothing resolves', () => {
		expect(resolveClaimLabel(claims, {}, ['en-US'])).toBe('Unknown');
	});

	it('matches claim paths that contain null segments against the field path', () => {
		const withNull = [
			{ path: ['nationalities', null], display: [{ locale: 'en-US', label: 'Nationality' }] },
		];
		expect(
			resolveClaimLabel(withNull, { path: ['nationalities'] }, ['en-US']),
		).toBe('Nationality');
	});
});

describe('buildRequestedGroups', () => {
	const claim = (
		name: string,
		value: unknown,
	): PresentCredentialsMatch['fields'][number] => ({ name, value });

	const match = (
		batchId: number,
		fields: PresentCredentialsMatch['fields'] = [],
		name = `Credential ${batchId}`,
	): PresentCredentialsMatch => ({
		batchId,
		display: { name },
		fields,
	});

	const query = (
		id: string,
		...matches: PresentCredentialsMatch[]
	): PresentCredentialsQuery => ({ id, matches });

	const request = (
		queries: PresentCredentialsQuery[],
		sets: PresentCredentialSet[],
	): PresentCredentialsRequest => ({
		verifier: { name: 'Acme Verifier', domain: 'acme.example' },
		queries,
		sets,
	});

	describe('a single credential set', () => {
		it('1 required set [[pid]], selection {} -> 1 group; shares {pid,b1}', () => {
			const req = request(
				[query('pid', match(1))],
				[{ required: true, options: [['pid']] }],
			);

			const { groups, result } = buildRequestedGroups(req, {});

			expect(groups.map((g) => g.id)).toEqual(['pid']);
			expect(result).toEqual([{ queryId: 'pid', batchId: 1 }]);
		});

		it('1 required AND set [[pid, ehic]], selection {} -> 2 groups; shares both', () => {
			const req = request(
				[query('pid', match(1)), query('ehic', match(2))],
				[{ required: true, options: [['pid', 'ehic']] }],
			);

			const { groups, result } = buildRequestedGroups(req, {});

			expect(groups.map((g) => g.id)).toEqual(['pid', 'ehic']);
			expect(result).toEqual([
				{ queryId: 'pid', batchId: 1 },
				{ queryId: 'ehic', batchId: 2 },
			]);
		});

		it('[[pid]] with 2 matches, selection {} -> group defaults to its first match', () => {
			const req = request(
				[query('pid', match(1), match(2))],
				[{ required: true, options: [['pid']] }],
			);

			const { groups } = buildRequestedGroups(req, {});

			expect(groups[0].selected?.batchId).toBe(1);
			expect(groups[0].alternatives.map((m) => m.batchId)).toEqual([2]);
			expect(groups[0].total).toBe(2);
		});
		it('[[pid]] requesting given_name + family_name → group carries the selected credential\'s claims', () => {
			const req = request(
				[
					query(
						'pid',
						match(1, [
							claim('given_name', 'Ada'),
							claim('family_name', 'Lovelace'),
						]),
					),
				],
				[{ required: true, options: [['pid']] }],
			);

			const { groups } = buildRequestedGroups(req, {});

			expect(groups[0].selected?.fields).toEqual([
				{ name: 'given_name', value: 'Ada' },
				{ name: 'family_name', value: 'Lovelace' },
			]);
		});	});

	describe('OR options (alternatives within one set)', () => {
		it('1 required OR set [[pid],[mdl]] both held, selection {} -> ONE group; shares ONE (#1)', () => {
			const req = request(
				[query('pid', match(1)), query('mdl', match(2))],
				[{ required: true, options: [['pid'], ['mdl']] }],
			);

			const { groups, result } = buildRequestedGroups(req, {});

			expect(groups.map((g) => g.id)).toEqual(['pid']);
			expect(result).toEqual([{ queryId: 'pid', batchId: 1 }]);
		});

		it('OR [[pid],[mdl]], only mdl has matches, selection {} -> picks satisfiable mdl; shares [mdl] (#1)', () => {
			const req = request(
				[query('pid'), query('mdl', match(2))],
				[{ required: true, options: [['pid'], ['mdl']] }],
			);

			const { groups, result } = buildRequestedGroups(req, {});

			expect(groups.map((g) => g.id)).toEqual(['mdl']);
			expect(result).toEqual([{ queryId: 'mdl', batchId: 2 }]);
		});
	});

	describe('a credential asked for by more than one set', () => {
		it('pid appears in two sets, selection {} -> deduped to 1 group; shares [pid] once (#2)', () => {
			const req = request(
				[query('pid', match(1))],
				[
					{ required: true, options: [['pid']] },
					{ required: true, options: [['pid']] },
				],
			);

			const { groups, result } = buildRequestedGroups(req, {});

			expect(groups.map((g) => g.id)).toEqual(['pid']);
			expect(result).toEqual([{ queryId: 'pid', batchId: 1 }]);
		});
	});

	describe('an unsatisfiable required set (#4)', () => {
		it('required [[pid]] with 0 matches, selection {} -> no crash', () => {
			const req = request(
				[query('pid')],
				[{ required: true, options: [['pid']] }],
			);

			expect(() => buildRequestedGroups(req, {})).not.toThrow();
		});

		it('required [[pid]] with 0 matches, selection {} -> shares nothing', () => {
			const req = request(
				[query('pid')],
				[{ required: true, options: [['pid']] }],
			);

			const { result } = buildRequestedGroups(req, {});

			expect(result).toEqual([]);
		});

		// Scenario G (UI half): the overview still needs to TELL the user the required
		// credential is missing, group marked unsatisfiable + a blocked Share button.
		// That contract isn't modelled yet, pending decision.
		// This should throw a error before we get here, in the resolve function,
		// so the ui can catch it and display a message. The overview should not be show, since it cant satisfy the request.
		it.todo('required [[pid]] with 0 matches -> group flagged unsatisfiable so Share can be blocked');
	});

	describe('an optional credential set (#3)', () => {
		// Scenario F, optional set `required: false` (pid): excludable; result omits
		// unless kept. The presentation is valid WITHOUT this set, so the user must be
		// able to opt out. The current signature has no opt-out input, this needs a
		// contract decision (extra `excludedSets` param vs. inferring intent from
		// `selection`) before it can be asserted without changing the API.
		it.todo('optional set required:false, user declined -> result omits it');
		it.todo('optional set required:false, user opted in -> result includes it');
	});

	describe('user selection (swapping the chosen credential)', () => {
		it('[[pid]] with 2 matches, selection {pid:b2} -> selects b2, alternatives exclude b2; shares {pid,b2}', () => {
			// Scenario I, passes today (React-state guard).
			const req = request(
				[query('pid', match(1), match(2))],
				[{ required: true, options: [['pid']] }],
			);

			const { groups, result } = buildRequestedGroups(req, { pid: 2 });

			expect(groups[0].selected?.batchId).toBe(2);
			expect(groups[0].alternatives.map((m) => m.batchId)).toEqual([1]);
			expect(result).toEqual([{ queryId: 'pid', batchId: 2 }]);
		});

		it('[[pid]] with 2 matches, selection {pid:999} (stale) -> falls back to matches[0]; shares {pid,b1}', () => {
			// Scenario J, passes today. batchId 999 is no longer in the wallet.
			const req = request(
				[query('pid', match(1), match(2))],
				[{ required: true, options: [['pid']] }],
			);

			const { groups, result } = buildRequestedGroups(req, { pid: 999 });

			expect(groups[0].selected?.batchId).toBe(1);
			expect(result).toEqual([{ queryId: 'pid', batchId: 1 }]);
		});
	});
});
