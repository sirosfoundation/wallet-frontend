import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { jsonToLog, logger } from '@/logger';
import { OIDFlowError } from '@/lib/openid-flow/errors';
import { OIDFlowCallbackURL, OIDFlowProgressEvent } from '@/lib/openid-flow/types/OIDFlowTypes';
import useErrorDialog from '@/hooks/useErrorDialog';
import useOID4VCIFlow from '@/hooks/useOID4VCIFlow';
import OpenID4VPContext from '@/context/OpenID4VPContext';
import useOID4VPFlow from '@/hooks/useOID4VPFlow';
import { useTxCodeInput } from '@/context/TxCodeInputContext';
import { TxCodeInputPopup } from '@/components/Popups/TxCodeInputPopup';
import Spinner from '@/components/Shared/Spinner';
import { useOIDFlowTransport } from '@/context/OIDFlowTransportContext';
import { useTenant } from '@/context/TenantContext';
import { parseOIDFlowCallbackUrl } from '@/lib/openid-flow/utils/oidFlowCallbackUrl';
import IssuanceWarningPopup from '@/components/Popups/IssuanceWarningPopup';
import { DCAPISession } from '@/lib/openid-flow/platforms/dc-api';
import { ConformantCredentials, PresentCredentialsFlow, usePresentCredentialsFlow } from '@/components/flows/PresentCredentialsFlow';
import { DcqlQuery } from 'dcql';
import { OID4VPVerifierInfo } from '@/lib/openid-flow/types/OID4VPTypes';
import { MdocProverService } from '@/utils';
import { encode, decode, Tag } from "cbor-x";
import { cborEncode, cborDecode, DataItem } from "@auth0/mdl/lib/cbor";
import { COSEKeyToJWK } from "cose-kit";
import * as jose from "jose";
import { base64url } from 'jose';
import SessionContext from "@/context/SessionContext";
import { useIndexedDb } from "../../hooks/useIndexedDb";
import { 
    generateDeviceSignature, 
    signMdocWithPlaceholder,
    buildCombinedDeviceResponse,
    DEFAULT_PID_ZKP_CONFIG 
} from '@/utils/MdocZkpService';
type OpenIDFlowCallbackProps = {
	callbackUrl: OIDFlowCallbackURL;
}

type OpenIDFlowCallbackHandler = React.FC<OpenIDFlowCallbackProps>;

/**
 * OpenIDFlowCallback - Transient page that processes OID4VCI/OID4VP callback URLs.
 *
 * Route: /cb/* (wrapped in <PrivateRoute>
 *
 * Renders a spinner while the flow runs, then navigates home on completion or error.
 * The effect fires once when transportReady becomes true (guarded by flowIsActive ref
 * to prevent double-invocation in StrictMode).
 *
 * Auth & sync:
 * - Authentication is enforced by PrivateRoute (see App.jsx) — unauthenticated users
 *   are redirected to login before this component mounts.
 * - Session sync is handled by UriHandlerProvider (see AppProvider.tsx), which wraps
 *   this component. The sync completes before transportReady settles in practice,
 *   but there is no explicit sync gate here. If sync timing becomes an issue,
 *   extract synced state from UriHandlerProvider into a shared context.
 */
const OpenIDFlowCallback: React.FC = () => {
	const { transportReady } = useOIDFlowTransport();
	/**
	 * Parse the callback URL on initial load to determine the flow type and relevant parameters.
	 */
	const callbackUrl: OIDFlowCallbackURL = useMemo(() => {
		const url = new URL(window.location.href);

		return parseOIDFlowCallbackUrl(url);
	}, []);

	if (!transportReady) return <Spinner />;

	return <OpenIDFlowRouter callbackUrl={callbackUrl} />;
};

/**
 * Based on the callback url, route to the appropriate flow handler component.
 * The handler components are responsible for executing the protocol flow,
 * handling errors, and navigating home on completion.
 */
const OpenIDFlowRouter: OpenIDFlowCallbackHandler = ({ callbackUrl }) => {
	const { buildPath } = useTenant();

	const resolved = useMemo(() => {
		switch (callbackUrl.protocol) {
			case 'oid4vci':
				return { handler: OpenID4VCIFlow };
			case 'oid4vp':
				return { handler: OpenID4VPFlow };
			case 'unknown':
				return { handler: OpenIDUnknownFlow };
			default:
				return null
		}
	}, [callbackUrl]);

	if (resolved && 'handler' in resolved) {
		const Handler = resolved.handler;
		return <Handler callbackUrl={callbackUrl} />;
	}

	// If no handler found, we assume the user isn't meant to be here,
	// and redirect to home.
	return <Navigate to={buildPath()} />;
}

/**
 * OpenID4VCIFlow - Handles OID4VCI credential offer and authorization code callbacks.
 */
const OpenID4VCIFlow: OpenIDFlowCallbackHandler = ({ callbackUrl }) => {
	const { displayError } = useErrorDialog();
	const { t } = useTranslation();
	const {
		requestTxCode,
		state: txCodeState,
		handleSubmit: handleTxCodeSubmit,
		handleCancel: handleTxCodeCancel,
	} = useTxCodeInput();
	const navigateHome = useNavigateHome();
	const [warningState, setWarningState] = useState<{ isOpen: boolean; warnings: Array<{ code: string }> }>({ isOpen: false, warnings: [] });
	const warningResolverRef = useRef<((proceed: boolean) => void) | null>(null);
	const flowIsActive = useRef(false);

	const handleError = useCallback(
		(err: Error) => {
			logger.error('Error in OID4VCI flow:', err);
			displayError({
				title: t('openIdCallback.vciFlowError.title'),
				description: t('openIdCallback.vciFlowError.description'),
				onClose: () => navigateHome(),
			});
		},
		[displayError, navigateHome, t],
	);

	const handleProgress = useCallback((event: OIDFlowProgressEvent) => {
		logger.debug('OID4VCI flow progress:', event);
	}, []);

	const handleIssuanceWarnings = useCallback(
		async (warnings: Array<{ code: string }>) => {
			logger.warn('Credential issuance warnings:', jsonToLog(warnings));

			return new Promise<boolean>((resolve) => {
				warningResolverRef.current = resolve;
				setWarningState({
					isOpen: true,
					warnings,
				});
			});
		},
		[],
	);

	const {
		handleCredentialOffer,
		requestWithPreAuthorization,
		handleAuthorizationResponse,
		handleReceivedCredentials,
	} = useOID4VCIFlow({
		onError: handleError,
		onProgress: handleProgress,
		onIssuanceWarnings: handleIssuanceWarnings,
	});

	const processCredentialOffer = async (url: URL) => {
		const offer = await handleCredentialOffer(url);
		logger.debug('Received credential offer:', offer);

		cleanupUrl();

		if (offer.success && offer.credentials?.length) {
			await handleReceivedCredentials(
				offer.credentials,
				offer.credentialIssuerIdentifier,
				offer.selectedCredentialConfigurationId,
			);
		}

		if (offer.authorizationUrl) {
			window.location.href = offer.authorizationUrl;
			return;
		}

		if (!offer.preAuthorizedCode) return;

		let txCodeInput: string | undefined;
		if (offer.txCode) {
			try {
				txCodeInput = await requestTxCode({
					description: offer.txCode.description ?? undefined,
					length: offer.txCode.length ?? undefined,
					inputMode:
						offer.txCode.inputMode === 'numeric' ? 'numeric' : 'text',
				});
			} catch {
				logger.info('User cancelled transaction code input');
				return;
			}
		}

		const preAuthResult = await requestWithPreAuthorization(
			offer.preAuthorizedCode,
			txCodeInput,
		);

		if (preAuthResult.success && preAuthResult.credentials?.length) {
			await handleReceivedCredentials(
				preAuthResult.credentials,
				preAuthResult.credentialIssuerIdentifier,
				preAuthResult.selectedCredentialConfigurationId,
			);
		}
	};

	const processAuthorizationCode = async (url: URL) => {
		const code = url.searchParams.get('code');
		const state = url.searchParams.get('state');

		cleanupUrl();

		const result = await handleAuthorizationResponse(code, state);

		if (result.success && result.credentials?.length) {
			await handleReceivedCredentials(
				result.credentials,
				result.credentialIssuerIdentifier,
				result.selectedCredentialConfigurationId,
			);
		}
	};

	const handleWarningConfirm = useCallback(() => {
		warningResolverRef.current?.(true);
		warningResolverRef.current = null;
		setWarningState({ isOpen: false, warnings: [] });
	}, []);

	const handleWarningCancel = useCallback(() => {
		warningResolverRef.current?.(false);
		warningResolverRef.current = null;
		setWarningState({ isOpen: false, warnings: [] });
	}, []);

	useEffect(() => {
		if (flowIsActive.current) return;
		flowIsActive.current = true;

		if (callbackUrl.protocol !== 'oid4vci') return;

		(async () => {
			try {
				switch (callbackUrl.type) {
					case 'credential_offer':
						await processCredentialOffer(callbackUrl.url);
						break;
					case 'authorization_code':
						await processAuthorizationCode(callbackUrl.url);
						break;
					default:
						throw new OIDFlowError({
							code: 'UNSUPPORTED_CALLBACK',
							message: 'Unsupported callback type',
						});
				}

				navigateHome();
			} catch (error) {
				logger.error('Error in OID4VCI flow:', error);
				displayError({
					title: t('openIdCallback.vciFlowError.title'),
					description: t('openIdCallback.vciFlowError.description'),
					onClose: () => navigateHome(),
				});
			}
		})();
		// One-shot flow: runs once on mount, guarded by flowIsActive ref.
		// All deps are stable at mount time. Re-running would restart the protocol flow.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<>
			<Spinner />
			<IssuanceWarningPopup
				isOpen={warningState.isOpen}
				warnings={warningState.warnings}
				onConfirm={handleWarningConfirm}
				onCancel={handleWarningCancel}
			/>
			<TxCodeInputPopup
				isOpen={txCodeState.isOpen}
				txCodeConfig={txCodeState.config}
				onSubmit={handleTxCodeSubmit}
				onCancel={() => {
					handleTxCodeCancel();
					navigateHome();
				}}
			/>
		</>
	);
};

function minimalMapHeader(count) {
	if (count < 24) return new Uint8Array([0xa0 | count]);
	if (count < 256) return new Uint8Array([0xb8, count]);
	return new Uint8Array([0xb9, (count >> 8) & 0xff, count & 0xff]);
}

function minimalArrayHeader(count) {
	if (count < 24) return new Uint8Array([0x80 | count]);
	if (count < 256) return new Uint8Array([0x98, count]);
	return new Uint8Array([0x99, (count >> 8) & 0xff, count & 0xff]);
}

function concatBytes(arrays) {
	const total = arrays.reduce((sum, a) => sum + a.length, 0);
	const result = new Uint8Array(total);
	let offset = 0;
	for (const a of arrays) {
		result.set(a, offset);
		offset += a.length;
	}
	return result;
}

function uint8ToBase64(uint8) {
	let binary = '';
	const len = uint8.byteLength;
	for (let i = 0; i < len; i++) {
		binary += String.fromCharCode(uint8[i]);
	}
	const standard = btoa(binary);
	return standard
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}
function minimalBstrHeader(count) {
	if (count < 24) return new Uint8Array([0x40 | count]);
	if (count < 256) return new Uint8Array([0x58, count]);
	if (count < 65536) return new Uint8Array([0x59, (count >> 8) & 0xff, count & 0xff]);
	return new Uint8Array([0x5a, (count >> 24) & 0xff, (count >> 16) & 0xff, (count >> 8) & 0xff, count & 0xff]);
}

function manualBstr(contentBytes) {
	return concatBytes([minimalBstrHeader(contentBytes.length), contentBytes]);
}


function ensureArrayBuffer(buf: any): Uint8Array<ArrayBuffer> {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    // Force copy into a fresh ArrayBuffer
    const copy = new Uint8Array(u8.length);
    copy.set(u8);
    return copy as Uint8Array<ArrayBuffer>;
}

function manualMap(pairs) {
    const header = minimalMapHeader(pairs.length);
    const parts = [header];
    for (const [key, valueBytes] of pairs) {
        parts.push(ensureArrayBuffer(cborEncode(key)));
        parts.push(ensureArrayBuffer(valueBytes));
    }
    return concatBytes(parts);
}

function manualArray(itemsBytes) {
	const header = minimalArrayHeader(itemsBytes.length);
	return concatBytes([header, ...itemsBytes]);
}

// Tag wrapper: tag numbers 0-23 fit in a single header byte (0xc0 | tag).
// Tag 24 needs one extra byte (0xd8, 24) since 24 doesn't fit in the initial byte alone.
function manualTag(tagNumber, contentBytes) {
	if (tagNumber < 24) {
		return concatBytes([new Uint8Array([0xc0 | tagNumber]), contentBytes]);
	}
	if (tagNumber < 256) {
		return concatBytes([new Uint8Array([0xd8, tagNumber]), contentBytes]);
	}
	throw new Error("tag number too large for this helper");
}
/**
 * OpenID4VPFlow - Handles OID4VP presentation request callbacks.
 */
const OpenID4VPFlow: OpenIDFlowCallbackHandler = ({ callbackUrl }) => {
	const { displayError } = useErrorDialog();
	const { t } = useTranslation();
	const { showTransactionDataConsentPopup } = useContext(OpenID4VPContext);
	const { keystore, api } = useContext(SessionContext);
	const [ppidHex, setPpidHex] = useState(null);

	const navigateHome = useNavigateHome();
	const flowIsActive = useRef(false);
	const {
		view,
		displayRequestOverviewScreen,
		displaySendingScreen,
		displayCompletedScreen,
		displayErrorScreen,
	} = usePresentCredentialsFlow();

	const proofCacheDb = useIndexedDb(
		'zkProofCache',
		1,
		(db) => {
			if (!db.objectStoreNames.contains('proofs')) {
				db.createObjectStore('proofs');
			}
		}
	);
	/**
	 * Handle errors thrown during OID4VP flows.
	 */
	const handleOID4VPError = useCallback((err: Error) => {
		logger.error("Error in OID4VP flow:", err);
		if (!(err instanceof OIDFlowError)) {
			displayError({
				title: t('openIdCallback.vpFlowError.title'),
				description: t('openIdCallback.vpFlowError.description'),
			});
			return;
		}

		const code = err.code.toUpperCase();
		const titleKey = `openIdCallback.errorCodes.${code}.title`;
		const descKey = `openIdCallback.errorCodes.${code}.description`;
		const translatedTitle = t(titleKey, { defaultValue: '' });
		const translatedDesc = t(descKey, { defaultValue: '' });

		displayErrorScreen({
			title: translatedTitle || t('openIdCallback.vpFlowError.title'),
			description: translatedDesc || t('openIdCallback.vpFlowError.description'),
			err,
			onClose: () => {
				navigateHome();
			},
		});
	}, [displayError, displayErrorScreen, navigateHome, t]);

	/**
	 * Handle OID4VP flow progress events.
	 * For now, just debug logging.
	 */
	const handleOID4VPProgress = useCallback((event: OIDFlowProgressEvent) => {
		logger.debug("OID4VP flow progress:", event);
	}, []);

	/**
	 * Handle credential selection during OID4VP flows by showing the configured UI and returning the user's selection.
	 */
	const handleOID4VPCredentialSelection = useCallback(async (
		verifierInfo: OID4VPVerifierInfo,
		dcqlQuery: DcqlQuery.Input,
		conformantCredentialsMap: ConformantCredentials
	) => {
		logger.debug("Prompting for credential selection...", { conformantCredentialsMap, verifierInfo, dcqlQuery });

		const selection = await displayRequestOverviewScreen(
			verifierInfo,
			dcqlQuery,
			conformantCredentialsMap,
		);


		logger.debug("User selection:", selection);

		return new Map(selection.map(({ queryId, batchId }) => [queryId, batchId])	);
	}, [displayRequestOverviewScreen]);

	const {
		handleAuthorizationRequest,
		handleCredentialSelection,
		sendAuthorizationResponse,
		handleDCAPIRequest,
	} = useOID4VPFlow({
		onError: handleOID4VPError,
		onProgress: handleOID4VPProgress,
		onCredentialSelection: handleOID4VPCredentialSelection,
	});

	const processAuthorizationRequest = async (url: URL) => {
		const result = await handleAuthorizationRequest(url);

		cleanupUrl();

		if (!result?.success) {
			return;
		}

		logger.debug('Authorization request result:', result);

		if (result.transactionData?.length) {
			const consented = await showTransactionDataConsentPopup({
				title: 'Transaction Data',
				attestations: result.transactionData.map((td) => td.data),
			});

			if (!consented) return;
		}

		const credSelectResult = await handleCredentialSelection(
			result.verifierInfo,
			result.dcqlQuery,
			result.conformantCredentials,
		);

		if (!credSelectResult?.success) {
			if (credSelectResult?.error?.code === 'USER_CANCELLED') {
				navigateHome();
			}
			return;
		}

		displaySendingScreen();

		const sendResult = await sendAuthorizationResponse(
			credSelectResult.selectedCredentials,
		);
		logger.debug('Authorization response sent:', sendResult);

		if (sendResult.success) {
			await displayCompletedScreen({
				verifierName: result.verifierInfo.name,
			});
		}

		if ('redirectUri' in sendResult) {
			window.location.href = sendResult.redirectUri;
		}
	};
	function base64ToHex(str) {
		const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
		const bin = atob(b64);
		return Array.from(bin)
				.map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
				.join('');
	}


	function assembleFinalVP_V8(originalMdocHex, proofUint8, ppid, transcriptHex, Now) {
		const hexToBuf = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
		const mdocBytes = hexToBuf(originalMdocHex);
		const mdocDecoded = decode(mdocBytes);
		const doc = mdocDecoded.documents[0];
		const issuerSigned = doc.issuerSigned;
		const issuerAuth = issuerSigned.issuerAuth;
		const unprotectedHeaders = issuerAuth[1];
		const certs = unprotectedHeaders.get ? unprotectedHeaders.get(33) : unprotectedHeaders[33];
		const certDer = Array.isArray(certs) ? certs[0] : certs;
		const claim1 = manualMap([
			["elementIdentifier", cborEncode("age_over_18")],
			["elementValue", cborEncode(true)],
		]);
		const claim2 = manualMap([
			["elementIdentifier", cborEncode("pairwise_pseudonym")],
			["elementValue", cborEncode(ppid)],
		]);
		const claimsArray = manualArray([claim1, claim2]);
		const issuerSignedMap = manualMap([
			["eu.europa.ec.eudi.pid.1", claimsArray],
		]);
	
		const timestampTagged = manualTag(0, cborEncode(Now));
	
		const documentDataMap = manualMap([
			["zkSystemId", cborEncode("longfellow-libzk-v1_8_2_4307_2945_bb8e6a26d2700ddad968562d1c4aee83067772fee6f889748a0bc64f2c694ad5")],
			["docType", cborEncode("eu.europa.ec.eudi.pid.1")],
			["timestamp", timestampTagged],
			["issuerSigned", issuerSignedMap],
			["deviceSigned", manualMap([])],
			["msoX5chain", cborEncode(certDer)],
		]);

		const documentDataTagged = manualTag(24, manualBstr(documentDataMap));
		const zkDocMap = manualMap([
			["proof", cborEncode(proofUint8)],
			["documentData", documentDataTagged],
		]);
	
		const zkDocumentsArray = manualArray([zkDocMap]);
	
		const outerResponseBytes = manualMap([
			["version", cborEncode("1.1")],
			["status", cborEncode(0)],
			["zkDocuments", zkDocumentsArray],
		]);
	
		const handoverBytes = hexToBuf(transcriptHex);
		return {
			Transcript: uint8ToBase64(handoverBytes),
			ZKDeviceResponseCBOR: uint8ToBase64(outerResponseBytes),
			zkDocumentsArray: zkDocumentsArray
		};
	}

	let sharedProverWorker: Worker | null = null;

	function getProverWorker(): Worker {
		if (!sharedProverWorker) {
			sharedProverWorker = new Worker(
				new URL('@/utils/prover.worker.ts', import.meta.url),
				{ type: 'module' },
			);
		}
		return sharedProverWorker;
	}

	function generateProofInWorker(witness: {
		mdoc: string;
		transcript: string;
		now: string;
		pseudonymSeed: Uint8Array;
	}): Promise<{ proof: Uint8Array; ppid: Uint8Array; ppidHex: string; durationMs: number }> {
		const worker = getProverWorker();

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				worker.removeEventListener('message', onMessage);
				reject(new Error('proof generation timed out'));
			}, 500000);

			const onMessage = (e: MessageEvent) => {
				clearTimeout(timer);
				worker.removeEventListener('message', onMessage);
				if (e.data.type === 'PROOF_SUCCESS') resolve(e.data.payload);
				else reject(new Error(e.data.payload));
			};

			worker.addEventListener('message', onMessage);
			worker.postMessage({ type: 'GENERATE_PROOF', payload: witness });
		});
	}

	async function startBackgroundProofGeneration(
		credentialData: string,
		keystore: any,
		proofCacheDb: any,
		transcriptHex: string,
		now: string,
	): Promise<{ proof: Uint8Array; ppid: Uint8Array; ppidHex?: string } | null> {
		try {
			const originalMdocHex = base64ToHex(credentialData);
			// `now` is part of the key: the proof binds the timestamp, so a proof
			// generated under a different `now` is not reusable.
			const CACHE_KEY = `${originalMdocHex.slice(0, 32)}_${transcriptHex.slice(0, 16)}_${now}`;

			// 1. Cache hit → reuse the proof bytes directly
			try {
				const cached = await proofCacheDb.read(['proofs'], (tr: any) =>
					tr.objectStore('proofs').get(CACHE_KEY)
				);
				if (cached?.proof) {
					console.log("✅ Using cached proof:", cached.proof.length, "bytes");
					return { proof: cached.proof, ppid: cached.ppid, ppidHex: cached.ppidHex };
				}
			} catch (e) {
				console.log("No cached proof found:", e);
			}

			// 2. Sign the mdoc with the device key
			const rawSignatureHex = await generateDeviceSignature(
				keystore,
				originalMdocHex,
				transcriptHex,
				"eu.europa.ec.eudi.pid.1",
				decode,
			);
			const signedMdocHex = signMdocWithPlaceholder(originalMdocHex, rawSignatureHex);

			// 3. Pull pseudonym_seed out of the credential
			const mdocBytes = new Uint8Array(
				originalMdocHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16))
			);
			const mdoc = decode(mdocBytes);
			const nsItems = mdoc.documents[0].issuerSigned.nameSpaces;
			const ns = Object.keys(nsItems)[0];
			let pseudonymSeed = null;
			for (const item of nsItems[ns]) {
				const decoded = decode(item.value);
				if (decoded.elementIdentifier === 'pseudonym_seed') {
					pseudonymSeed = decoded.elementValue;
					break;
				}
			}

			// 4. Generate — in the worker, so the ~70s WASM call doesn't block the
			//    main thread and freeze the spinner.
			console.log("🚀 Proof generation started in worker");
			const proofResult = await generateProofInWorker({
				mdoc: signedMdocHex,
				transcript: transcriptHex,
				now,
				pseudonymSeed,
			});
			console.log(`✅ Proof generated in ${proofResult.durationMs?.toFixed?.(0) ?? '?'}ms`);

			// 5. Cache the proof bytes
			try {
				await proofCacheDb.write(['proofs'], (tr: any) =>
					tr.objectStore('proofs').put(
						{
							proof: proofResult.proof,
							ppid: proofResult.ppid,
							ppidHex: proofResult.ppidHex,
						},
						CACHE_KEY,
					)
				);
				console.log("✅ Proof cached:", proofResult.proof.length, "bytes");
			} catch (e) {
				console.warn("Failed to cache proof:", e);
			}

			return {
				proof: proofResult.proof,
				ppid: proofResult.ppid,
				ppidHex: proofResult.ppidHex,
			};
		} catch (e) {
			console.error("Background proof generation failed:", e);
			return null;
		}
	}
	const processDcApiRequest = async (url: URL, keystore: any, proofCacheDb: any) => {
		const session = new DCAPISession(url);
		await session.initialize();
		cleanupUrl();

		const result = await handleDCAPIRequest(
			session.request,
			session.selectedCredentialIDs,
			session.verifiedOrigin,
		);

		if (!result?.success) {
			throw new OIDFlowError(result.error);
		}

		// Background proof was kicked off by the 'start-background-proof' listener
		// as soon as credential matching completed — nothing to do here.

		const credSelectResult = await handleCredentialSelection(
			result.verifierInfo,
			result.dcqlQuery,
			result.conformantCredentials,
		);

		if (!credSelectResult?.success) {
			session.sendErrorAndClose('user_cancelled');
			return;
		}

		displaySendingScreen();

		const transcriptHex = "83f6f6846b6578616d706c652e6f7267781c68747470733a2f2f6578616d706c652e6f72672f726573706f6e736570313233343536373839306162636465667066656463626130393837363534333231";

		const now = "2026-09-03T20:41:47Z";

		// Proof is already generated (or nearly) — just await it
		const proofData = await backgroundProofRef.current;
		if (!proofData) {
			throw new OIDFlowError({
				code: 'PROOF_GENERATION_FAILED',
				message: 'Background proof generation failed or was never started',
			});
		}

		setPpidHex(proofData.ppidHex);

		const selectedCredential = credSelectResult.selectedCredentials[0];
		const originalMdocHex = base64ToHex(selectedCredential.credentialRaw);

		const finalVP = assembleFinalVP_V8(
			originalMdocHex,
			proofData.proof,
			proofData.ppid,
			transcriptHex,
			now,
		) as unknown as {
			Transcript: string;
			ZKDeviceResponseCBOR: string;
			zkDocumentsArray: Uint8Array;
		};

		const combined = buildCombinedDeviceResponse(finalVP.zkDocumentsArray);
		const credentialRaw = base64url.encode(combined);

		await displayCompletedScreen({
			verifierName: result.verifierInfo?.name ?? 'Verifier',
		});

		await session.sendResponse({
			[selectedCredential.credentialQueryId]: [credentialRaw],
		});
	};
	const backgroundProofRef = useRef<Promise<any> | null>(null);
	useEffect(() => {
		const handler = (e: Event) => {
			const { credentialData } = (e as CustomEvent).detail;
			console.log("🚀 Starting background proof generation");
			backgroundProofRef.current = startBackgroundProofGeneration(
				credentialData,
				keystore,
				proofCacheDb,
				"83f6f6846b6578616d706c652e6f7267781c68747470733a2f2f6578616d706c652e6f72672f726573706f6e736570313233343536373839306162636465667066656463626130393837363534333231",
				"2026-09-03T20:41:47Z",
			);
		};
		window.addEventListener('start-background-proof', handler);
		return () => window.removeEventListener('start-background-proof', handler);
	}, [keystore, proofCacheDb]);

	useEffect(() => {
		if (flowIsActive.current) return;
		flowIsActive.current = true;

		if (callbackUrl.protocol !== 'oid4vp') return;

		(async () => {
			try {
				switch (callbackUrl.type) {
					case 'presentation_request':
						await processAuthorizationRequest(callbackUrl.url);
						break;
					case 'dc_api_request':
						await processDcApiRequest(callbackUrl.url, keystore, proofCacheDb);
						break;
					default:
						throw new OIDFlowError({
							code: 'UNSUPPORTED_CALLBACK',
							message: 'Unsupported callback type',
						});
				}
			} catch (error) {
				handleOID4VPError(error);
			}
		})();
		// One-shot flow: runs once on mount, guarded by flowIsActive ref.
		// All deps are stable at mount time. Re-running would restart the protocol flow.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return <PresentCredentialsFlow view={view} />;
};

/**
 * OpenIDUnknownFlow - Handles unsupported or error callbacks by showing an error message.
 */
const OpenIDUnknownFlow: OpenIDFlowCallbackHandler = ({ callbackUrl }) => {
	const { displayError } = useErrorDialog();
	const { t } = useTranslation();
	const navigateHome = useNavigateHome();

	useEffect(
		() => {
			if (callbackUrl.type === 'authorization_error') {
				const error = callbackUrl.url.searchParams.get('error');
				const desc = callbackUrl.url.searchParams.get('error_description');

				logger.error('Authorization error in OpenID flow callback:', error, desc);
				displayError({
					title: error
						? `${t('openIdCallback.authorizationError.title')}: ${error}`
						: t('openIdCallback.authorizationError.title'),
					description: desc ?? '',
					onClose: () => navigateHome(),
				});
				return;
			}

			logger.error('Unsupported OpenID flow callback received:', callbackUrl.url.href);
			displayError({
				title: t('openIdCallback.unsupportedCallback.title'),
				description: t('openIdCallback.unsupportedCallback.description'),
				onClose: () => navigateHome(),
			});
		},
		// Only run once on mount. The callbackUrl is stable for the lifetime of this component, and re-running would cause duplicate error popups.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[]
	);

	return <></>;
}

const useNavigateHome = () => {
	const navigate = useNavigate();
	const { buildPath } = useTenant();

	return useCallback(() => {
		navigate(buildPath());
	}, [navigate, buildPath]);
};

function cleanupUrl() {
	window.history.replaceState({}, '', window.location.origin + window.location.pathname);
}

export default OpenIDFlowCallback;
