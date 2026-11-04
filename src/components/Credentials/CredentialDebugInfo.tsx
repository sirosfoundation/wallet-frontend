import { FC } from 'react';
import { TokenStatus } from '@sirosfoundation/token-status-list';
import type { ExtendedVcEntity } from '@/context/CredentialsContext';

const statusLabel = (status?: TokenStatus) =>
	status === undefined ? 'unchecked' : TokenStatus.label(status);

export const CredentialDebugInfo: FC<{ vcEntity: ExtendedVcEntity }> = ({ vcEntity }) => {
	const { batchId, format, instances, status, isExpired, isBatchExhausted } = vcEntity;
	const usedCount = instances.filter((i) => i.sigCount > 0).length;

	const summary: [string, string][] = [
		['Batch', String(batchId)],
		['Format', format || '-'],
		['Instances', `${instances.length} (${usedCount} used)`],
		['Batch status', statusLabel(status)],
		['Expired', String(isExpired)],
		['Exhausted', String(isBatchExhausted)],
	];

	return (
		<div className="w-full py-2 text-sm text-lm-gray-900 dark:text-dm-gray-100 flex flex-col gap-4">
			<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
				{summary.map(([label, value]) => (
					<div key={label} className="contents">
						<dt className="font-semibold">{label}</dt>
						<dd className="break-all">{value}</dd>
					</div>
				))}
			</dl>

			<div className="overflow-x-auto border border-lm-gray-400 dark:border-dm-gray-600 rounded-lg">
				<table className="min-w-full text-left whitespace-nowrap">
					<thead className="border-b border-lm-gray-400 dark:border-dm-gray-600">
						<tr>
							<th className="px-2 py-1">Instance</th>
							<th className="px-2 py-1">Credential ID</th>
							<th className="px-2 py-1">Status</th>
							<th className="px-2 py-1">Signed</th>
							<th className="px-2 py-1">Status list</th>
						</tr>
					</thead>
					<tbody>
						{[...instances]
							.sort((a, b) => a.instanceId - b.instanceId)
							.map((instance) => (
								<tr key={instance.credentialId} className="border-b last:border-b-0 border-lm-gray-400 dark:border-dm-gray-600">
									<td className="px-2 py-1">{instance.instanceId}</td>
									<td className="px-2 py-1">{instance.credentialId}</td>
									<td className="px-2 py-1">{statusLabel(instance.status)}</td>
									<td className="px-2 py-1">{instance.sigCount}</td>
									<td className="px-2 py-1">
										{instance.statusList
											? `${instance.statusList.uri} #${instance.statusList.idx}`
											: '-'}
									</td>
								</tr>
							))}
					</tbody>
				</table>
			</div>
		</div>
	);
};

export default CredentialDebugInfo;
