import { type FC } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type CredentialTypeCardProps = {
	name: string;
	description?: string;
	logo?: string;
	backgroundColor?: string;
	textColor?: string;
	onClick?: () => void;
	chevron?: boolean;
}

export const CredentialTypeCard: FC<CredentialTypeCardProps> = ({
	name,
	description,
	logo,
	backgroundColor,
	textColor,
	onClick,
	chevron = true,
}) => {
	const { t } = useTranslation();
	const
		isClickable = !!onClick,
		showChevron = !!onClick && chevron;

	const Element = isClickable ? 'button' : 'div';

	return (
		<Element
			className="
				flex w-full items-center justify-between gap-4
				p-2 rounded-lg border shadow-xs
				text-lm-gray-900 dark:text-white
				bg-lm-gray-200 dark:bg-dm-gray-800
				border-lm-gray-700 dark:border-dm-gray-400
				[button]:cursor-pointer
				[button]:hover:brightness-[0.85]
				[button]:dark:hover:brightness-[1.15]
			"
			onClick={onClick}
			aria-label={isClickable ? t('credentialTypeCard.selectAriaLabel', { name }) : undefined}
		>
			<span className="flex justify-start items-start gap-2 w-full">
				<div
					className="
						aspect-square h-16 text-2xl p-1 flex justify-center
						items-center border border-lm-gray-400
						dark:border-dm-gray-600 rounded-md shrink-0
					"
					style={!logo ? { backgroundColor, color: textColor } : undefined}
				>
					{logo ? (
						<img
							src={logo}
							alt=""
							className="max-h-full max-w-full align-middle inline"
						/>
					) : (
						<p className="font-bold">{name.charAt(0)}</p>
					)}
				</div>
				<div className="py-1 flex flex-col justify-start items-start gap-3 w-full">
					<span
						className="
							flex w-full px-2 py-1 text-sm rounded-md items-center gap-2
							font-bold bg-lm-gray-300 dark:bg-dm-gray-700
							whitespace-nowrap
						"
						style={{ backgroundColor, color: textColor }}
					>
						{name}
					</span>
					{description && (
						<span
							className="
								px-2 truncate text-lm-gray-700 dark:text-dm-gray-300 text-sm
							"
						>
							{description}
						</span>
					)}
				</div>
			</span>
			{showChevron && <ChevronRightIcon aria-hidden="true" />}
		</Element>
	);
};
