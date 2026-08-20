import { describe, expect, it } from "vitest";
import * as cbor from "cbor-x";
import { shapeCredential } from "./CredentialMatchingService";
import { ExtendedVcEntity } from "@/context/CredentialsContext";
import { toBase64Url } from "../util";

/**
 * `shapeCredential` (mso_mdoc branch) must handle both stored-credential
 * shapes seen in practice:
 * - a full DeviceResponse-shaped envelope (`{documents: [{docType,
 *   issuerSigned}], ...}`) - our own vc-issuer's convention.
 * - a bare IssuerSigned structure (`{nameSpaces, issuerAuth}`) directly, with
 *   docType read from the MSO embedded in issuerAuth instead of a docType
 *   field (IssuerSigned has none) - what real-world/interop issuers (e.g.
 *   geneva2026.mdoc.online) send for mso_mdoc credential responses.
 */

function buildIssuerAuth(docType: string): unknown[] {
	const msoBytes = cbor.encode({ docType });
	const taggedMsoBytes = cbor.encode(new cbor.Tag(msoBytes, 24));
	return [new Uint8Array(0), {}, taggedMsoBytes, new Uint8Array(64)];
}

function buildItem(elementIdentifier: string, elementValue: string) {
	const itemBytes = cbor.encode({
		digestID: 0,
		random: new Uint8Array(16),
		elementIdentifier,
		elementValue,
	});
	return new cbor.Tag(itemBytes, 24);
}

function buildNameSpaces(namespace: string) {
	return {
		[namespace]: [buildItem("given_name", "Jane"), buildItem("family_name", "Doe")],
	};
}

function mockMdocCredential(bytes: Uint8Array): ExtendedVcEntity {
	return {
		format: "mso_mdoc",
		data: toBase64Url(bytes),
		batchId: 1,
	} as unknown as ExtendedVcEntity;
}

describe("shapeCredential (mso_mdoc)", () => {
	it("shapes a full DeviceResponse-shaped envelope", () => {
		const docType = "org.iso.18013.5.1.mDL";
		const namespace = "org.iso.18013.5.1";
		const envelope = {
			documents: [{
				docType,
				issuerSigned: { nameSpaces: buildNameSpaces(namespace), issuerAuth: buildIssuerAuth(docType) },
			}],
			status: 0,
		};

		const shaped = shapeCredential(mockMdocCredential(cbor.encode(envelope)));

		expect(shaped).not.toBeNull();
		expect((shaped as any).doctype).toBe(docType);
		expect((shaped as any).namespaces[namespace].given_name).toBe("Jane");
	});

	it("shapes a bare IssuerSigned structure, deriving docType from the MSO", () => {
		const docType = "eu.europa.ec.eudi.pid.1";
		const namespace = "eu.europa.ec.eudi.pid.1";
		const bareIssuerSigned = {
			nameSpaces: buildNameSpaces(namespace),
			issuerAuth: buildIssuerAuth(docType),
		};

		const shaped = shapeCredential(mockMdocCredential(cbor.encode(bareIssuerSigned)));

		expect(shaped).not.toBeNull();
		expect((shaped as any).doctype).toBe(docType);
		expect((shaped as any).namespaces[namespace].family_name).toBe("Doe");
	});

	it("returns null (not throws) for an unparseable mdoc", () => {
		const garbage = cbor.encode({ somethingElse: "value" });
		expect(shapeCredential(mockMdocCredential(garbage))).toBeNull();
	});
});
