import { describe, expect, it } from "vitest";
import * as cbor from "cbor-x";
import { extractDocTypeFromIssuerAuth } from "./mdoc";

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
