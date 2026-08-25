import { describe, expect, it } from "vitest";
import * as cbor from "cbor-x";
import { base64url } from "jose";
import { cborDecode, cborEncode, DataItem } from "@auth0/mdl/lib/cbor";
import { extractDocTypeFromIssuerAuth, extractIssuerSignedB64 } from "./mdoc";

/**
 * `extractDocTypeFromIssuerAuth` reads docType from the MSO (MobileSecurityObject)
 * embedded in a bare IssuerSigned structure's `issuerAuth` COSE_Sign1 payload -
 * needed because IssuerSigned itself has no docType field. Per ISO 18013-5
 * §9.1.2.4, the payload is a bstr whose content decodes to a tag-24-wrapped
 * bstr, which itself decodes to the actual MSO map - two nested decode steps,
 * confirmed against a real geneva2026.mdoc.online credential.
 */
function buildIssuerAuth(docType: string): unknown[] {
	const msoBytes = cbor.encode({ docType });
	const taggedMsoBytes = cbor.encode(new cbor.Tag(msoBytes, 24));
	return [
		new Uint8Array(0), // protected headers (opaque to the wallet)
		{}, // unprotected headers
		taggedMsoBytes, // payload
		new Uint8Array(64), // signature (opaque to the wallet)
	];
}

describe("extractDocTypeFromIssuerAuth", () => {
	it("extracts docType from a tag-24-wrapped MSO payload", () => {
		const issuerAuth = buildIssuerAuth("org.iso.18013.5.1.mDL");
		expect(extractDocTypeFromIssuerAuth(issuerAuth)).toBe("org.iso.18013.5.1.mDL");
	});

	it("works for any docType, not just mDL", () => {
		const issuerAuth = buildIssuerAuth("eu.europa.ec.eudi.pid.1");
		expect(extractDocTypeFromIssuerAuth(issuerAuth)).toBe("eu.europa.ec.eudi.pid.1");
	});

	it("also accepts an MSO payload without the tag-24 wrapper", () => {
		const msoBytes = cbor.encode({ docType: "org.iso.23220.photoid.1" });
		const issuerAuth = [new Uint8Array(0), {}, msoBytes, new Uint8Array(64)];
		expect(extractDocTypeFromIssuerAuth(issuerAuth)).toBe("org.iso.23220.photoid.1");
	});

	it("throws when issuerAuth has no payload", () => {
		expect(() => extractDocTypeFromIssuerAuth([new Uint8Array(0), {}])).toThrow();
	});

	it("throws when the MSO is missing docType", () => {
		const msoBytes = cbor.encode({ somethingElse: "value" });
		const taggedMsoBytes = cbor.encode(new cbor.Tag(msoBytes, 24));
		const issuerAuth = [new Uint8Array(0), {}, taggedMsoBytes, new Uint8Array(64)];
		expect(() => extractDocTypeFromIssuerAuth(issuerAuth)).toThrow();
	});
});

/**
 * `extractIssuerSignedB64` exists to keep a stored credential's COSE integer
 * header labels intact on the way to a verifier.
 *
 * The path it replaced decoded with cbor-x's defaults, which turn CBOR maps
 * into plain JavaScript objects. Object keys can only be strings, so
 * re-encoding wrote issuerAuth's x5chain label 33 back as the text string
 * "33". Byte strings survive that round-trip, so the payload and signature
 * looked untouched and the credential still verified as signed - but a
 * verifier looking for the certificate chain found none. The unprotected
 * header is not covered by the COSE signature, so nothing upstream noticed.
 */
describe("extractIssuerSignedB64", () => {
	/** Builds a base64url IssuerSigned whose x5chain label is the integer 33. */
	function buildIssuerSignedB64(): string {
		const issuerAuth = [
			cborEncode(new Map<number, number>([[1, -7]])), // protected: alg ES256
			new Map<number, Uint8Array[]>([[33, [new Uint8Array([1, 2, 3])]]]), // x5chain
			cborEncode(DataItem.fromData(new Map([["docType", "org.iso.18013.5.1.mDL"]]))),
			new Uint8Array(64),
		];
		const issuerSigned = new Map<string, unknown>([
			["nameSpaces", new Map()],
			["issuerAuth", issuerAuth],
		]);
		return base64url.encode(cborEncode(issuerSigned));
	}

	/** Reads back the label type of issuerAuth's unprotected header key. */
	function unprotectedLabels(b64: string): unknown[] {
		const issuerSigned = cborDecode(base64url.decode(b64)) as Map<string, unknown>;
		const issuerAuth = issuerSigned.get("issuerAuth") as unknown[];
		const unprotected = issuerAuth[1] as Map<unknown, unknown>;
		return [...unprotected.keys()];
	}

	it("returns a bare IssuerSigned untouched, byte for byte", () => {
		const input = buildIssuerSignedB64();
		// Identity, not merely equivalence: the bytes the issuer signed reach
		// the verifier exactly as issued, with no opportunity to alter them.
		expect(extractIssuerSignedB64(input)).toBe(input);
	});

	it("keeps the x5chain label an integer for a bare IssuerSigned", () => {
		const out = extractIssuerSignedB64(buildIssuerSignedB64());
		expect(unprotectedLabels(out)).toEqual([33]);
	});

	it("keeps the x5chain label an integer when unwrapping a DeviceResponse", () => {
		const issuerSigned = cborDecode(base64url.decode(buildIssuerSignedB64()));
		const envelope = new Map<string, unknown>([
			["version", "1.0"],
			["documents", [new Map<string, unknown>([
				["docType", "org.iso.18013.5.1.mDL"],
				["issuerSigned", issuerSigned],
			])]],
			["status", 0],
		]);

		const out = extractIssuerSignedB64(base64url.encode(cborEncode(envelope)));
		expect(unprotectedLabels(out)).toEqual([33]);
	});

	it("does not produce the string label that broke verification", () => {
		// The regression this guards: a decimal-string label reaches verifiers
		// as a credential carrying no certificate chain.
		const out = extractIssuerSignedB64(buildIssuerSignedB64());
		expect(unprotectedLabels(out)).not.toContain("33");
	});

	it("returns the input unchanged when the CBOR is not a map at all", () => {
		// Defensive: a corrupt or unexpected credential should pass through
		// rather than throw here, so the failure surfaces in the parser with
		// the credential in hand instead of inside this helper.
		const notAMap = base64url.encode(cborEncode(["not", "a", "map"]));
		expect(extractIssuerSignedB64(notAMap)).toBe(notAMap);
	});

	it("returns the input unchanged when a document carries no issuerSigned", () => {
		const envelope = new Map<string, unknown>([
			["version", "1.0"],
			["documents", [new Map<string, unknown>([["docType", "org.iso.18013.5.1.mDL"]])]],
			["status", 0],
		]);
		const input = base64url.encode(cborEncode(envelope));
		expect(extractIssuerSignedB64(input)).toBe(input);
	});

	it("shows why cbor-x's defaults cannot be used here", () => {
		// Documents the exact mechanism, so the reason this helper exists is
		// not lost if someone later simplifies it back to a plain round-trip.
		const original = base64url.decode(buildIssuerSignedB64());
		const roundTripped = cbor.encode(cbor.decode(original));

		const issuerSigned = cborDecode(roundTripped) as Map<string, unknown>;
		const issuerAuth = issuerSigned.get("issuerAuth") as unknown[];
		const unprotected = issuerAuth[1] as Map<unknown, unknown>;

		expect([...unprotected.keys()]).toEqual(["33"]);
	});
});
