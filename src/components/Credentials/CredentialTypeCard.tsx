import { type FC } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type Display = {
	name: string;
	issuer?: string;
	logo?: string;
	backgroundColor?: string;
	textColor?: string;
};

export type CredentialTypeCardProps = {
	display: Display | Display[];
	onClick?: () => void;
	chevron?: boolean;
	compact?: boolean;
};

export const CredentialTypeCard: FC<CredentialTypeCardProps> = ({
	display,
	onClick,
	chevron = true,
	compact = false,
}) => {
	const { t } = useTranslation();
	const isClickable = !!onClick,
		showChevron = !!onClick && chevron;

	const Element = isClickable ? 'button' : 'div';

	if (!Array.isArray(display)) display = [display];
	if (display.length === 0) return null;

	return (
		<Element
			className={`
				relative flex w-full items-center justify-between gap-4
				p-2 rounded-lg
				[button]:cursor-pointer
				[button]:hover:brightness-[0.85]
				[button]:dark:hover:brightness-[1.15]
				${
					isClickable &&
					`
					shadow-xs text-lm-gray-900 dark:text-white
					bg-lm-gray-200 dark:bg-dm-gray-800
					border border-lm-gray-700 dark:border-dm-gray-400
				`
				}
			`}
			onClick={onClick}
			aria-label={
				isClickable ? t('credentialTypeCard.selectAriaLabel', { name: display[0].name }) : undefined
			}
		>
			<div className="flex flex-col justify-start items-start gap-2 w-full min-w-0">
				{display.map(({ name, issuer, logo, backgroundColor, textColor }) => (
					<span key={name} className="flex justify-start items-start gap-2 w-full min-w-0">
						{!compact && (
							<div
								className="
									aspect-square h-16 text-2xl p-1 flex justify-center
									items-center border border-lm-gray-400
									dark:border-dm-gray-600 rounded-md shrink-0
								"
								style={!logo ? { backgroundColor, color: textColor } : undefined}
							>
								{logo ? (
									<img src={logo} alt="" className="max-h-full max-w-full align-middle inline" />
								) : (
									<p className="font-bold">{name.charAt(0)}</p>
								)}
							</div>
						)}
						<div className="py-1 flex flex-col justify-start items-start gap-3 w-full min-w-0">
							<span
								className="
									flex w-full px-2 py-1 text-sm rounded-md items-center gap-2
									font-bold bg-primary text-white
									whitespace-nowrap justify-between
								"
								style={{ backgroundColor, color: textColor }}
							>
								{name}
								{compact && logo && (
									<img src={logo} alt="" className="max-h-8 max-w-8 align-middle inline" />
								)}
							</span>
							{!compact && issuer && (
								<span
									className="
										px-2 truncate max-w-full text-lm-gray-700 dark:text-dm-gray-300 text-sm
									"
								>
									{issuer}
								</span>
							)}
						</div>
					</span>
				))}
			</div>
			{showChevron && <ChevronRightIcon aria-hidden="true" className="shrink-0" />}
		</Element>
	);
};
