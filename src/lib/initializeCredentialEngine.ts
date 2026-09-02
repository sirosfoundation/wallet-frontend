import { CLOCK_TOLERANCE, VCT_REGISTRY_URL, DELEGATE_TRUST_TO_BACKEND } from '../config';
import { IHttpClient } from './interfaces/IHttpClient';
import {
	ParsingEngine,
	SDJWTVCParser,
	PublicKeyResolverEngine,
	SDJWTVCVerifier,
	MsoMdocParser,
	MsoMdocVerifier,
	JWTVCJSONParser,
	JWTVCJSONVerifier,
	VerifyingEngine,
	IAuthZENClient,
} from 'wallet-common';
import { IOpenID4VCIHelper } from './interfaces/IOpenID4VCIHelper';
import {
	createVctDocumentResolutionEngine,
	VctDocumentProvider,
	VctResolutionErrors,
	ok,
	err,
} from 'wallet-common';
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
				if (!res?.data || res.status !== 200) return err(VctResolutionErrors.NotFound);
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
		vctResolutionEngine: vctDocumentProvider,
	};

	await helper
		.fetchIssuerMetadataAndCertificates(getIssuers, shouldUseCache, (issuerIdentifier) => {
			onIssuerMetadataResolved?.(issuerIdentifier);
		})
		.catch((err) => {
			logger.error('Failed to fetch issuer metadata asynchronously:', err);
		});

	const credentialParsingEngine = ParsingEngine();
	credentialParsingEngine.register(
		SDJWTVCParser({ context: ctx, httpClient: httpProxy, authzenClient }),
	);
	credentialParsingEngine.register(
		MsoMdocParser({ context: ctx, httpClient: httpProxy, authzenClient }),
	);
	credentialParsingEngine.register(
		JWTVCJSONParser({ context: ctx, httpClient: httpProxy, authzenClient }),
	);

	const pkResolverEngine = PublicKeyResolverEngine();
	const credentialVerifyingEngine = VerifyingEngine();
	credentialVerifyingEngine.register(
		SDJWTVCVerifier({ context: ctx, pkResolverEngine: pkResolverEngine, httpClient: httpProxy }),
	);
	credentialVerifyingEngine.register(
		MsoMdocVerifier({ context: ctx, pkResolverEngine: pkResolverEngine }),
	);
	credentialVerifyingEngine.register(
		JWTVCJSONVerifier({ context: ctx, pkResolverEngine: pkResolverEngine, httpClient: httpProxy }),
	);

	return { credentialParsingEngine, credentialVerifyingEngine };
}
