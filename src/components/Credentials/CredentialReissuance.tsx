import { FC } from 'react';
import { TriangleAlertIcon } from 'lucide-react';
import type { ExtendedVcEntity } from '@/context/CredentialsContext';
import Button from '../Buttons/Button';

export type CredentialReissuanceProps = {
	vcEntity: ExtendedVcEntity;
};

export const CredentialReissuance: FC<CredentialReissuanceProps> = ({
	vcEntity,
}) => {
	return (
		<section className="p-3 text-sm rounded-lg flex flex-col gap-3 border border-lm-orange dark:border-dm-orange bg-lm-orange-bg/10 dark:bg-dm-orange-bg/10">
			<div className="flex gap-2">
				<div className="grid place-items-center size-8 rounded-full text-lm-orange">
					<TriangleAlertIcon size={24} />
				</div>
				<h1 className="font-bold text-lg ">Credential requires reissuance</h1>
			</div>
			<p>
				This credential has either expired or the batch has been exhausted and
				requires reissuance.
			</p>
			{/* <div>
				<Button variant="outline">
					Reissue Credential
				</Button>
			</div> */}
		</section>
	);
};
