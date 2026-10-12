export { ALLOWED_CONTEXT_URLS, createDocumentLoader } from './dataIntegrity/documentLoader';
export { canonicalizeJcs } from './dataIntegrity/jcs';
export {
	base58Decode,
	didKeyToJwk,
	multibaseDecode,
	multikeyToJwk,
} from './dataIntegrity/multibase';
export {
	resolveCryptosuite,
	SupportedCryptosuites,
	verifyDataIntegrityProof,
} from './dataIntegrity/verifyDataIntegrityProof';
export {
	detectCredentialFormat,
	detectCredentialFormat as detectFormat,
	isLdpVc,
	isMdoc,
	isSdJwt,
} from './detectCredentialFormat';
export { getSdJwtVcMetadata } from './getSdJwtVcMetadata';
export * from './util';
export * from './vcdm2';
export * from './vcdm2Presentation';
export { verifyX5C } from './verifyX5C';
