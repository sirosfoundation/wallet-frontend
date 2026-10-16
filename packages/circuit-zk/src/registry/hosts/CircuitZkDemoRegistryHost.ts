import { CircuitZkHostPriority, CircuitZkRegistryHosts } from '../../resources';
import type {
	CircuitArtifactRef,
	CircuitZkSelection,
	CircuitZkSelectionCriteria,
	ICircuitZkRegistryHost,
} from '../../types';

// Minimal slice of a go-zk-circuits manifest entry (demo only).
type DemoEntry = {
	id: string;
	system: string;
	systemVersion: string;
	status: 'active' | 'deprecated' | 'revoked';
	published: boolean;
	presentation: string;
	credentialType: string;
	functionIds: string[];
	artifact: CircuitArtifactRef;
};

const BASE = 'https://api.circuits.siros.org';

const MANIFEST: DemoEntry[] = [
	{
		id: 'nymauth-longfellow-mdoc-v1',
		system: 'longfellow-nymauth',
		systemVersion: '61a8a73',
		status: 'active',
		published: true,
		presentation: 'circuit_zk',
		credentialType: 'eu.europa.ec.eudi.nym_auth.1',
		functionIds: ['pseudonym-v1-sha256', 'age_check'],
		artifact: {
			url: `${BASE}/v1/artifacts/sha256/6c4b96ed431ee547a3a2e5b62621943a9a0a44646267653bf2db0fcc269b5c3b`,
			hash: 'sha256:6c4b96ed431ee547a3a2e5b62621943a9a0a44646267653bf2db0fcc269b5c3b',
			compression: 'zstd',
		},
	},
];

/**
 * Development/test host: serves a hardcoded manifest instead of fetching the
 * catalogue. Matching is deliberately simplified (doctype + function ids only).
 */
export class CircuitZkDemoRegistryHost implements ICircuitZkRegistryHost {
	readonly id = CircuitZkRegistryHosts.IN_PAGE;
	readonly priority = CircuitZkHostPriority.IN_PAGE;

	async initialize(): Promise<void> {}

	async isAvailable(): Promise<boolean> {
		return true;
	}

	async selectCircuit(
		criteria: CircuitZkSelectionCriteria,
	): Promise<CircuitZkSelection | null> {
		const requested = criteria.req.map((f) => f.fn_id);

		const match = MANIFEST.find(
			(e) =>
				e.status === 'active' &&
				e.published &&
				e.presentation === 'circuit_zk' &&
				e.credentialType === criteria.doctype &&
				requested.every((id) => e.functionIds.includes(id)),
		);

		if (!match) return null;

		return {
			circuitId: match.id,
			proofSystem: match.system,
			proofSystemVersion: match.systemVersion,
			artifact: match.artifact,
		};
	}
}
