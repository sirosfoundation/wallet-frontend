/**
 * OID4VCI §11 Credential Notification Utilities
 *
 * Pure utility functions for dispatching credential lifecycle notifications.
 * Extracted from useOID4VCIFlow for testability.
 */

import type { IOIDFlowTransport } from '../types/IOIDFlowTransport';
import type { OID4VCIFlowResult } from '../types/OID4VCITypes';

/**
 * Send `credential_accepted` notifications for each credential that carries a
 * `notification_id`. Delegates to the transport, which decides how (or whether)
 * to deliver the notification to the issuer.
 *
 * This is a pure function — safe to call from hooks, callbacks, or tests.
 */
export function dispatchCredentialNotifications(
	transport: IOIDFlowTransport | null | undefined,
	credentials: OID4VCIFlowResult['credentials'],
	flowId?: string,
): void {
	if (!flowId || !transport) return;
	// One notification_id per Credential Response (§8.3), repeated on every credential in the batch.
	const notificationIds = new Set(
		(credentials ?? []).map(c => c.notification_id).filter((id): id is string => !!id),
	);
	for (const notificationId of notificationIds) {
		transport.sendCredentialNotification(flowId, notificationId, 'credential_accepted');
	}
}
