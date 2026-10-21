// ============================================
// Request (after parsing by wallet)
// ============================================

/**
 * Generic JSON value.
 */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

/**
 * No `return`: an assertion only.
 *
 * @dcql_path `credentials.[]._req.[]`
 */
export type ReqItem = {
	fn_id: string;
	return?: string;
	params?: Record<string, JsonValue>;
};

/**
 * @dcql_path `credentials.[].trusted_authorities`
 */
export type TrustedAuthority = {
	type: 'aki' | 'etsi_tl' | 'openid_federation' | (string & {});
	values: string[];
};

export type MdocMeta = { doctype_value: string };
export type SdJwtMeta = { vct_values: string[] };
export type W3cMeta = { type_values: string[][] };

/**
 * @dcql_path `credentials.[].meta`
 */
export type ZkpMeta =
	| ({ source_format: 'mso_mdoc' } & MdocMeta)
	| ({ source_format: 'dc+sd-jwt' } & SdJwtMeta)
	| ({ source_format: 'jwt_vc_json' | 'ldp_vc' } & W3cMeta)
	| ({ source_format: string } & Record<string, unknown>);

/**
 * @dcql_path `credentials.[]`
 */
export type ZkpQuery = {
	meta: ZkpMeta;
	_req: ReqItem[];
	trusted_authorities?: TrustedAuthority[];
	/**
	 * Absent means true. Each system decides whether it accepts false.
	 */
	require_cryptographic_holder_binding?: boolean;
};

/**
 * @dcql_path `client_metadata.vp_formats_supported.zkp_req`.
 */
export type ZkpFormats = {
	proof_system_values?: string[];
	system_id_values?: string[];
};

export type PresentationSession = {
	/**
	 * CBOR Handover of the channel the request arrived on (OpenID4VP 1.0 B.2.6).
	 */
	handover: Uint8Array;
	nonce: string;
	/**
	 * In the form the trust framework fixes.
	 */
	verifier_id: string;
};

/**
 * One `zkp_req` query.
 */
export type ZkpRequest = {
	query: ZkpQuery;
	formats: ZkpFormats;
};

// ============================================
// What the wallet provides
// ============================================

/**
 * One entry per credential: any one instance of a batch.
 */
export type StoredCredential = {
	id: string;
	format: string;
	/**
	 * As issued; the presenter decodes it.
	 */
	data: string;
	kid: string;
};

/**
 * Everything the presenter learns from outside: it is sandboxed and pure.
 */
export interface WalletContext {
	/**
	 * May return a superset of the matches, never omits one. Called with `meta` less `source_format`.
	 */
	credentials(format: string, meta: Record<string, JsonValue>): Promise<StoredCredential[]>;
	/**
	 * Uninterpreted metadata stored at issuance. Prove only.
	 */
	metadata(credential_id: string): Promise<object>;
	/**
	 * DER certificates of the anchors these authorities designate.
	 */
	anchors(authorities: TrustedAuthority[]): Promise<Uint8Array[]>;
	/**
	 * Device key; `alg` is a JOSE name. Rejects "cancelled" | "unavailable".
	 */
	sign(kid: string, alg: string, data: Uint8Array): Promise<Uint8Array>;
	/**
	 * Secure randomness, fresh on every call.
	 */
	random(length: number): Uint8Array;
	/**
	 * Current time according to the wallet's clock.
	 */
	now(): Date;
}

// ============================================
// Results
// ============================================


/**
 * `inputs`: parameters the user supplies, by `_req` index and parameter name.
 */
export type Candidate = {
	credential_id: string;
	system_id: string;
	proof_system: string;
	inputs?: { index: number; name: string }[];
};

/**
 * The user's values: `[_req index][parameter name]`.
 */
export type Inputs = Record<number, Record<string, unknown>>;

/**
 * For display only, never sent.
 */
export type ItemError = {
	kind: 'item';
	index: number;
	param?: string;
	/**
	 * The system's own code.
	 */
	code: string;
};

/**
 * The credential's mandatory check failed: validity, issuer signature, trust chain or device-key binding.
 */
export type CredentialError = {
	kind: 'credential';
	code: string;
};

export type ZkpError = ItemError | CredentialError;

/**
 * A rejected one may have no system.
 */
export type Judged = Partial<Candidate> & { credential_id: string };

export type Match =
	| { candidates: [Candidate, ...Candidate[]] }
	| { rejected: { candidate: Judged; errors: [ZkpError, ...ZkpError[]] }[] }
	| { refused: 'unsupported' | 'invalid'; errors: ItemError[] };

export type ProveError = {
	reason: 'failed' | 'cancelled' | 'unavailable';
	candidate: Candidate;
	errors?: [ZkpError, ...ZkpError[]];
};

/**
 * `proof` is opaque; the verifier's library reads the results out of it.
 *
 * @todo Check `issuer_key_set`, `proof_time` and `results` against the draft;
 * 			 the nym_auth rulebook encodes them in the presentation.
 */
export type ZkpPresentation = {
	system_id: string;
	proof_system: string;
	proof: Uint8Array;
	issuer_key_set?: [Uint8Array, ...Uint8Array[]];
	proof_time?: Date;
	/**
	 * Keys are the `return` handles in `_req`.
	 */
	results?: Record<string, Uint8Array | true>;
};

// ============================================
// exports
// ============================================

/**
 * The opaque presenter. Stateless: `prove` gets everything it needs again, nothing is kept from `match`.
 */
export interface ZkpPresenter {
	match(req: ZkpRequest): Promise<Match>;
	/**
	 * `inputs`: one value per entry of `c.inputs`. Rejects with a {@link ProveError}.
	 */
	prove(
		c: Candidate,
		req: ZkpRequest,
		session: PresentationSession,
		inputs?: Inputs,
		signal?: AbortSignal,
	): Promise<ZkpPresentation>;
}

/**
 * Once per wallet; the implementation brings its systems.
 */
export declare function create_zkp_presenter(wallet: WalletContext): ZkpPresenter;

// ============================================
// Wallet integration
// ============================================

/**
 * The OpenID4VP error the wallet sends when the request cannot be presented.
 */
export type ZkpReqFailureCode =
	| 'invalid_request'
	| 'vp_formats_not_supported'
	| 'access_denied';

/**
 * `ready`: show the one consent screen. `failed`: show the errors, then send `code`.
 */
export type ZkpReqMatchResult =
	| { kind: 'ready'; candidates: Map<string, Candidate> }
	| { kind: 'failed'; code: ZkpReqFailureCode; matches: Map<string, Match> };

/**
 * Presents the `zkp_req` queries of one OpenID4VP request:
 * `match`, then the wallet's one consent screen, then `prove`.
 */
export interface IZkpReq {
	match(): Promise<ZkpReqMatchResult>;
	/**
	 * Proves the candidates kept by the last `ready` match.
	 */
	prove(
		session: PresentationSession,
		inputs?: Map<string, Inputs>,
		signal?: AbortSignal,
	): Promise<Map<string, ZkpPresentation>>;
}

/**
 * What {@link IZkpReq} talks to. Hands each call to an available {@link IZkpPresenterHost}.
 */
export interface IZkpPresenterClient {
	match(request: ZkpRequest): Promise<Match>;
	/**
	 * Rejects with a `ZkpProveError`.
	 */
	prove(
		candidate: Candidate,
		request: ZkpRequest,
		session: PresentationSession,
		inputs?: Inputs,
		signal?: AbortSignal,
	): Promise<ZkpPresentation>;
	dispose(): Promise<void>;
}

/**
 * Runs a {@link ZkpPresenter} in one environment, e.g. the page or the native wrapper.
 */
export interface IZkpPresenterHost {
	readonly id: string;
	/**
	 * Higher wins when several hosts are available.
	 */
	readonly priority: number;
	initialize(wallet: WalletContext): Promise<void>;
	isAvailable(): Promise<boolean>;
	match(request: ZkpRequest): Promise<Match>;
	/**
	 * Rejects with a `ZkpProveError`, wrapping the presenter's {@link ProveError}.
	 */
	prove(
		candidate: Candidate,
		request: ZkpRequest,
		session: PresentationSession,
		inputs?: Inputs,
		signal?: AbortSignal,
	): Promise<ZkpPresentation>;
	dispose?(): Promise<void>;
}

