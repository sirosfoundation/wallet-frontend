import React, { useEffect, useMemo, useState, useCallback, useContext } from 'react';
import PopupLayout from './PopupLayout';
import { useTranslation, Trans } from 'react-i18next';
import CredentialImage from '../Credentials/CredentialImage';
import { logger } from '@/logger';
import CredentialInfo from '../Credentials/CredentialInfo';
import Button from '../Buttons/Button';
import useScreenType from '../../hooks/useScreenType';
import Slider from '../Shared/Slider';
import CredentialCardSkeleton from '../Skeletons/CredentialCardSkeleton';
import { CredentialInfoSkeleton } from '../Skeletons';
import { useCredentialName } from '@/hooks/useCredentialName';
import i18n from '@/i18n';
import { prettyDomain, truncateByWords } from '@/utils';
import { BookCheck, CheckCircle, Circle, IdCard, View, LoaderCircle } from 'lucide-react';
import SessionContext from "@/context/SessionContext";

import { MdocProverService } from '@/utils';

import { encode, decode, Tag } from "cbor-x";
import { Encoder } from "cbor-x";

import ZkWorker from '@/utils/prover.worker?worker';

import { WalletStateUtils } from "@/services/WalletStateUtils";

import { useClearStorages, useLocalStorage, useSessionStorage } from "../../hooks/useStorage";
import { useIndexedDb } from "../../hooks/useIndexedDb";

import { cborEncode, cborDecode, DataItem } from "@auth0/mdl/lib/cbor";
import { COSEKeyToJWK } from "cose-kit";
import * as jose from "jose";

const workerInstance = new ZkWorker();

const hexToBuf = h => new Uint8Array(h.match(/.{1,2}/g).map(b => parseInt(b, 16)));
const bufToHex = b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');

async function generate(keystore, mdocHex, transcriptHex) {
    try {
        // 1. Get device public key from MSO
        const mdocBytes = hexToBuf(mdocHex);
        const mdocDecoded = decode(mdocBytes);
        const doc = mdocDecoded.documents[0];
        const issuerSigned = doc.issuerSigned;
        const issuerAuth = issuerSigned.issuerAuth;
        const msoBinaryRaw = issuerAuth[2];
        const msoBinary = msoBinaryRaw instanceof Uint8Array ? msoBinaryRaw : new Uint8Array(msoBinaryRaw);
		const msoData = cborDecode(msoBinary);
		const deviceKeyInfo = msoData.data.get('deviceKeyInfo');
		const deviceKeyCose = deviceKeyInfo.get('deviceKey');
		const devicePublicKeyJwk = COSEKeyToJWK(deviceKeyCose);
        const kid = await jose.calculateJwkThumbprint(devicePublicKeyJwk, "sha256");
		const docTypeStr = msoData.data.get('docType');
        const calculatedState = keystore.getCalculatedWalletState();
        const foundKeypair = calculatedState.keypairs.find(k => k.kid === kid);
        if (!foundKeypair) throw new Error("Key pair not found for kid: " + kid);

        const d_b64 = foundKeypair.keypair.privateKey.d;
        const x_b64 = foundKeypair.keypair.publicKey.x;
        const y_b64 = foundKeypair.keypair.publicKey.y;
		const keyData = { kty: "EC", crv: "P-256", x: x_b64, y: y_b64, d: d_b64 };
		const privKey = await crypto.subtle.importKey("jwk", keyData, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
		
        const docTypeBytes = new TextEncoder().encode(docTypeStr);
        const docTypeLen = docTypeBytes.length;
        let docTypeHeader;
        if (docTypeLen < 24) docTypeHeader = new Uint8Array([0x60 | docTypeLen]);
        else if (docTypeLen < 256) docTypeHeader = new Uint8Array([0x78, docTypeLen]);
        else docTypeHeader = new Uint8Array([0x79, docTypeLen >> 8, docTypeLen & 0xff]);
        const docTypeCbor = new Uint8Array(docTypeHeader.length + docTypeBytes.length);
        docTypeCbor.set(docTypeHeader);
        docTypeCbor.set(docTypeBytes, docTypeHeader.length);

        const sig1_header = hexToBuf("846a5369676e61747572653143a1012640");
        const devAuth_label = hexToBuf("847444657669636541757468656e7469636174696f6e");
        const transcript = hexToBuf(transcriptHex);
        const dns = hexToBuf("d81841a0");

        const inner = new Uint8Array(devAuth_label.length + transcript.length + docTypeCbor.length + dns.length);
        inner.set(devAuth_label);
        inner.set(transcript, devAuth_label.length);
        inner.set(docTypeCbor, devAuth_label.length + transcript.length);
        inner.set(dns, devAuth_label.length + transcript.length + docTypeCbor.length);

        let payload;
        if (inner.length < 24) {
            payload = new Uint8Array(inner.length + 3);
            payload.set([0xd8, 0x18, inner.length]);
            payload.set(inner, 3);
        } else if (inner.length < 256) {
            payload = new Uint8Array(inner.length + 4);
            payload.set([0xd8, 0x18, 0x58, inner.length]);
            payload.set(inner, 4);
        } else {
            payload = new Uint8Array(inner.length + 5);
            payload.set([0xd8, 0x18, 0x59, inner.length >> 8, inner.length & 0xff]);
            payload.set(inner, 5);
        }

        let tbs_bytes;
        if (payload.length < 256) {
            tbs_bytes = new Uint8Array(sig1_header.length + 2 + payload.length);
            tbs_bytes.set(sig1_header);
            tbs_bytes.set([0x58, payload.length], sig1_header.length);
            tbs_bytes.set(payload, sig1_header.length + 2);
        } else {
            tbs_bytes = new Uint8Array(sig1_header.length + 3 + payload.length);
            tbs_bytes.set(sig1_header);
            tbs_bytes.set([0x59, payload.length >> 8, payload.length & 0xff], sig1_header.length);
            tbs_bytes.set(payload, sig1_header.length + 3);
        }

        const signature = await crypto.subtle.sign(
            { name: "ECDSA", hash: { name: "SHA-256" } },
            privKey,
            tbs_bytes
        );

        return bufToHex(signature);

    } catch (e) {
        console.error("Error in generate():", e);
        throw e;
    }
}

const SelectableCredentialSlideCard = ({
	vcEntity,
	isActive,
	isSelected,
	onClick,
	borderColor
}) => {
	const { t } = useTranslation();
	const [imageLoaded, setImageLoaded] = useState(false);

	const credentialName = useCredentialName(
		vcEntity?.parsedCredential?.metadata?.credential?.name,
		vcEntity?.batchId,
		[i18n.language]
	);

	return (
		<button
			id={`slider-select-credentials-${vcEntity.batchId}`}
			className="relative w-full rounded-xl transition-shadow shadow-md hover:shadow-xl cursor-pointer"
			tabIndex={isActive ? 0 : -1}
			onClick={() => onClick(vcEntity.batchId)}
			aria-label={credentialName}
			title={t('selectCredentialPopup.credentialSelectTitle', {
				friendlyName: credentialName,
			})}
		>
			<CredentialImage
				vcEntity={vcEntity}
				vcEntityInstances={vcEntity.instances}
				key={vcEntity.batchId}
				parsedCredential={vcEntity.parsedCredential}
				className="w-full object-cover rounded-xl"
				showRibbon={isActive}
				onLoad={() => setImageLoaded(true)}
				borderColor={borderColor}
			/>

			{imageLoaded && (
				<>
					<div
						className={`absolute inset-0 rounded-xl transition-opacity bg-lm-gray-400 dark:bg-dm-gray-600 ${isSelected ? 'opacity-0' : 'opacity-50'
							}`}
					/>
					<div className="absolute bottom-4 right-4 z-60">
						{isSelected ? (
							<CheckCircle
								size={30}
								className="z-50 rounded-full bg-white text-primary"
							/>
						) : (
							<Circle
								size={30}
								className="z-50 rounded-full bg-white/50 text-primary"
							/>
						)}
					</div>
				</>
			)}
		</button>
	);
};

const normalizePath = (path) => {
	if (Array.isArray(path)) return path;
	if (typeof path === 'string' && path.startsWith('$.')) {
		return path.slice(2).split('.');
	}
	return [path];
};

const StepBar = ({ totalSteps, currentStep, stepTitles }) => {

	return (
		<div className="flex items-center justify-center w-full mb-2">
			{Array.from({ length: totalSteps }, (_, index) => {
				const isActive = index + 1 < currentStep;
				const isCurrent = index + 1 === currentStep;
				return (
					<React.Fragment key={index}>
						<div className="flex flex-col items-center">
							<div
								className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${isActive
									? 'text-white bg-primary border border-primary'
									: isCurrent
										? 'text-primary dark:text-white dark:bg-dm-gray-700 border border-primary'
										: 'text-brand-lighter dark:text-brand-lighter border border-brand-lighter dark:border-brand-darker'
									}`}
							>
								{index === 0 ? (
									<View size={20} className="text-sm" />
								) : index === totalSteps - 1 ? (
									<BookCheck size={20} className="text-lg" />
								) : (
									<IdCard size={20} className="text-base" />
								)}
							</div>
						</div>
						{index < totalSteps - 1 && (
							<div className="flex-auto h-[2px] bg-brand-lighter dark:bg-brand-darker">
								<div
									className={`flex-auto h-[2px] ${isActive ? 'bg-brand-light' : ''} transition-all duration-300`}
									style={{ width: isActive ? '100%' : '0%' }}
								></div>
							</div>
						)}
					</React.Fragment>
				);
			})}
		</div>
	);
};

const StepTitle = ({ currentKey, t }) => {
	let text = t('selectCredentialPopup.selectTitle');

	if (currentKey === 'preview') {
		text = t('selectCredentialPopup.previewTitle');
	} else if (currentKey === 'summary') {
		text = t('selectCredentialPopup.summaryTitle');
	}

	return (
		<h2 className="text-lg font-bold mt-4 mb-2 text-lm-gray-900 dark:text-dm-gray-100 flex flex-wrap items-center gap-2 leading-tight">
			<span className="inline-flex items-center gap-2">
				{t('selectCredentialPopup.baseTitle')} - {text}
			</span>
		</h2>
	);
};

function SelectCredentialsPopup({ popupState, setPopupState, showPopup, hidePopup, vcEntityList }) {

	const [vcEntities, setVcEntities] = useState(null);
	const { t } = useTranslation();
	const rawKeys = useMemo(() => popupState?.options ? Object.keys(popupState.options.conformantCredentialsMap) : [], [popupState]);
	const dcqlQuery = popupState?.options?.dcqlQuery;
	const keys = useMemo(() => ['preview', ...rawKeys, 'summary'], [rawKeys]);
	const stepTitles = useMemo(() => keys, [keys]);
	const [currentIndex, setCurrentIndex] = useState(0);
	const [currentSelectionMap, setCurrentSelectionMap] = useState({});
	const [showFullPurpose, setShowFullPurpose] = useState(false);
	const [selectedCredential, setSelectedCredential] = useState(null);
	const screenType = useScreenType();
	const [activeSlideIndexByKey, setActiveSlideIndexByKey] = useState({});
	const currentKey = keys[currentIndex];
	const currentSlide = activeSlideIndexByKey[currentKey] ?? 1;
	const [currentSummarySlide, setCurrentSummarySlide] = useState(0);
	const proverService = useMemo(() => new MdocProverService(), []);
	const [isProving, setIsProving] = useState(false);
	const [proofResult, setProofResult] = useState(null);
	const { keystore, api } = useContext(SessionContext);
	const [ppidHex, setPpidHex] = useState(null);
	const [isVerifying, setIsVerifying] = useState(false);
	const [verificationStatus, setVerificationStatus] = useState(null);
	const [verificationResponse, setVerificationResponse] = useState(null);
	const cborEncoder = new Encoder({
		useRecords: false,
		variableMapSize: false, 
	  });
	const proofCacheDb = useIndexedDb(
		'zkProofCache',
		1,
		(db) => {
			if (!db.objectStoreNames.contains('proofs')) {
				db.createObjectStore('proofs');
			}
		}
	);
	const handleSlideChange = (idx) => {
		setActiveSlideIndexByKey(prev => ({ ...prev, [currentKey]: idx + 1 }));
	};
	const handleLongFellow = async () => {
		const nextIndex = currentIndex + 1;
		const nextKey = keys[nextIndex];
	
		if (currentKey === 'preview') {
			setCurrentIndex(nextIndex);
			return;
		}
	
		const selectedBatchId = currentSelectionMap[currentKey];
		const selectedVc = vcEntityList.find(vc => vc.batchId === selectedBatchId);
	
		if (!selectedBatchId || !selectedVc) {
			console.warn('No credential selected — cannot proceed to proving step');
			return;
		}
	
		if (nextKey === 'summary' && !proofResult) {
			setIsProving(true);
			let worker;
			try {
				const nowUnix = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

				// TODO use transcript from verifeir
				// Structure: [null, null, ["example.org", "https://example.org/response", "p1234567890abcdefpfedcba0987654321"]]
				const transcriptHex = (() => {
					const parts = [
						null,           // DeviceEngagement
						null,           // Handover  
						[
							"example.org",
							"https://example.org/response",
							"p1234567890abcdefpfedcba0987654321"
						]
					];
					const encoded = encode(parts);
					return bufToHex(encoded);
				})();

				const CACHE_KEY = `${selectedVc.credentialId}_${transcriptHex.slice(0, 16)}`;
	
				// Check IndexedDB cache
				let cached = null;
				try {
					cached = await proofCacheDb.read(['proofs'], (tr) =>
						tr.objectStore('proofs').get(CACHE_KEY)
					);
				} catch (e) {
					console.log("No cached proof found");
				}
	
				let finalVP;
				const originalMdocHex = base64ToHex(selectedVc.data);

				if (cached) {
					console.log("Using cached proof from IndexedDB");
					setPpidHex(Array.from(cached.ppid).map(b => b.toString(16).padStart(2, '0')).join(''));
					finalVP = assembleFinalVP_V8(originalMdocHex, cached.proof, cached.ppid, transcriptHex, nowUnix);
				} else {
					// Sign the mdoc with the device key
					const rawSignatureHex = await generate(keystore, originalMdocHex, transcriptHex);
					// Issuer puts empty sig: 8443a10126a0f640
					// Replace with actual sig: 8443a10126a0f65840 + 64-byte sig
					const EMPTY_PLACEHOLDER = "8443a10126a0f640";
					const signedMdocHex = originalMdocHex.replace(
						EMPTY_PLACEHOLDER,
						"8443a10126a0f65840" + rawSignatureHex
					);
					const mdocBytes = new Uint8Array(base64ToHex(selectedVc.data).match(/.{1,2}/g).map(b => parseInt(b, 16)));
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
					const result = await new Promise((resolve, reject) => {
						const timeoutMs = 500000;
						const timer = setTimeout(() => {
							reject(new Error(`Proof generation timed out after ${timeoutMs}ms`));
						}, timeoutMs);
	
						workerInstance.onmessage = (e) => {
							clearTimeout(timer);
							console.log('worker message:', e.data.type);
							if (e.data.type === 'PROOF_SUCCESS') resolve(e.data.payload);
							else reject(new Error(e.data.payload));
						};
						workerInstance.onerror = (err) => {
							clearTimeout(timer);
							console.error('worker.onerror fired:', err);
							reject(err);
						};
	
						workerInstance.postMessage({
							type: 'GENERATE_PROOF',
							payload: { mdoc: signedMdocHex, transcript: transcriptHex, now: nowUnix, pseudonymSeed: pseudonymSeed }
						});
					});
	
					setPpidHex(result.ppidHex);
					finalVP = assembleFinalVP_V8(originalMdocHex, result.proof, result.ppid, transcriptHex, nowUnix);
	
					// Cache proof and ppid in IndexedDB
					try {
						await proofCacheDb.write(['proofs'], (tr) =>
							tr.objectStore('proofs').put(
								{ proof: result.proof, ppid: result.ppid },
								CACHE_KEY
							)
						);
						console.log("Proof cached in IndexedDB");
					} catch (e) {
						console.warn("Failed to cache proof:", e);
					}
				}
	
				if (finalVP) {
					const transactionId = WalletStateUtils.getRandomUint32();
					const [, newPrivateData, keystoreCommit] = await keystore.addPresentations([
						{
							transactionId,
							data: finalVP,
							usedCredentialIds: [selectedVc.credentialId],
							audience: "youtube",
						},
					]);
					await api.updatePrivateData(newPrivateData);
					await keystoreCommit();
				}
	
				setProofResult(finalVP);
				setCurrentIndex(nextIndex);
	
			} catch (e) {
				console.error("VP Preparation failed:", e);
			} finally {
				worker?.terminate();
				setIsProving(false);
			}
		} else {
			setCurrentIndex(nextIndex);
		}
	};

	useEffect(() => {
		const selectedId = currentSelectionMap[currentKey];
		if (selectedId && vcEntities?.length) {
			const idx = vcEntities.findIndex(v => v.batchId === selectedId);
			if (idx !== -1 && activeSlideIndexByKey[currentKey] !== idx + 1) {
				setActiveSlideIndexByKey(prev => ({ ...prev, [currentKey]: idx + 1 }));
			}
		}
	}, [currentKey, vcEntities, currentSelectionMap, activeSlideIndexByKey]);

	const requestedFieldsPerCredential = useMemo(() => {

		if (!popupState?.options) return {};
		const map = popupState.options.conformantCredentialsMap;
		const result = {};
		for (const [descriptorId, entry] of Object.entries(map)) {
			const seen = new Set();
			result[descriptorId] = (entry.requestedFields || []).filter(field => {
				const key = field.name || field.path?.join('.');
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
		}
		return result;
	}, [popupState]);

	const reinitialize = useCallback(() => {
		setCurrentIndex(0);
		setActiveSlideIndexByKey({});
		setCurrentSelectionMap({});
		setSelectedCredential(null);
		setPopupState((current) => ({ ...current, isOpen: false }));
	}, [setPopupState]);

	useEffect(() => {
		const getData = async () => {
			const currentKey = keys[currentIndex];
			if (currentIndex === Object.keys(popupState.options.conformantCredentialsMap).length + 2) {
				reinitialize();
				popupState.resolve(new Map(Object.entries(currentSelectionMap)));
				return;
			}

			if (currentKey === 'preview' || currentKey === 'summary') {
				if (currentKey !== keys[currentIndex]) {
					setVcEntities([]);
				}
				return;
			}
			try {
				const filteredVcEntities = vcEntityList.filter(vcEntity =>
					popupState.options.conformantCredentialsMap[keys[currentIndex]].credentials.includes(vcEntity.batchId)
				);
				setVcEntities(filteredVcEntities);
			} catch (error) {
				logger.error('Failed to fetch data', error);
			}
		};

		if (popupState?.options && vcEntityList) {
			logger.debug("opts = ", popupState.options)
			getData();
		}
	}, [
		currentIndex,
		currentSelectionMap,
		keys,
		popupState,
		vcEntityList,
		reinitialize
	]);

	useEffect(() => {
		if (popupState?.options) {
			const currentKey = keys[currentIndex];
			const selectedId = currentSelectionMap[currentKey];
			setSelectedCredential(selectedId);
		}
	}, [currentIndex, currentSelectionMap, keys, popupState]);

	const selectedVcEntities = useMemo(() => {
		if (!vcEntityList || !currentSelectionMap) return [];

		return Object.values(currentSelectionMap)
			.map((selectedId) =>
				vcEntityList.find((vc) => vc.batchId === selectedId)
			)
			.filter(Boolean);
	}, [currentSelectionMap, vcEntityList]);

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
	
	function manualMap(pairs) {
		const header = minimalMapHeader(pairs.length);
		const parts = [header];
		for (const [key, valueBytes] of pairs) {
			parts.push(cborEncode(key));
			parts.push(valueBytes);
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
	
		const documentDataTagged2 = manualTag(24, documentDataMap);
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
			ZKDeviceResponseCBOR: uint8ToBase64(outerResponseBytes)
		};
	}
	function base64ToHex(str) {
		const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
		const bin = atob(b64);
		return Array.from(bin)
				.map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
				.join('');
	}
	/**
	 * Safely converts a Uint8Array to Base64 without blowing the stack.
	 */
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
	const goToNextSelection = () => {

		if (keys[currentIndex] === 'summary') {
			popupState.resolve(new Map(Object.entries(currentSelectionMap)));
			reinitialize();
		} else {
			const isZkProof = dcqlQuery?._isZk === true;
			if (isZkProof) {
				handleLongFellow();
			} else {
				setCurrentIndex(i => i + 1);
			}
		}
	}

	const goToPreviousSelection = () => {
		if (currentIndex > 0) {
			setCurrentIndex(currentIndex - 1);
		}
	};

	const handleClick = (batchId) => {
		const descriptorId = keys[currentIndex];
		if (selectedCredential === batchId) {
			setSelectedCredential(null);
			setCurrentSelectionMap((prev) => ({ ...prev, [descriptorId]: undefined }));
		} else {
			setSelectedCredential(batchId);
			setCurrentSelectionMap((prev) => ({ ...prev, [descriptorId]: batchId }));
		}
	};

	const onClose = () => {
		popupState.reject();
		reinitialize();
	}

	if (!popupState?.isOpen) {
		return null;
	};

	return (
		<PopupLayout isOpen={popupState?.isOpen} onClose={onClose} loading={false} fullScreen={screenType !== 'desktop'} padding="p-0" shouldCloseOnOverlayClick={false}>
			<div className={`${screenType === 'desktop' && 'p-4'}`}>

				{keys.length > 1 && (
					<StepBar totalSteps={keys.length} currentStep={currentIndex + 1} stepTitles={stepTitles} />
				)}
				{stepTitles && (
					<StepTitle currentKey={keys[currentIndex]} t={t} />
				)}
				<hr className="mb-2 border-t border-lm-gray-400 dark:border-dm-gray-600" />

				{/* Preview step */}
				{keys[currentIndex] === 'preview' && (
					<>
						<p className="text-lm-gray-900 dark:text-dm-gray-100 italic text-sm mt-3 mb-2">
							{t('selectCredentialPopup.previewDescription')}
						</p>
						<div className="flex flex-col gap-2">

							{popupState?.options?.verifierDomainName && (
								<div className="flex flex-wrap gap-1 items-center text-sm text-lm-gray-900 dark:text-dm-gray-100">
									<span className="text-lm-gray-900 dark:text-dm-gray-100 text-sm font-bold block">
										{t('selectCredentialPopup.requestingParty')}
									</span>
									<span className="w-max font-semibold text-lm-gray-900 dark:text-dm-gray-100 rounded border border-lm-gray-400 dark:border-dm-gray-600 p-1 break-all block">
										{prettyDomain(popupState.options.verifierDomainName)}
									</span>
								</div>
							)}
							{popupState.options.verifierPurpose && (() => {
								const { text: truncatedText, truncated } = truncateByWords(popupState.options.verifierPurpose, 40);
								const textToDisplay = showFullPurpose ? popupState.options.verifierPurpose : truncatedText;

								return (
									<p className="pd-2 text-sm text-lm-gray-900 dark:text-dm-gray-100">
										<span className="text-sm font-bold text-lm-gray-900 dark:text-dm-gray-100">
											{t('selectCredentialPopup.purpose')}
										</span>
										<span className="font-medium">
											{textToDisplay}
										</span>
										{truncated && (
											<>
												{' '}
												<button
													onClick={() => setShowFullPurpose(!showFullPurpose)}
													className="text-primary dark:text-brand-light font-medium hover:underline inline"
												>
													{showFullPurpose ? t('common.showLess') : t('common.showMore')}
												</button>
											</>
										)}
									</p>
								);
							})()}

							{popupState?.options?.parsedTransactionData && popupState?.options?.parsedTransactionData.map((txData) => {
								const TxComp = txData.ui;
								return (<TxComp />)
							})}

							<div>
								<p className="text-lm-gray-900 dark:text-dm-gray-100 text-sm font-bold">
									{t('selectCredentialPopup.requestedCredentialsFieldsTitle')}
								</p>
								{Object.entries(requestedFieldsPerCredential).map(([descriptorId, fields]) => {
									return (
										<div key={descriptorId} className="my">
											<div className="flex flex-row gap-1 text-sm text-lm-gray-800 dark:text-dm-gray-200 my-1">
												<span className="flex items-center gap-1 font-bold">
													<IdCard className="text-lm-gray-900 dark:text-dm-gray-100" />
													{t('selectCredentialPopup.request')}
												</span>
												<span
													title={descriptorId}
													className="font-semibold bg-lm-gray-100 dark:bg-dm-gray-900 px-1 rounded border border-lm-gray-400 dark:border-dm-gray-600 break-all truncate whitespace-nowrap overflow-hidden flex-1 min-w-0 max-w-max"
												>
													{descriptorId}
												</span>
											</div>
											<p className="text-sm font-normal text-lm-gray-900 dark:text-dm-gray-100 list-disc ml-4">
												{!fields[0].path[0] ? (
													<span>
														{t('selectCredentialPopup.allClaimsRequested')}
													</span>
												) : (
													<span>
														{t('selectCredentialPopup.specificClaimsRequested')}
													</span>
												)}
											</p>
										</div>
									);
								})}
							</div>
						</div>

					</>
				)}

				{/* Selection step */}
				{keys[currentIndex] !== 'preview' && keys[currentIndex] !== 'summary' && (
					<>
						<p className="text-lm-gray-900 dark:text-dm-gray-100 italic text-sm mt-3 mb-4">
							{t('selectCredentialPopup.selectDescription')}
						</p>
						<div>
						</div>
						<div key={keys[currentIndex]} className={`${screenType === 'desktop' && 'm-auto max-w-[700px]'}`}>
							{vcEntities && vcEntities.length ? (
								<Slider
									items={vcEntities}
									renderSlideContent={(vcEntity, index) => (
										<SelectableCredentialSlideCard
											key={vcEntity.batchId}
											vcEntity={vcEntity}
											isActive={currentSlide === index + 1}
											isSelected={selectedCredential === vcEntity.batchId}
											onClick={handleClick}
											borderColor={screenType === 'desktop' ? 'border-lm-gray-400 dark:border-dm-gray-600' : undefined}
										/>
									)}
									initialSlide={currentSlide}
									onSlideChange={handleSlideChange}
									className='xm:px-4 px-16 sm:px-24 md:px-8'
								/>
							) : (
								<CredentialCardSkeleton />

							)}
							{vcEntities?.[currentSlide - 1] ? (
								<div className="flex flex-wrap justify-center flex-row items-center my-2">
									<CredentialInfo
										parsedCredential={vcEntities[currentSlide - 1].parsedCredential}
										mainClassName={"text-xs w-full"}
										requested={{
											fields: requestedFieldsPerCredential[keys[currentIndex]]?.map(field => normalizePath(field.path)),
											display: "highlight"
										}}
									/>
								</div>
							) : (
								<div className="mt-2">
									<CredentialInfoSkeleton />
								</div>
							)}
						</div>
					</>
				)}

				{/* Summary step */}
				{keys[currentIndex] === 'summary' && (
					<>
						<p className="text-lm-gray-900 dark:text-dm-gray-100 italic text-sm mt-3 mb-4">
							<Trans
								i18nKey="selectCredentialPopup.summaryDescription"
								components={{ strong: <strong /> }}
							/>
						</p>

						{ppidHex && (
							<div className="mb-3 p-2 rounded border border-lm-gray-400 dark:border-dm-gray-600 bg-lm-gray-100 dark:bg-dm-gray-900">
								<p className="text-xs font-bold text-lm-gray-900 dark:text-dm-gray-100 mb-1">
									{t('selectCredentialPopup.pseudonymId', 'Pairwise pseudonym')}
								</p>
								<p className="text-xs font-mono break-all text-lm-gray-800 dark:text-dm-gray-200">
									{ppidHex}
								</p>
							</div>
						)}
						{popupState?.options?.parsedTransactionData && popupState?.options?.parsedTransactionData.map((txData) => {
							const TxComp = txData.ui;
							return <TxComp />
						})}

						<div className={`${screenType === 'desktop' && 'max-w-[600px]'}`}>
							<div className='py-[3px]'>
								<Slider
									items={selectedVcEntities}
									renderSlideContent={(vcEntity, i) => {
										const descriptorId = Object.keys(currentSelectionMap).find(
											(key) => currentSelectionMap[key] === vcEntity.batchId
										);

										const fields = requestedFieldsPerCredential[descriptorId];
										const hasValidPath = Array.isArray(fields) && fields[0]?.path[0];

										const requiredClaimPaths = (vcEntity.parsedCredential.metadata.credential?.TypeMetadata?.claims ?? [])
											.filter(c => c?.required === true)
											.map(c => normalizePath(c.path));

										// Only merge when hasValidPath is true, otherwise leave undefined
										const filterPaths = hasValidPath
											? Array.from(
												new Set([
													...fields.map(f => JSON.stringify(normalizePath(f.path))),
													...requiredClaimPaths.map(p => JSON.stringify(p))
												])
											).map(p => JSON.parse(p))
											: undefined;

										return (
											<div className='w-full'>
												<CredentialImage
													vcEntity={vcEntity}
													vcEntityInstances={vcEntity.instances}
													parsedCredential={vcEntity.parsedCredential}
													className="w-full object-cover rounded-xl"
													showRibbon={currentSummarySlide === i}
													filter={filterPaths}
													borderColor={screenType === 'desktop' ? 'border-lm-gray-400 dark:border-dm-gray-600' : undefined}
												/>
											</div>
										);
									}}
									initialSlide={currentSummarySlide + 1}
									onSlideChange={(index) => setCurrentSummarySlide(index)}
									className='xm:px-4 px-16 sm:px-24 md:px-8'
								/>
							</div>
							{selectedVcEntities?.[currentSummarySlide] ? (
								<div className="flex flex-wrap justify-center items-center my-2">
									<CredentialInfo
										parsedCredential={selectedVcEntities[currentSummarySlide].parsedCredential}
										mainClassName="text-xs w-full"
										requested={{
											fields: requestedFieldsPerCredential[
												Object.keys(currentSelectionMap).find(
													(key) =>
														currentSelectionMap[key] ===
														selectedVcEntities[currentSummarySlide]?.batchId
												)
											]?.map((field) => normalizePath(field.path)),
											display: "hide"
										}}
									/>
								</div>
							) : (
								<CredentialInfoSkeleton />
							)}
						</div>
					</>
				)}
			</div>

			<div
				className={`z-10 left-0 right-0 bg-lm-gray-100 dark:bg-dm-gray-900 border-t border-lm-gray-400 dark:border-dm-gray-600 shadow-2xl flex justify-between ${screenType === 'desktop'
					? 'sticky bottom-0 px-4 py-3'
					: 'fixed bottom-0 px-6 pb-4 pt-4'
					}`}
			>
				<Button
					id="cancel-select-credentials"
					onClick={onClose}
					className="mr-2"
				>
					{t('common.cancel')}
				</Button>

				<div className="flex gap-2">
					{currentIndex > 0 && (
						<Button
							id="previous-select-credentials"
							variant="outline"
							onClick={goToPreviousSelection}>
							{t('common.previous')}
						</Button>
					)}

					<Button
						id={`${keys[currentIndex] === 'summary' ? 'send' : 'next'}-select-credentials`}
						onClick={goToNextSelection}
						variant="primary"
						disabled={
							isProving ||
							(keys[currentIndex] !== 'summary' && keys[currentIndex] !== 'preview' && selectedCredential === undefined)
						}
						title={selectedCredential === undefined && keys[currentIndex] !== 'summary' && keys[currentIndex] !== 'preview'
							? t('selectCredentialPopup.nextButtonDisabledTitle') : ''}
					>
						{isProving ? (
							<span className="flex items-center gap-2">
								<LoaderCircle className="w-4 h-4 animate-spin" />
								{t('common.proving', 'Proving...')}
							</span>
						) : keys[currentIndex] === 'summary' ? (
							t('common.navItemSendCredentialsSimple')
						) : (
							t('common.next')
						)}
					</Button>
				</div>
			</div>
		</PopupLayout >
	);
}

export default SelectCredentialsPopup;
