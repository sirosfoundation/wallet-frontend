export enum CredentialParsingError {
	UnsupportedFormat = 'UnsupportedFormat',
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	CouldNotParse = 'CouldNotParse',
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	InvalidSdJwtVcPayload = 'InvalidSdJwtVcPayload',
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	InvalidJwtVcJsonPayload = 'InvalidJwtVcJsonPayload',
	InvalidDatatype = 'InvalidDatatype',
	NotSupportedCredentialType = 'NotSupportedCredentialType',
	InfiniteRecursion = 'InfiniteRecursion',
	VctmDecodeFail = 'VctmDecodeFail',
	UnknownError = 'UnknownError',
	NotFound = 'NotFound',
	NotFoundExtends = 'NotFoundExtends',
	IntegrityMissing = 'IntegrityMissing',
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	JwtVcIssuerMismatch = 'JwtVcIssuerMismatch',
	IntegrityFail = 'IntegrityFail',
	SchemaShapeFail = 'SchemaShapeFail',
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	JwtVcIssuerFail = 'JwtVcIssuerFail',
	FailFetchIssuerMetadata = 'FailFetchIssuerMetadata',
	FailSchemaIssuerMetadata = 'FailSchemaIssuerMetadata',
	InvalidVcdm2Credential = 'InvalidVcdm2Credential',
}

export const CredentialParsingWarnings = new Set<CredentialParsingError>([
	CredentialParsingError.NotFound,
	CredentialParsingError.NotFoundExtends,
	CredentialParsingError.IntegrityMissing,
	CredentialParsingError.JwtVcIssuerMismatch,
	CredentialParsingError.IntegrityFail,
	CredentialParsingError.JwtVcIssuerFail,
	CredentialParsingError.FailFetchIssuerMetadata,
	CredentialParsingError.FailSchemaIssuerMetadata,
]);

export function isCredentialParsingWarnings(code: CredentialParsingError): boolean {
	return CredentialParsingWarnings.has(code);
}

export enum GetMatchingCredentialsError {
	PresentationDefinitionParseError = 'PresentationDefinitionParseError',
}

export enum ValidatePresentationRequirementsError {
	PresentationSubmissionParameterIsMissing = 'PresentationSubmissionParameterIsMissing',
	ConstraintsAreNotSatisfied = 'ConstraintsAreNotSatisfied',
	PresentationSubmissionParsingFailed = 'PresentationSubmissionParsingFailed',
	FailedToParseAtLeastOnePresentation = 'FailedToParseAtLeastOnePresentation',
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	InvalidVpToken = 'InvalidVpToken',
	CredentialParsingError = 'CredentialParsingError',
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	CouldNotFindAssociatedInputDescriptorBasedOnPresentationSubmission = 'CouldNotFindAssociatedInputDescriptorBasedOnPresentationSubmission',
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	CouldNotVerifyParsedCredentialWithInputDescriptor = 'CouldNotVerifyParsedCredentialWithInputDescriptor',
	UnsupportedFormat = 'UnsupportedFormat',
}

export enum CredentialVerificationError {
	UnknownProblem = 'UnknownProblem',
	VerificationProcessNotStarted = 'VerificationProcessNotStarted', // will be used when the verifier functions cannot start the verification process because of format
	InvalidDatatype = 'InvalidDatatype',
	InvalidFormat = 'InvalidFormat',
	MissingOpts = 'MissingOpts',
	InvalidCertificateChain = 'InvalidCertificateChain',

	InvalidSignature = 'InvalidSignature',
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	CannotResolveIssuerPublicKey = 'CannotResolveIssuerPublicKey',
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	CannotImportIssuerPublicKey = 'CannotImportIssuerPublicKey',
	NotTrustedIssuer = 'NotTrustedIssuer',
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	VctRegistryNotConfigured = 'VctRegistryNotConfigured',

	ExpiredCredential = 'ExpiredCredential',

	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	CannotImportHolderPublicKey = 'CannotImportHolderPublicKey',
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	CannotExtractHolderPublicKey = 'CannotExtractHolderPublicKey',

	// KBJWT related
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	KbJwtVerificationFailedMissingParameters = 'KbJwtVerificationFailedMissingParameters',
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	KbJwtVerificationFailedWrongSdHash = 'KbJwtVerificationFailedWrongSdHash',
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	KbJwtVerificationFailedUnexpectedAudience = 'KbJwtVerificationFailedUnexpectedAudience',
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	KbJwtVerificationFailedUnexpectedNonce = 'KbJwtVerificationFailedUnexpectedNonce',
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	KbJwtVerificationFailedSignatureValidation = 'KbJwtVerificationFailedSignatureValidation',

	// MSO MDOC related
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	MsoMdocMissingDeviceKeyInfo = 'MsoMdocMissingDeviceKeyInfo',
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	MsoMdocInvalidDeviceSignature = 'MsoMdocInvalidDeviceSignature',

	// W3C VCDM 2.0 Data Integrity related
	MissingDataIntegrityProof = 'MissingDataIntegrityProof',
	UnsupportedCryptosuite = 'UnsupportedCryptosuite',
	CanonicalizationFailed = 'CanonicalizationFailed',
	UnresolvableJsonLdContext = 'UnresolvableJsonLdContext',
}

export enum PublicKeyResolutionError {
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	CannotResolvePublicKey = 'CannotResolvePublicKey',
}

export enum CredentialRenderingError {
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	IntegrityCheckFailed = 'IntegrityCheckFailed',
	// biome-ignore lint/security/noSecrets: baseline: pre-existing debt. should be fixed
	CouldNotFetchSvg = 'CouldNotFetchSvg',
}
