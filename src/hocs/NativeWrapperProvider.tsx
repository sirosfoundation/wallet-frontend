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
 * Display properties for a single claim/field
 */
interface ClaimDisplayInfo {
	locale: string;
	label: string;
	description?: string;
}

/**
 * Claim with display properties for SD-JWT
 */
interface ClaimWithDisplay {
	path: string;
	display?: ClaimDisplayInfo[];
}

/**
 * Field with display properties for mDOC
 */
interface FieldWithDisplay {
	namespace: string;
	element: string;
	display?: ClaimDisplayInfo[];
}

/**
 * SD-JWT credential entry for OpenId4VpRegistry
 */
interface SdJwtRegistryEntry {
	format: "sd-jwt";
	id: string;
	verifiableCredentialType: string;
	claims: string[];
	claimDisplay: ClaimDisplayMap;
	display: CredentialDisplayProperties;
}

/**
 * mDOC credential entry for OpenId4VpRegistry
 */
interface MdocRegistryEntry {
	format: "mdoc";
	id: string;
	docType: string;
	fields: { namespace: string; element: string }[];
	claimDisplay: ClaimDisplayMap;
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

/**
 * Localized labels for claims: { claimPath: { locale: label } }
 */
type ClaimDisplayMap = Record<string, Record<string, string>>;

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

		const claimMetadata =
			credential.parsedCredential?.metadata?.credential?.TypeMetadata?.claims ?? [];

		// Build claim display map: { claimPath: { locale: label } }
		const claimDisplay: ClaimDisplayMap = {};
		for (const claim of claimMetadata) {
			if (Array.isArray(claim.path) && Array.isArray(claim.display)) {
				const pathKey = claim.path.join(".");
				claimDisplay[pathKey] = {};
				for (const d of claim.display) {
					if (d.locale && d.label) {
						claimDisplay[pathKey][d.locale] = d.label;
					}
				}
			}
		}

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
				claimDisplay,
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
				claimDisplay,
				display,
			});
		}
	}

	return entries;
}
