import React, { useState, useEffect, useContext, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { logger } from '@/logger';
import QRCode from 'qrcode';

import StatusContext from '@/context/StatusContext';
import SessionContext from '@/context/SessionContext';
import RedirectPopup from '../../components/Popups/RedirectPopup';
import { H1 } from '../../components/Shared/Heading';
import QueryableList from '../../components/QueryableList/QueryableList';
import PageDescription from '../../components/Shared/PageDescription';
import EntityListItem from '@/components/QueryableList/EntityListItem';
import CredentialsContext from '@/context/CredentialsContext';
import { encode, decode, Tag } from "cbor-x";
import { COSEKeyToJWK } from "cose-kit";
import * as jose from "jose";
import { cborDecode, cborEncode, getCborEncodeDecodeOptions, setCborEncodeDecodeOptions } from "@auth0/mdl/lib/cbor";

function concat(...parts) {
  const arrays = parts.map(p => p instanceof Uint8Array ? p : new Uint8Array(p));
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

function formatUuid(hexStr) {
  return [hexStr.slice(0,8), hexStr.slice(8,12), hexStr.slice(12,16),
          hexStr.slice(16,20), hexStr.slice(20)].join('-');
}

function hexToBytes(hexString) {
  const clean = hexString.replace(/\s+/g, '').toLowerCase();
  const invalid = clean.match(/[^0-9a-f]/g);
  if (invalid) throw new Error(`Invalid hex chars: ${[...new Set(invalid)].join(', ')}`);
  if (clean.length % 2 !== 0) throw new Error(`Odd hex length: ${clean.length}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2)
    out[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  return out;
}

function buildSessionData(encryptedBytes) {
  const mapHeader  = new Uint8Array([0xa1]);
  const keyHeader  = new Uint8Array([0x64]);
  const keyBytes   = new TextEncoder().encode('data');
  const bl = encryptedBytes.length;
  let bstrHeader;
  if      (bl < 24)    bstrHeader = new Uint8Array([0x40 | bl]);
  else if (bl < 256)   bstrHeader = new Uint8Array([0x58, bl]);
  else if (bl < 65536) bstrHeader = new Uint8Array([0x59, bl >> 8, bl & 0xff]);
  else                 bstrHeader = new Uint8Array([0x5a, (bl>>24)&0xff, (bl>>16)&0xff, (bl>>8)&0xff, bl&0xff]);
  return concat(mapHeader, keyHeader, keyBytes, bstrHeader, encryptedBytes);
}

function framePayload(payload, mtu = 512) {
  const maxChunk = mtu - 1;
  const frames = [];
  let offset = 0;
  while (offset < payload.length) {
    const chunk = payload.slice(offset, offset + maxChunk);
    offset += maxChunk;
    const isLast = offset >= payload.length;
    frames.push(concat([isLast ? 0x00 : 0x01], chunk));
  }
  if (frames.length === 0) frames.push(new Uint8Array([0x00]));
  return frames;
}

async function buildDeviceEngagementQR() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  const x = raw.slice(1, 33);
  const y = raw.slice(33, 65);
  const coseKey = concat([0xa4],[0x01,0x02],[0x20,0x01],[0x21,0x58,0x20],x,[0x22,0x58,0x20],y);
  const eDeviceKeyBytes = concat([0xd8,0x18,0x58,coseKey.length], coseKey);
  const sessionUUIDHex = crypto.randomUUID().replace(/-/g, '');
  const formattedBleUuid = formatUuid(sessionUUIDHex);
  const uuidBytes = new Uint8Array(sessionUUIDHex.match(/../g).map(h => parseInt(h, 16)));
  const bleOpts = concat([0xa3],[0x00,0xf4],[0x01,0xf5],[0x0b,0x50],uuidBytes);
  const deBytes = concat(
    [0xa3],[0x00,0x63,0x31,0x2e,0x30],
    [0x01,0x82,0x01], eDeviceKeyBytes,
    [0x02,0x81,0x83,0x02,0x01], bleOpts
  );
  const b64url = btoa(String.fromCharCode(...deBytes))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    return { uri: `mdoc:${b64url}`, keyPair, bleUuid: formattedBleUuid, deBytes };
}

export function BleQrPanel() {
  const { t } = useTranslation();
  const { vcEntityList } = useContext(CredentialsContext);
  const { keystore } = useContext(SessionContext);
  const canvasRef = useRef(null);
  const pollingIntervalRef = useRef(null);
  const frameBufferRef = useRef([]);
  const assembledPayloadRef = useRef(null);
  const deviceEngagementRef = useRef(null);

  const [error, setError] = useState('');
  const [bleStatus, setBleStatus] = useState('Disconnected');
  const [assembledPayload, setAssembledPayload] = useState(null);
  const [isTransmitting, setIsTransmitting] = useState(false);

	function base64ToHex(str) {
		const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
		const bin = atob(b64);
		return Array.from(bin)
				.map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
				.join('');
	}

  const handleIncomingBleChunk = (rawFrameArray) => {
    if (!rawFrameArray || rawFrameArray.length === 0) return;
    
    const firstByte = rawFrameArray[0];
    
    // If first byte is 0x00 or 0x01 — standard ISO framing
    if (firstByte === 0x00 || firstByte === 0x01) {
      const isLast = firstByte === 0x00;
      const chunk = rawFrameArray.slice(1);
      frameBufferRef.current = [...frameBufferRef.current, ...chunk];
      if (isLast) {
        const assembled = new Uint8Array(frameBufferRef.current);
        frameBufferRef.current = [];
        assembledPayloadRef.current = assembled;
        setAssembledPayload(assembled);
        setBleStatus(`✅ Request received (${assembled.length} bytes)`);
      }
    } else {
      const assembled = new Uint8Array(rawFrameArray);
      assembledPayloadRef.current = assembled;
      setAssembledPayload(assembled);
      setBleStatus(`Request received (${assembled.length} bytes)`);
    }
  };


const startPollingForIncomingData = () => {
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    pollingIntervalRef.current = setInterval(async () => {
        try {
            let statusReport = null;
            try {
                statusReport = await window.nativeWrapper.bluetoothStatus('');
                console.log('status:', statusReport);
                if (statusReport?.includes('Connected')) {
                    setBleStatus('Connected.');
                }
            } catch (e) {
                console.log('status error:', e.message);
            }

            // drain ALL frames in one tick
            for (let i = 0; i < 30; i++) {
                let raw = null;
                try {
                    raw = await window.nativeWrapper.bluetoothReceiveFromServer('');
                } catch (_) {
                    setBleStatus(`frame ${i}: exception`);
                    break;
                }
                if (!raw || raw === 'false' || raw === 'null') {
                    break;  // no data this tick — leave bleStatus as-is (e.g. "Connected.")
                }
                const byteArray = JSON.parse(raw);
                if (!byteArray?.length) break;
                setBleStatus(`frame ${i}: ${byteArray.length}b hdr:0x${byteArray[0].toString(16)}`);
                handleIncomingBleChunk(byteArray);
                if (assembledPayloadRef.current) break;
            }
        } catch (err) {
            console.error('Poll error:', err);
        }
    }, 400);
};

  const SUPPORTED_DOC_TYPES = [
    'org.iso.18013.5.1.mDL',
    'eu.europa.ec.eudi.pid.1',
  ];

  async function findFirstSupportedCredential(vcEntityList) {
    for (const vc of vcEntityList || []) {
      try {
        const hex = base64ToHex(vc.data);
        const mdocBytes = new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
        const mdoc = decode(mdocBytes);
        const docType = mdoc.documents?.[0]?.docType;
        if (SUPPORTED_DOC_TYPES.includes(docType)) {
          return { vc, docType, hex };
        }
      } catch (e) {
        console.warn('Could not decode credential, skipping:', vc?.credentialId, e);
      }
    }
    return null;
  }

const ALWAYS_EXCLUDE = ['portrait', 'pseudonym_seed'];

function filterMdocExcludingPortraitAndSeed(mdocBytes) {
    const mdoc = decode(mdocBytes);
    const doc = mdoc.documents[0];
    const nameSpaces = doc.issuerSigned.nameSpaces;

    const arrayHeader = (len) => {
        if (len < 24) return new Uint8Array([0x80 | len]);
        if (len < 256) return new Uint8Array([0x98, len]);
        return new Uint8Array([0x99, len >> 8, len & 0xff]);
    };
    const tagged24 = (b) => {
        const bl = b.length;
        let header;
        if (bl < 24) header = new Uint8Array([0x40 | bl]);
        else if (bl < 256) header = new Uint8Array([0x58, bl]);
        else header = new Uint8Array([0x59, bl >> 8, bl & 0xff]);
        return concat([0xd8, 0x18], header, b);
    };

    let mdocHex = Array.from(mdocBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    for (const ns of Object.keys(nameSpaces)) {
        const originalItems = nameSpaces[ns];

        const originalItemBytes = originalItems.map(item => tagged24(item.value ?? item));
        const originalFull = concat(arrayHeader(originalItems.length), ...originalItemBytes);
        const originalFullHex = Array.from(originalFull).map(b => b.toString(16).padStart(2, '0')).join('');

        const anchorIndex = mdocHex.indexOf(originalFullHex);
        if (anchorIndex === -1) {
            console.warn(`Could not locate original nameSpaces array for "${ns}" — skipping filter for this namespace`);
            continue;
        }

        const keptItems = originalItems.filter(item => {
            const decoded = decode(item.value ?? item);
            const id = decoded.elementIdentifier;
            const value = decoded.elementValue;

            if (value === null || value === undefined) return false;
            if (ALWAYS_EXCLUDE.includes(id)) return false;

            return true;
        });

        const keptItemBytes = keptItems.map(item => tagged24(item.value ?? item));
        const rebuiltFull = concat(arrayHeader(keptItems.length), ...keptItemBytes);
        const rebuiltFullHex = Array.from(rebuiltFull).map(b => b.toString(16).padStart(2, '0')).join('');

        mdocHex =
            mdocHex.slice(0, anchorIndex) +
            rebuiltFullHex +
            mdocHex.slice(anchorIndex + originalFullHex.length);
    }

    return hexToBytes(mdocHex);
}

const handleManualMdocDelivery = async () => {
    if (isTransmitting) return;
    setIsTransmitting(true);
    setBleStatus('Encrypting...');
    try {
      const match = await findFirstSupportedCredential(vcEntityList);
      if (!match) {
          throw new Error('No supported credential (mDL or PID) found in vcEntityList');
      }
      const { docType: realDocType, hex: originalMdocHex } = match;

      const assembled = assembledPayloadRef.current;
      if (!assembled) throw new Error('No SessionEstablishment received yet');
      if (!deviceEngagementRef.current) throw new Error('No device engagement — restart');
      const { deBytes, keyPair } = deviceEngagementRef.current;

      const cborBstr = b => { const bl=b.length; if(bl<24) return concat([0x40|bl],b); if(bl<256) return concat([0x58,bl],b); if(bl<65536) return concat([0x59,bl>>8,bl&0xff],b); return concat([0x5a,(bl>>24)&0xff,(bl>>16)&0xff,(bl>>8)&0xff,bl&0xff],b); };
      const tagged24 = b => concat([0xd8,0x18], cborBstr(b));
      const findCoseKey = b => {
        const limit = Math.min(b.length, 200);
        for(let i=0;i<limit-75;i++)
          if(b[i]===0xa4&&b[i+1]===0x01&&b[i+2]===0x02&&b[i+3]===0x20&&b[i+4]===0x01&&b[i+5]===0x21&&b[i+6]===0x58&&b[i+7]===0x20)
            return b.slice(i,i+75);
        throw new Error('eReaderKey not found');
      };

      const eReaderKey = findCoseKey(assembled);
      const transcript = concat([0x83], tagged24(deBytes), tagged24(eReaderKey), [0xf6]);
      const x = eReaderKey.slice(8,40), y = eReaderKey.slice(43,75);
      const pub = await crypto.subtle.importKey('raw', concat([0x04],x,y), {name:'ECDH',namedCurve:'P-256'}, false, []);
      const shared = await crypto.subtle.deriveBits({name:'ECDH',public:pub}, keyPair.privateKey, 256);

      const transcriptTagged = tagged24(transcript);
      const saltHash = await crypto.subtle.digest('SHA-256', transcriptTagged);
      const salt = new Uint8Array(saltHash);

      const hkdfExtract = await crypto.subtle.importKey('raw', salt, {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
      const prk = new Uint8Array(await crypto.subtle.sign('HMAC', hkdfExtract, new Uint8Array(shared)));

      const prkKey = await crypto.subtle.importKey('raw', prk, {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
      const expandInput = concat(new TextEncoder().encode('SKDevice'), [0x01]);
      const okm = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, expandInput));

      const SKDevice = await crypto.subtle.importKey('raw', okm.slice(0,32), {name:'AES-GCM'}, false, ['encrypt']);

      const credentialBytesForKeyLookup = hexToBytes(originalMdocHex);
      const mdocDecodedForKeyLookup = cborDecode(credentialBytesForKeyLookup);
;
      const msoBinaryRaw = (() => {
        const fullMdocDocument = mdocDecodedForKeyLookup.get?.("documents");
        if (fullMdocDocument) {
          const issuerSigned = fullMdocDocument[0].get('issuerSigned');
          const issuerAuth = issuerSigned.get('issuerAuth');
          return issuerAuth[2];
        }
        const issuerAuth = mdocDecodedForKeyLookup.get('issuerAuth');
        return issuerAuth[2];
      })();

      let msoBinary;
      if (msoBinaryRaw instanceof Uint8Array) {
        msoBinary = msoBinaryRaw;
      } else if (msoBinaryRaw instanceof ArrayBuffer) {
        msoBinary = new Uint8Array(msoBinaryRaw);
      } else {
        msoBinary = new Uint8Array(msoBinaryRaw.buffer, msoBinaryRaw.byteOffset || 0, msoBinaryRaw.byteLength || msoBinaryRaw.length);
      }

      const msoData = cborDecode(msoBinary);
      const deviceKeyInfo = msoData.data.get('deviceKeyInfo');
      const deviceKeyCose = deviceKeyInfo.get('deviceKey');
      const devicePublicKeyJwk = COSEKeyToJWK(deviceKeyCose);
      const kid = await jose.calculateJwkThumbprint(devicePublicKeyJwk, "sha256");

      const calculatedState = keystore.getCalculatedWalletState();
      const foundKeypair = calculatedState.keypairs.find(k => k.kid === kid);
      if (!foundKeypair) {
        throw new Error("Key pair not found for kid (key ID): " + kid);
      }
      const { privateKey: devicePrivateKeyJwk } = foundKeypair.keypair;
      const devicePrivKey = await crypto.subtle.importKey('jwk',
        devicePrivateKeyJwk,
        {name:'ECDSA', namedCurve:'P-256'}, false, ['sign']
      );
      const sig1Header = hexToBytes('846a5369676e61747572653143a1012640');
      const devAuthLabel = hexToBytes('847444657669636541757468656e7469636174696f6e');
      const docTypeBytes = (() => {
        const bytes = new TextEncoder().encode(realDocType);
        const len = bytes.length;
        let header;
        if (len < 24) header = new Uint8Array([0x60 | len]);
        else if (len < 256) header = new Uint8Array([0x78, len]);
        else header = new Uint8Array([0x79, len >> 8, len & 0xff]);
        return concat(header, bytes);
      })();

      const emptyNamespaces = new Uint8Array([0xd8,0x18,0x41,0xa0]);
      const inner = concat(devAuthLabel, transcript, docTypeBytes, emptyNamespaces);
      const payload = tagged24(inner);
      const tbs = concat(sig1Header, cborBstr(payload));

      const sigRaw = new Uint8Array(await crypto.subtle.sign(
        {name:'ECDSA', hash:'SHA-256'}, devicePrivKey, tbs
      ));
      const EMPTY_PLACEHOLDER = "8443a10126a0f640";
      const sigHex = Array.from(sigRaw).map(b => b.toString(16).padStart(2, '0')).join('');
      const signedMdocHex = originalMdocHex.replace(
        EMPTY_PLACEHOLDER,
        "8443a10126a0f65840" + sigHex
      );

      if (signedMdocHex === originalMdocHex) {
        throw new Error('Empty signature placeholder not found — credential may already be signed or has an unexpected structure');
      }

      const signedMdocBytesRaw = new Uint8Array(signedMdocHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
      const deviceResponseBytes = filterMdocExcludingPortraitAndSeed(signedMdocBytesRaw);
      // IV: 000000000000000100000001
      const iv = new Uint8Array(12);
      new DataView(iv.buffer).setUint32(4, 1, false);
      new DataView(iv.buffer).setUint32(8, 1, false);

      const encrypted = new Uint8Array(await crypto.subtle.encrypt(
        {name:'AES-GCM', iv, tagLength:128}, SKDevice, deviceResponseBytes
      ));

      const sessionData = buildSessionData(encrypted);
      const frames = framePayload(sessionData, 512);

      for (const frame of frames) {
        await window.nativeWrapper.bluetoothSendToServer(JSON.stringify(Array.from(frame)));
      }

      setBleStatus('✅ DeviceResponse sent!');
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    } catch (err) {
      setError(`Send failed: ${err.message}`);
      setBleStatus('Send error');
    } finally {
      setIsTransmitting(false);
    }
  };
 
  const generateAndPublish = async () => {
    setError('');
    setAssembledPayload(null);
    frameBufferRef.current = [];
    assembledPayloadRef.current = null; 

    deviceEngagementRef.current = null;
    setIsTransmitting(false);
    try {
        const { uri: qrUri, bleUuid, deBytes, keyPair } = await buildDeviceEngagementQR();
        deviceEngagementRef.current = { deBytes, keyPair };
        if (canvasRef.current) {
            await QRCode.toCanvas(canvasRef.current, qrUri, {
                width: 200, margin: 1, errorCorrectionLevel: 'M',
            });
        }
        setBleStatus('QR ready — waiting for verifier');
        await window.nativeWrapper.bluetoothTerminate('');

        if (window.nativeWrapper?.bluetoothSetMode) {
            window.nativeWrapper.bluetoothSetMode('MDocReader');
        }

        await window.nativeWrapper.bluetoothCreateClient(bleUuid);

        setBleStatus('BLE ready — scan QR with verifier');
        startPollingForIncomingData();
    } catch (e) {
        setError(e.message);
        setBleStatus('Error');
        throw e;
    }
  };


  useEffect(() => {
      let cancelled = false;
      let retryTimeout = null;

      const startWithRetry = async () => {
          while (!cancelled) {
              try {
                  await generateAndPublish();
                  return;
              } catch (e) {
                  setError(`Startup error: ${e.message} — retrying...`);
                  await new Promise(resolve => {
                      retryTimeout = setTimeout(resolve, 1500);
                  });
              }
          }
      };

    startWithRetry();

    return () => {
        cancelled = true;
        if (retryTimeout) clearTimeout(retryTimeout);
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        window.nativeWrapper?.bluetoothTerminate('').catch(() => {});
    };
}, []);

  const getHumanReadableRequest = () => {
    if (!assembledPayload) return null;
    const ascii = String.fromCharCode(...assembledPayload);
    const fields = [];
    if (ascii.includes('given_name'))     fields.push('Given Name');
    if (ascii.includes('family_name'))    fields.push('Family Name');
    if (ascii.includes('birth_date'))     fields.push('Date of Birth');
    if (ascii.includes('issue_date'))     fields.push('Issue Date');
    if (ascii.includes('expiry_date'))    fields.push('Expiry Date');
    if (ascii.includes('document_number')) fields.push('Document Number');
    if (ascii.includes('portrait'))       fields.push('Portrait');
    return { size: assembledPayload.length, fields: fields.length > 0 ? fields : ['Encrypted request'] };
  };

  const isConnected = bleStatus === 'Connected.' || bleStatus.includes('✅');
  const parsedSummary = getHumanReadableRequest();

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-gray-200 p-6 mt-6 bg-white shadow-sm w-full max-w-md mx-auto">
      <p className="text-sm font-medium text-gray-700">MDOC BLE Proximity
      </p>

      {error && (
        <p className="text-xs text-red-500 font-mono bg-red-50 p-2 rounded w-full text-center">{error}</p>
      )}

      <canvas ref={canvasRef} width={200} height={200} className="rounded-md border border-gray-100 shadow-inner" />

      <div className="text-center w-full bg-gray-50 py-2 rounded border border-gray-100">
        <span className="text-xs text-gray-400">BLE Status: </span>
        <span className={`text-xs font-bold ${bleStatus.includes('✅') || isConnected ? 'text-green-600' : 'text-amber-500'}`}>
          {bleStatus}
        </span>
      </div>

      {parsedSummary && (
        <div className="w-full bg-slate-900 p-4 rounded-lg border border-slate-800">
          <p className="text-xs font-bold text-blue-400 mb-2">📋 Verifier Request — {parsedSummary.size} bytes</p>
          <ul className="space-y-1">
            {parsedSummary.fields.map((f, i) => (
              <li key={i} className="text-xs font-mono text-emerald-400">→ {f}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2 w-full mt-2">
        {isConnected ? (
          <button
            onClick={handleManualMdocDelivery}
            disabled={isTransmitting}
            className="w-full text-sm px-4 py-2.5 font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-md shadow"
          >
            {isTransmitting ? 'Sending...' : '📤 Approve & Send Response'}
          </button>
        ) : (
          <button disabled className="w-full text-sm px-4 py-2.5 text-gray-400 bg-gray-100 rounded-md border border-gray-200 cursor-not-allowed">
            Waiting for verifier connection...
          </button>
        )}
        <button onClick={generateAndPublish} className="text-xs px-4 py-2 text-gray-500 bg-transparent rounded-md border border-gray-200 hover:bg-gray-50">
          ↺ Restart
        </button>
      </div>
    </div>
  );
}


const ShareCredentials = () => {
  const { isOnline } = useContext(StatusContext);
  const { api, keystore } = useContext(SessionContext);
  const [verifiers, setVerifiers] = useState(null);
  const [showRedirectPopup, setShowRedirectPopup] = useState(false);
  const [selectedVerifier, setSelectedVerifier] = useState(null);
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  const getUser = () => {
    const userHandle = keystore.getUserHandleB64u();
    if (!userHandle) return null;
    return keystore.getCachedUsers().find(u => u.userHandleB64u === userHandle);
  };

  const syncPrivateData = async () => {
    const cachedUser = getUser();
    if (!cachedUser) throw new Error('Could not get cached user');
    const result = await api.syncPrivateData(cachedUser);
    if (!result.ok) throw new Error('PrivateData needs synchronization');
    return {};
  };

  useEffect(() => {
    const fetchVerifiers = async () => {
      try {
				const fetchedVerifiers = await api.getAllVerifiers();
        setVerifiers(fetchedVerifiers);
      } catch (error) {
        console.error('Error fetching verifiers:', error);
      }
    };
    fetchVerifiers();
  }, [api]);

  const handleVerifierClick = (id) => {
    const clicked = verifiers.find(v => v.id === id);
    if (clicked) { setSelectedVerifier(clicked); setShowRedirectPopup(true); }
  };

  const handleCancel = () => { setShowRedirectPopup(false); setSelectedVerifier(null); };

  const handleContinue = () => {
    syncPrivateData()
      .then(() => {
        setLoading(true);
        if (selectedVerifier) window.location.href = selectedVerifier.url;
        setLoading(false);
        setShowRedirectPopup(false);
      })
      .catch(console.error);
  };

  return (
    <>
      <div className="px-6 sm:px-12 w-full">
        <H1 heading={t('common.navItemSendCredentials')} />
        <PageDescription description={t('share via BLE')} />
        <BleQrPanel />
        {verifiers && (
          <QueryableList
            isOnline={isOnline}
            list={verifiers.map(verifier => ({
              ...verifier,
              displayNode: (searchQuery) => (
                <EntityListItem primaryData={{ name: verifier.name }} searchQuery={searchQuery} />
              ),
            }))}
            queryField="name"
            translationPrefix="pageShareCredentials"
            identifierField="id"
            onClick={handleVerifierClick}
          />
        )}
      </div>
      {showRedirectPopup && (
        <RedirectPopup
          loading={loading}
          onClose={handleCancel}
          handleContinue={handleContinue}
          popupTitle={`${t('pageShareCredentials.popup.title')} ${selectedVerifier?.name}`}
          popupMessage={
            <Trans
              i18nKey="pageShareCredentials.popup.message"
              values={{ verifierName: selectedVerifier?.name ?? 'Unknown' }}
              components={{ strong: <strong /> }}
            />
          }
        />
      )}
    </>
  );
};

export default ShareCredentials;
