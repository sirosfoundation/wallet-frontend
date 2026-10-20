import { CircleXIcon, TriangleAlertIcon } from 'lucide-react';
import { FC } from 'react';

const STATUS_MAP = {
	expired: {
		icon: CircleXIcon,
		color: 'red',
		title: 'Credential expired',
		description: 'This credential has expired and requires reissuance.',
	},
	batchExhausted: {
		icon: TriangleAlertIcon,
		color: 'orange',
		title: 'Depleted',
		description: 'No uses remaining.',
	},
}

export type CredentialImageStatusOverlayProps = {
	status: keyof typeof STATUS_MAP;
}

export const CredentialImageStatusOverlay: FC<CredentialImageStatusOverlayProps> = ({
	status,
}) => {
	const { icon: Icon, color, title, description } = STATUS_MAP[status];

	return (
		<div
			className="
				absolute top-0 left-0 w-full h-full p-4
				flex items-center justify-center flex-col gap-2
				bg-black/50 backdrop-blur-[2px] backdrop-grayscale rounded-lg
				text-sm font-bold
			"
		>
			<p
				className={`
					py-1 px-4 flex justify-center items-center rounded-full
					bg-lm-gray-200 dark:bg-dm-gray-800
					text-lm-${color} dark:text-dm-${color}
					border-2 border-lm-${color} dark:border-dm-${color}
				`}
			>
				<Icon size={18} className="inline-block mr-1" />
				{title}
			</p>
			<p className="text-white max-w-75">
				{description}
			</p>
		</div>
	);
};
