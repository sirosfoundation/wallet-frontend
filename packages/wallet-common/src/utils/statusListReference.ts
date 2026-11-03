import type { StatusListReference } from "../types";

/**
 * Read the IETF Token Status List reference (`status.status_list`) from a
 * credential's `status` claim. Returns undefined when it is absent or invalid.
 */
export function extractStatusListReference(status: unknown): StatusListReference | undefined {
	if (!status || typeof status !== "object") return undefined;

	const list = (status as Record<string, unknown>).status_list;
	if (!list || typeof list !== "object") return undefined;

	const { idx, uri } = list as Record<string, unknown>;
	if (typeof uri !== "string" || typeof idx !== "number") return undefined;
	if (!Number.isSafeInteger(idx) || idx < 0) return undefined;

	return { uri, idx };
}
