import { CLOCK_TOLERANCE, VCT_REGISTRY_URL, DELEGATE_TRUST_TO_BACKEND } from "../config";
import { IHttpClient } from "./interfaces/IHttpClient";
import { ParsingEngine, SDJWTVCParser, PublicKeyResolverEngine, SDJWTVCVerifier, MsoMdocParser, MsoMdocVerifier, JWTVCJSONParser, JWTVCJSONVerifier, VCDM2JoseParser, VCDM2JoseVerifier, VCDM2LdpParser, VCDM2LdpVerifier, VCDM2SdJwtParser, VCDM2SdJwtVerifier, VerifyingEngine, IAuthZENClient } from "wallet-common";
import { IOpenID4VCIHelper } from "./interfaces/IOpenID4VCIHelper";
import { createVctDocumentResolutionEngine, VctDocumentProvider, VctResolutionErrors, ok, err } from 'wallet-common';
import { logger } from '@/logger';

export async function initializeCredentialEngine(
	httpProxy: IHttpClient,
	helper: IOpenID4VCIHelper,
	getIssuers: () => Promise<Record<string, unknown>[]>,
	trustedCertificates: string[] = [],
	shouldUseCache: boolean = true,
	onIssuerMetadataResolved?: (issuerIdentifier: string) => void,
	authzenClient?: IAuthZENClient,
): Promise<any> {

	const provider: VctDocumentProvider = {
		getVctMetadataDocument: async (vct: string) => {
			try {
				if (!VCT_REGISTRY_URL) return err(VctResolutionErrors.NotFound);
				const url = new URL(VCT_REGISTRY_URL);
				url.searchParams.set('vct', vct);
				const res = await httpProxy.get(url.toString(), {}, { useCache: true });
				if (!res?.data || res.status!==200) return err(VctResolutionErrors.NotFound);
				return ok(res.data as any);
			} catch (e) {
				logger.error('Error in VCT SDJWT Metadata retrieval:', e);
				return err(VctResolutionErrors.NotFound);
			}
		},
	};

	const vctDocumentProvider = createVctDocumentResolutionEngine([provider]);

	const ctx = {
		clockTolerance: CLOCK_TOLERANCE,
		subtle: crypto.subtle,
		lang: 'en-US',
		trustedCertificates,
		delegateTrustToBackend: DELEGATE_TRUST_TO_BACKEND,
		vctResolutionEngine: vctDocumentProvider
	};

	await helper.fetchIssuerMetadataAndCertificates(
		getIssuers,
		shouldUseCache,
		(issuerIdentifier) => {
			onIssuerMetadataResolved?.(issuerIdentifier);
		}
	).catch((err) => {
		logger.error("Failed to fetch issuer metadata asynchronously:", err);
	});

	const credentialParsingEngine = ParsingEngine();
	// Before SDJWTVCParser: a VCDM 2.0 credential carried in an SD-JWT (DIIP
	// v5) is advertised as `vc+sd-jwt`, the same identifier legacy SD-JWT VC
	// uses, but has no `vct`. SDJWTVCParser would claim it and reject it for
	// exactly that missing `vct`.
	credentialParsingEngine.register(VCDM2SdJwtParser({ context: ctx, httpClient: httpProxy, authzenClient }));
	credentialParsingEngine.register(SDJWTVCParser({ context: ctx, httpClient: httpProxy, authzenClient }));
	credentialParsingEngine.register(MsoMdocParser({ context: ctx, httpClient: httpProxy, authzenClient }));
	// VCDM 2.0 before JWT_VC_JSON: an enveloped VCDM 2.0 credential is a
	// plain JWS whose payload has no `vc` wrapper, so JWTVCJSONParser would
	// otherwise reject it outright rather than deferring.
	credentialParsingEngine.register(VCDM2JoseParser({ context: ctx, httpClient: httpProxy, authzenClient }));
	credentialParsingEngine.register(VCDM2LdpParser({ context: ctx, httpClient: httpProxy, authzenClient }));
	credentialParsingEngine.register(JWTVCJSONParser({ context: ctx, httpClient: httpProxy, authzenClient }));

	const pkResolverEngine = PublicKeyResolverEngine();
	const credentialVerifyingEngine = VerifyingEngine();
	// Ahead of SDJWTVCVerifier, which resolves the issuer key from an `iss`
	// claim that a VCDM 2.0 credential need not carry.
	credentialVerifyingEngine.register(VCDM2SdJwtVerifier({ context: ctx, pkResolverEngine: pkResolverEngine, httpClient: httpProxy }));
	credentialVerifyingEngine.register(SDJWTVCVerifier({ context: ctx, pkResolverEngine: pkResolverEngine, httpClient: httpProxy }));
	credentialVerifyingEngine.register(MsoMdocVerifier({ context: ctx, pkResolverEngine: pkResolverEngine }));
	// Order matters more here: JWTVCJSONVerifier claims *any* non-SD-JWT
	// compact JWS, and would resolve the issuer key from an `iss` claim that
	// a VCDM 2.0 credential does not have.
	credentialVerifyingEngine.register(VCDM2JoseVerifier({ context: ctx, pkResolverEngine: pkResolverEngine, httpClient: httpProxy }));
	credentialVerifyingEngine.register(VCDM2LdpVerifier({ context: ctx, pkResolverEngine: pkResolverEngine, httpClient: httpProxy }));
	credentialVerifyingEngine.register(JWTVCJSONVerifier({ context: ctx, pkResolverEngine: pkResolverEngine, httpClient: httpProxy }));

	return { credentialParsingEngine, credentialVerifyingEngine };
}
