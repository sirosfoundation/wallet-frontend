import { DataItem, parse } from '@auth0/mdl';
import {
	cborDecode,
	cborEncode,
	getCborEncodeDecodeOptions,
	setCborEncodeDecodeOptions,
} from '@auth0/mdl/lib/cbor';
import { base64url } from 'jose';
import { useCallback, useContext, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { VerifiableCredentialFormat } from 'wallet-common';
import SessionContext from '@/context/SessionContext';
import { toBase64 } from '@/lib/utils';
import { logger } from '@/logger';
import { WalletStateUtils } from '@/services/WalletStateUtils';
import type { IMdocAppCommunication } from '../interfaces/IMdocAppCommunication';
import { generateRandomIdentifier } from '../utils/generateRandomIdentifier';
import {
	decryptMessage,
	deriveSharedSecret,
	encryptUint8Array,
	getDeviceEngagement,
	getKey,
	getSessionTranscriptBytes,
	hexToUint8Array,
	uint8ArrayToBase64Url,
	uint8ArraytoHexString,
} from '../utils/mdocProtocol';

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline: pre-existing debt. should be fixed
export function useMdocAppCommunication(): IMdocAppCommunication {
	const ephemeralKeyRef = useRef<CryptoKeyPair | null>(null);
	const uuid = uuidv4();
	// biome-ignore lint/suspicious/noExplicitAny: baseline: pre-existing debt. should be fixed
	const deviceEngagementBytesRef = useRef<any>(null);
	// biome-ignore lint/suspicious/noExplicitAny: baseline: pre-existing debt. should be fixed
	const credentialRef = useRef<any>(null);
	const sessionDataEncodedRef = useRef<Buffer | null>(null);
	// biome-ignore lint/suspicious/noExplicitAny: baseline: pre-existing debt. should be fixed
	const fieldsPEXRef = useRef<any[]>([]);
	const sessionTranscriptBytesRef = useRef<Buffer | null>(null);
	const skDeviceRef = useRef<CryptoKey>(null);
	const assumedChunkSize = 512;

	const { keystore, api } = useContext(SessionContext);
	const { updatePrivateData } = api;
	const { addPresentations, generateDeviceResponseWithProximity } = keystore;

	const storeVerifiablePresentation = useCallback(
		async (
			presentation: string,
			// biome-ignore lint/suspicious/noExplicitAny: baseline: pre-existing debt. should be fixed
			_presentationSubmission: any,
			usedCredentialId: number,
			audience: string,
		) => {
			try {
				const transactionId = WalletStateUtils.getRandomUint32();
				const [, newPrivateData, keystoreCommit] = await addPresentations(
					[presentation].map((vpData, _index) => {
						logger.debug('Presentation: ');

						return {
							transactionId: transactionId,
							data: vpData,
							usedCredentialIds: [usedCredentialId],
							audience: audience,
						};
					}),
				);
				await updatePrivateData(newPrivateData);
				await keystoreCommit();
				logger.debug('Presentations added');
				// biome-ignore lint/complexity/noUselessCatchBinding: baseline: pre-existing debt. should be fixed
				// biome-ignore lint/correctness/noUnusedVariables: baseline: pre-existing debt. should be fixed
			} catch (e) {
				logger.debug('Failed to reach server: Presentation history not stored');
			}
		},
		[updatePrivateData, addPresentations],
	);

	const generateEngagementQR = useCallback(
		// biome-ignore lint/suspicious/noExplicitAny: baseline: pre-existing debt. should be fixed
		async (vcEntity: any) => {
			const keyPair = await crypto.subtle.generateKey(
				{
					name: 'ECDH',
					namedCurve: 'P-256', // the named curve for P-256
				},
				true, // whether the key is extractable (e.g., can be exported)
				['deriveKey', 'deriveBits'], // can be used for signing and verification
			);
			ephemeralKeyRef.current = keyPair;

			const publicKeyJWK = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

			// const uuid =  '00179c7a-eec6-4f88-8646-045fda9ac4d8'

			const deviceEngagement = getDeviceEngagement(uuid, publicKeyJWK);

			const options = getCborEncodeDecodeOptions();
			options.variableMapSize = true;
			setCborEncodeDecodeOptions(options);
			const cbor = cborEncode(deviceEngagement);

			deviceEngagementBytesRef.current = DataItem.fromData(deviceEngagement);
			credentialRef.current = vcEntity;

			return `mdoc:${uint8ArrayToBase64Url(cbor)}`;
		},
		[uuid],
	);

	const startClient = useCallback(async (): Promise<boolean> => {
		/* @ts-expect-error */
		if (window.nativeWrapper) {
			/* @ts-expect-error */
			await nativeWrapper.bluetoothTerminate(); // Terminate any pending ble connections
			try {
				/* @ts-expect-error */
				const client = await window.nativeWrapper.bluetoothCreateClient(uuid);
				return client;
			} catch (e) {
				logger.debug(e);
				/* @ts-expect-error */
				logger.debug(await nativeWrapper.bluetoothStatus());
				logger.debug('Could not initialize BLE client');
				return false;
			}
		}
		return false;
	}, [uuid]);

	// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline: pre-existing debt. should be fixed
	const getMdocRequest = useCallback(async (): Promise<string[]> => {
		// biome-ignore lint/suspicious/noEvolvingTypes: baseline: pre-existing debt. should be fixed
		let aggregatedData = [];
		/* @ts-expect-error */
		if (window.nativeWrapper) {
			logger.debug('Created BLE client');
			try {
				let dataReceived = [1];
				while (dataReceived[0] === 1) {
					/* @ts-expect-error */
					// biome-ignore lint/performance/noAwaitInLoops: baseline: pre-existing debt. should be fixed
					dataReceived = JSON.parse(await window.nativeWrapper.bluetoothReceiveFromServer());
					// this.assumedChunkSize = Math.max(this.assumedChunkSize, dataReceived.length);
					aggregatedData = [...aggregatedData, ...dataReceived.slice(1)];
				}
			} catch (e) {
				logger.debug('Error receiving');
				logger.debug(e);
			}
		}
		logger.debug('Assumed chunk size: ', assumedChunkSize);
		const sessionMessage = uint8ArraytoHexString(new Uint8Array(aggregatedData));
		const decoded = cborDecode(hexToUint8Array(sessionMessage));
		const readerKey = decoded.get('eReaderKey');
		const verifierData = decoded.get('data');
		const coseKey = cborDecode(new Uint8Array(readerKey.buffer));
		const verifierJWK = {
			kty: 'EC',
			alg: 'ECDH',
			crv: 'P-256',
			x: uint8ArrayToBase64Url(coseKey.get(-2)),
			y: uint8ArrayToBase64Url(coseKey.get(-3)),
		};
		const verifierPublicKey = await crypto.subtle.importKey(
			'jwk',
			verifierJWK,
			{ name: 'ECDH', namedCurve: 'P-256' },
			true,
			[],
		);
		sessionTranscriptBytesRef.current = getSessionTranscriptBytes(
			deviceEngagementBytesRef.current, // DeviceEngagementBytes
			decoded.get('eReaderKey'), // EReaderKeyBytes
		);
		const zab = await deriveSharedSecret(ephemeralKeyRef.current.privateKey, verifierPublicKey);
		const salt = await crypto.subtle.digest('SHA-256', sessionTranscriptBytesRef.current);
		skDeviceRef.current = await getKey(zab, salt, 'SKDevice');
		const skReader = await getKey(zab, salt, 'SKReader');
		const iv = new Uint8Array([
			0x00,
			0x00,
			0x00,
			0x00,
			0x00,
			0x00,
			0x00,
			0x00, // identifier
			0x00,
			0x00,
			0x00,
			0x01, // message counter
		]);

		// biome-ignore lint/suspicious/noEvolvingTypes: baseline: pre-existing debt. should be fixed
		// biome-ignore lint/suspicious/noImplicitAnyLet: baseline: pre-existing debt. should be fixed
		let decryptedVerifierData;
		try {
			decryptedVerifierData = await decryptMessage(skReader, iv, verifierData, true);
		} catch (e) {
			logger.debug(e);
		}
		const fieldKeys: string[] = [];
		if (decryptedVerifierData) {
			const mdocRequestDecoded = cborDecode(decryptedVerifierData);
			const fields: Map<string, boolean> = mdocRequestDecoded
				.get('docRequests')[0]
				.get('itemsRequest')
				.data.get('nameSpaces')
				.get('eu.europa.ec.eudi.pid.1');

			// biome-ignore lint/suspicious/noEvolvingTypes: baseline: pre-existing debt. should be fixed
			const fieldsPEX = [];
			fields.forEach((value, key) => {
				fieldKeys.push(key);
				fieldsPEX.push({
					name: key,
					path: [`$['eu.europa.ec.eudi.pid.1']['${key}']`],
					intent_to_retain: value,
				});
			});
			fieldsPEXRef.current = fieldsPEX;
		}

		return fieldKeys;
	}, []);

	// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline: pre-existing debt. should be fixed
	const sendMdocResponse = useCallback(async (): Promise<void> => {
		const fullPEX = {
			id: 'MdocPID',
			title: 'MDOC PID',
			description: 'Placeholder description',
			input_descriptors: [
				{
					id: 'eu.europa.ec.eudi.pid.1',
					format: {
						mso_mdoc: {
							alg: ['ES256'],
						},
					},
					constraints: {
						limit_disclosure: 'required',
						fields: fieldsPEXRef.current,
					},
				},
			],
		};

		// const presentationDefinition = fullPEX;
		const credentialBytes = base64url.decode(credentialRef.current.data);
		const issuerSigned = cborDecode(credentialBytes);
		// const descriptor = presentationDefinition.input_descriptors.filter((desc) => desc.id === descriptor_id)[0];
		const descriptor = { id: 'eu.europa.ec.eudi.pid.1' };
		const m = {
			version: '1.0',
			documents: [
				new Map([
					['docType', descriptor.id],
					['issuerSigned', issuerSigned],
				]),
			],
			status: 0,
		};
		const options = getCborEncodeDecodeOptions();
		options.variableMapSize = true;
		setCborEncodeDecodeOptions(options);
		const encoded = cborEncode(m);
		const mdoc = parse(encoded);

		const { deviceResponseMDoc } = await generateDeviceResponseWithProximity(
			mdoc,
			fullPEX,
			sessionTranscriptBytesRef.current,
		);

		// encrypt mdoc response
		const ivEncryption = new Uint8Array([
			0x00,
			0x00,
			0x00,
			0x00,
			0x00,
			0x00,
			0x00,
			0x01, // identifier
			0x00,
			0x00,
			0x00,
			0x01, // message counter
		]);

		const { ciphertext } = await encryptUint8Array(
			skDeviceRef.current,
			deviceResponseMDoc.encode(),
			ivEncryption,
		);
		const encryptedMdoc = ciphertext;

		const sessionData = {
			data: new Uint8Array(encryptedMdoc),
			// data: encryptedMdoc,
			status: 20,
		};

		sessionDataEncodedRef.current = cborEncode(sessionData);

		if (sessionDataEncodedRef.current) {
			let toSendBytes = Array.from(sessionDataEncodedRef.current);
			while (toSendBytes.length > assumedChunkSize - 1) {
				const chunk = [1, ...toSendBytes.slice(0, assumedChunkSize - 1)];
				/* @ts-expect-error */
				// biome-ignore lint/performance/noAwaitInLoops: baseline: pre-existing debt. should be fixed
				await nativeWrapper.bluetoothSendToServer(JSON.stringify(chunk));
				toSendBytes = toSendBytes.slice(assumedChunkSize - 1);
			}
			/* @ts-expect-error */
			await nativeWrapper.bluetoothSendToServer(JSON.stringify([0, ...toSendBytes]));

			const presentationSubmission = {
				id: generateRandomIdentifier(8),
				definition_id: fullPEX.id,
				descriptor_map: [
					{
						id: fullPEX.input_descriptors[0].id,
						format: VerifiableCredentialFormat.MSO_MDOC,
						path: `$`,
					},
				],
			};

			const presentations =
				// biome-ignore lint/style/useTemplate: baseline: pre-existing debt. should be fixed
				'b64:' + toBase64(new TextEncoder().encode(base64url.encode(deviceResponseMDoc.encode())));
			await storeVerifiablePresentation(
				presentations,
				presentationSubmission,
				credentialRef.current.credentialId,
				'Proximity Mode',
			);
		}

		/* @ts-expect-error */
		await nativeWrapper.bluetoothTerminate();
	}, [generateDeviceResponseWithProximity, storeVerifiablePresentation]);

	const terminateSession = useCallback(async (): Promise<void> => {
		const sessionData = {
			data: new Uint8Array([]),
			status: 20,
		};

		const options = getCborEncodeDecodeOptions();
		options.variableMapSize = true;
		setCborEncodeDecodeOptions(options);
		const sessionDataEncoded = cborEncode(sessionData);
		/* @ts-expect-error */
		await nativeWrapper.bluetoothSendToServer(JSON.stringify([0, ...sessionDataEncoded]));

		/* @ts-expect-error */
		await nativeWrapper.bluetoothTerminate();
	}, []);

	return useMemo(
		() => ({
			generateEngagementQR,
			startClient,
			getMdocRequest,
			sendMdocResponse,
			terminateSession,
		}),
		[generateEngagementQR, startClient, getMdocRequest, sendMdocResponse, terminateSession],
	);
}
