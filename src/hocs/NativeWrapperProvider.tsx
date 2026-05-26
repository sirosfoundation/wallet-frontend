import React, { useContext, useEffect } from "react";

import { useLocalStorageKeystore } from "../services/LocalStorageKeystore";
import keystoreEvents from "../services/keystoreEvents";
import CredentialsContext, {
	ExtendedVcEntity,
} from "@/context/CredentialsContext";
import { logger } from "@/logger";
import {
	extractAvailableClaims,
	shapeCredential,
} from "@/services/CredentialMatchingService";
import { getCredentialType } from "@/components/QueryableList/CredentialsDisplayUtils";

/**
 * Display properties for credential UI in Android's credential selector
 */
interface CredentialDisplayProperties {
	title: string;
	subtitle?: string;
	icon?: string; // Base64 encoded image or URL
}

/**
 * SD-JWT credential entry for OpenId4VpRegistry
 * Maps to androidx.credentials.registry.digitalcredentials.sdjwt.SdJwtEntry
 */
interface SdJwtRegistryEntry {
	format: "sd-jwt";
	/**
	 * Unique identifier - should be encrypted/opaque
	 */
	id: string;
	/**
	 * Verifiable Credential Type (vct claim from SD-JWT)
	 */
	verifiableCredentialType: string;
	/**
	 * List of available claim names
	 */
	claims: string[];
	/**
	 * Display properties for the credential selector UI
	 */
	display: CredentialDisplayProperties;
}

/**
 * mDOC credential entry for OpenId4VpRegistry
 * Maps to androidx.credentials.registry.digitalcredentials.mdoc.MdocEntry
 */
interface MdocRegistryEntry {
	format: "mdoc";
	/**
	 * Unique identifier - should be encrypted/opaque
	 */
	id: string;
	/**
	 * Document type (e.g., "org.iso.18013.5.1.mDL")
	 */
	docType: string;
	/**
	 * Available fields as namespace.element pairs
	 */
	fields: { namespace: string; element: string }[];
	/**
	 * Display properties for the credential selector UI
	 */
	display: CredentialDisplayProperties;
}

/**
 * Union type for all credential registry entries
 */
type CredentialRegistryEntry = SdJwtRegistryEntry | MdocRegistryEntry;

declare global {
	interface Window {
		nativeWrapper?: NativeWrapper;
	}

	interface NativeWrapper {
		updateAllCredentials(credentials: string): void;
		isKeystoreOpen(): Promise<boolean>;
		startScanPhysicalId?(): void;
	}
}

export const NativeWrapperProvider = ({
	children,
}: React.PropsWithChildren) => {
	const keystore = useLocalStorageKeystore(keystoreEvents);
	const { vcEntityList } = useContext(CredentialsContext);

	useEffect(() => {
		if (window.nativeWrapper) {
			window.nativeWrapper.isKeystoreOpen = async () => keystore.isOpen();
		}
	}, [keystore]);

	useEffect(() => {
		(async () => {
			const registryEntries =
				await prepareCredentialsForNativeWrapper(vcEntityList);
			logger.debug("Updated native wrapper with credentials:", registryEntries);
			window.nativeWrapper.updateAllCredentials(JSON.stringify(registryEntries));
		})();
	}, [vcEntityList]);

	return children;
};

const REGISTRY_RESERVED_CLAIMS = new Set([
	"iss",
	"iat",
	"exp",
	"nbf",
	"vct",
	"cnf",
	"jti",
	"status",
	"arf",
	"vct#integrity",
	"trust_anchor",
]);

async function prepareCredentialsForNativeWrapper(
	credentials: ExtendedVcEntity[],
	preferredLangs: string[] = ["en-US"],
): Promise<CredentialRegistryEntry[]> {
	const entries: CredentialRegistryEntry[] = [];

	for (const credential of credentials) {
		const shaped = shapeCredential(credential);
		if (!shaped) continue;

		// Get display info
		const credentialNameFn =
			credential.parsedCredential?.metadata?.credential?.name;
		const title = credentialNameFn
			? await credentialNameFn(preferredLangs)
			: getCredentialType(credential.parsedCredential) || "Credential";
		const issuerName = credential.parsedCredential?.metadata?.issuer?.name;

		const display: CredentialDisplayProperties = {
			title: title ?? "Credential",
			subtitle: issuerName ? `Issued by ${issuerName}` : undefined,
		};

		if (shaped.credential_format === "mso_mdoc") {
			const fields: { namespace: string; element: string }[] = [];
			for (const [ns, elements] of Object.entries(shaped.namespaces)) {
				for (const element of Object.keys(elements as object)) {
					fields.push({ namespace: ns, element });
				}
			}
			entries.push({
				format: "mdoc",
				id: String(credential.batchId),
				docType: shaped.doctype,
				fields,
				display,
			});
		} else {
			// SD-JWT
			entries.push({
				format: "sd-jwt",
				id: String(credential.batchId),
				verifiableCredentialType: shaped.vct,
				claims: extractAvailableClaims(credential).filter((claim) => {
					const rootKey = claim.split(".")[0];
					return !REGISTRY_RESERVED_CLAIMS.has(rootKey);
				}),
				display,
			});
		}
	}

	return entries;
}
