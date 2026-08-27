// src/utils/MdocZkpService.ts

import { COSEKeyToJWK } from "cose-kit";
import * as jose from "jose";
import { cborEncode, cborDecode, DataItem } from "@auth0/mdl/lib/cbor";
const hexToBuf = (hex: string): Uint8Array =>
    new Uint8Array(hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));

const bufToHex = (buf: Uint8Array): string =>
    Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');

const uint8ToBase64 = (arr: Uint8Array): string =>
    btoa(String.fromCharCode(...arr));

// Manual CBOR helpers
const cborText = (s: string): Uint8Array => {
    const bytes = new TextEncoder().encode(s);
    const len = bytes.length;
    let header: Uint8Array;
    if (len < 24) header = new Uint8Array([0x60 | len]);
    else if (len < 256) header = new Uint8Array([0x78, len]);
    else header = new Uint8Array([0x79, len >> 8, len & 0xff]);
    const result = new Uint8Array(header.length + bytes.length);
    result.set(header);
    result.set(bytes, header.length);
    return result;
};

const cborBool = (v: boolean): Uint8Array => new Uint8Array([v ? 0xf5 : 0xf4]);

const cborBytes = (bytes: Uint8Array): Uint8Array => {
    const len = bytes.length;
    let header: Uint8Array;
    if (len < 24) header = new Uint8Array([0x40 | len]);
    else if (len < 256) header = new Uint8Array([0x58, len]);
    else header = new Uint8Array([0x59, len >> 8, len & 0xff]);
    const result = new Uint8Array(header.length + bytes.length);
    result.set(header);
    result.set(bytes, header.length);
    return result;
};

const cborUint = (n: number): Uint8Array => {
    if (n < 24) return new Uint8Array([n]);
    if (n < 256) return new Uint8Array([0x18, n]);
    return new Uint8Array([0x19, n >> 8, n & 0xff]);
};

const concat = (...arrays: Uint8Array[]): Uint8Array => {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) { result.set(a, offset); offset += a.length; }
    return result;
};

export interface ZkpConfig {
    circuitHash: string;
    version: number;
    numAttributes: number;
    verifierContext: string;
    transcriptHex: string;
    docType: string;
    namespace: string;
    zkSystemId: string;
}

export const DEFAULT_PID_ZKP_CONFIG: ZkpConfig = {
    circuitHash: "bb8e6a26d2700ddad968562d1c4aee83067772fee6f889748a0bc64f2c694ad5",
    version: 8,
    numAttributes: 2,
    verifierContext: "766572696669657240636c69656e742e6578616d706c652e636f6d0000000000",
    transcriptHex: "83f6f6847142726f7773657248616e646f76657276315820f93ebac4ce4d9901b9aea472145ae5421f8fbecbe5f0389683f59f08fcf90e455833a363636174016474797065016764657461696c73a1676261736555726c75687474703a2f2f6c6f63616c686f73743a3830383058203c79914b7f81a1c2558fc81619dd4a074d32143e6cf6895fe47da156d1c5b0ae",
    docType: "eu.europa.ec.eudi.pid.1",
    namespace: "eu.europa.ec.eudi.pid.1",
    zkSystemId: "longfellow-libzk-v1_8_2_4307_2945_bb8e6a26d2700ddad968562d1c4aee83067772fee6f889748a0bc64f2c694ad5",
};

export async function generateDeviceSignature(
    keystore: any,
    mdocHex: string,
    transcriptHex: string,
    docTypeStr: string,
    decode: (bytes: Uint8Array) => any,
): Promise<string> {
    // Get device private key from MSO
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
 
    const calculatedState = keystore.getCalculatedWalletState();
    const foundKeypair = calculatedState.keypairs.find((k: any) => k.kid === kid);
    if (!foundKeypair) throw new Error("Key pair not found for kid: " + kid);

    const { privateKey: privateKeyJwk } = foundKeypair.keypair;
    const privKey = await crypto.subtle.importKey(
        "jwk", privateKeyJwk,
        { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
    );

    // Build CBOR docType
    const docTypeBytes = new TextEncoder().encode(docTypeStr);
    const docTypeLen = docTypeBytes.length;
    let docTypeHeader: Uint8Array;
    if (docTypeLen < 24) docTypeHeader = new Uint8Array([0x60 | docTypeLen]);
    else if (docTypeLen < 256) docTypeHeader = new Uint8Array([0x78, docTypeLen]);
    else docTypeHeader = new Uint8Array([0x79, docTypeLen >> 8, docTypeLen & 0xff]);
    const docTypeCbor = concat(docTypeHeader, docTypeBytes);

    // Build TBS
    const sig1_header = hexToBuf("846a5369676e61747572653143a1012640");
    const devAuth_label = hexToBuf("847444657669636541757468656e7469636174696f6e");
    const transcript = hexToBuf(transcriptHex);
    const dns = hexToBuf("d81841a0");

    const inner = concat(devAuth_label, transcript, docTypeCbor, dns);

    let payload: Uint8Array;
    if (inner.length < 256) {
        payload = concat(new Uint8Array([0xd8, 0x18, 0x58, inner.length]), inner);
    } else {
        payload = concat(new Uint8Array([0xd8, 0x18, 0x59, inner.length >> 8, inner.length & 0xff]), inner);
    }

    let tbs_bytes: Uint8Array;
    if (payload.length < 256) {
        tbs_bytes = concat(sig1_header, new Uint8Array([0x58, payload.length]), payload);
    } else {
        tbs_bytes = concat(sig1_header, new Uint8Array([0x59, payload.length >> 8, payload.length & 0xff]), payload);
    }

    const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: { name: "SHA-256" } },
        privKey,
        tbs_bytes
    );

    return bufToHex(new Uint8Array(signature));
}

export function signMdocWithPlaceholder(originalMdocHex: string, rawSignatureHex: string): string {
    const EMPTY_PLACEHOLDER = "8443a10126a0f640";
    const signedMdocHex = originalMdocHex.replace(
        EMPTY_PLACEHOLDER,
        "8443a10126a0f65840" + rawSignatureHex
    );
    if (signedMdocHex === originalMdocHex) {
        console.warn("⚠️ Empty placeholder not found in mdoc");
    }
    return signedMdocHex;
}

export function buildCombinedDeviceResponse(zkDocumentsArray: Uint8Array): Uint8Array {
    const versionKey = new Uint8Array([0x67, 0x76, 0x65, 0x72, 0x73, 0x69, 0x6f, 0x6e]);
    const versionVal = new Uint8Array([0x63, 0x31, 0x2e, 0x30]);
    const statusKey = new Uint8Array([0x66, 0x73, 0x74, 0x61, 0x74, 0x75, 0x73]);
    const statusVal = new Uint8Array([0x00]);
    const zkDocsKey = new Uint8Array([0x6b, 0x7a, 0x6b, 0x44, 0x6f, 0x63, 0x75, 0x6d, 0x65, 0x6e, 0x74, 0x73]);
    const mapHeader = new Uint8Array([0xa3]);

    const parts = [mapHeader, versionKey, versionVal, statusKey, statusVal, zkDocsKey, zkDocumentsArray];
    const totalLen = parts.reduce((s, p) => s + p.length, 0);
    const combined = new Uint8Array(totalLen);
    let offset = 0;
    for (const p of parts) { combined.set(p, offset); offset += p.length; }
    return combined;
}