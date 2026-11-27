import React from 'react';
import { ChevronRight } from 'lucide-react';

type OptionCardProps = {
	id: string;
	icon: React.ComponentType<{ size?: number; className?: string }>;
	title: string;
	description: string;
	onClick: () => void;
	disabled?: boolean;
	badge?: string;
};

const OptionCard = ({ id, icon: Icon, title, description, onClick, disabled = false, badge }: OptionCardProps) => (
	<button
		id={id}
		type="button"
		onClick={onClick}
		disabled={disabled}
		className={`w-full flex items-center gap-4 p-3 rounded-lg border border-lm-gray-700 dark:border-dm-gray-400 bg-lm-gray-200 dark:bg-dm-gray-800 text-left transition-all ${disabled ? 'grayscale opacity-75 cursor-not-allowed' : 'cursor-pointer hover:brightness-[0.97] dark:hover:brightness-[1.15]'}`}
	>
		<div className="shrink-0 flex items-center justify-center w-14 h-14 rounded-md bg-primary text-white">
			<Icon size={32} aria-hidden="true" />
		</div>

		<div className="flex-1 min-w-0">
			<p className="font-semibold text-lm-gray-900 dark:text-white">
				{title}
				{badge && (
					<span className="ml-2 text-xs font-normal px-2 py-0.5 rounded-full bg-lm-gray-400 dark:bg-dm-gray-600">
						{badge}
					</span>
				)}
			</p>
			<p className="text-sm text-lm-gray-700 dark:text-dm-gray-300 mt-0.5">{description}</p>
		</div>

		<ChevronRight size={22} aria-hidden="true" className="shrink-0 text-primary dark:text-white" />
	</button>
);

export default OptionCard;