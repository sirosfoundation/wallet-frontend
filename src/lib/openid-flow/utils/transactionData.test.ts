import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
	decodeTransactionData,
	describeTransactionData,
	transactionDataForQuery,
	transactionDataResponseParams,
	UnsupportedTransactionDataError,
} from './transactionData';

const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** The expected hash, computed independently: SHA-256 over the entry string as received. */
const hashOf = (raw: string) => createHash('sha256').update(raw, 'utf8').digest('base64url');

const PAYMENT = encode({ type: 'payment', credential_ids: ['pid'], amount: '10 EUR', payee: 'Shop' });
const LOGIN = encode({ type: 'login', credential_ids: ['email'], transaction_data_hashes_alg: ['sha-256'] });

describe('transaction data', () => {
	it('decodes an entry and refuses anything that is not a typed JSON object', () => {
		expect(decodeTransactionData(PAYMENT)).toMatchObject({ type: 'payment', amount: '10 EUR' });
		expect(() => decodeTransactionData('not-json')).toThrow(UnsupportedTransactionDataError);
		expect(() => decodeTransactionData(encode({ amount: 1 }))).toThrow(/no type/);
		expect(() => decodeTransactionData(encode([1]))).toThrow(/no type/);
	});

	it('describes the entries for the consent popup without the protocol fields', () => {
		expect(describeTransactionData([PAYMENT])).toEqual([{
			type: 'payment',
			description: 'amount: 10 EUR, payee: Shop',
			data: { heading: 'payment', text: 'amount: 10 EUR, payee: Shop' },
		}]);
	});

	it('picks the entries that name a credential query', () => {
		expect(transactionDataForQuery([PAYMENT, LOGIN], 'pid')).toEqual([PAYMENT]);
		expect(transactionDataForQuery([PAYMENT, LOGIN], 'email')).toEqual([LOGIN]);
		expect(transactionDataForQuery([PAYMENT, LOGIN], 'mdl')).toEqual([]);
	});

	it('hashes each entry string as received, naming the algorithm only when the request did', async () => {
		await expect(transactionDataResponseParams([PAYMENT])).resolves.toEqual({
			transaction_data_hashes: [hashOf(PAYMENT)],
		});
		await expect(transactionDataResponseParams([PAYMENT, LOGIN])).resolves.toEqual({
			transaction_data_hashes: [hashOf(PAYMENT), hashOf(LOGIN)],
			transaction_data_hashes_alg: 'sha-256',
		});
	});

	it('refuses an entry that does not allow SHA-256', async () => {
		const sha512Only = encode({ type: 'x', credential_ids: ['pid'], transaction_data_hashes_alg: ['sha-512'] });
		await expect(transactionDataResponseParams([sha512Only])).rejects.toMatchObject({ code: 'UNSUPPORTED_TRANSACTION_DATA' });
	});
});