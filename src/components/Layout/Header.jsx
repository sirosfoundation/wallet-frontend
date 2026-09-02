import React from 'react';
import { useTranslation } from 'react-i18next';
import ConnectionStatusIcon from './Navigation/ConnectionStatusIcon';
import Logo from '../Logo/Logo';
import { UserCircleIcon } from 'lucide-react';

const Header = ({ sticky = true, alwaysVisible = false, username = null }) => {
	const { t } = useTranslation();

	const headerClassList = [
		sticky && 'sticky',
		sticky && 'top-0',
		sticky && 'z-50',
		'w-full',
		'bg-inherit',
		'text-inherit',
		'flex',
		'items-center',
		'justify-between',
		!alwaysVisible && 'md:hidden',
		'border-b',
		'border-lm-gray-400',
		'dark:border-dm-gray-600',
		'transition-all',
		'duration-300',
		'p-3',
	];

	return (
		<header className={headerClassList.filter(Boolean).join(' ')}>
			{username ? (
				<div className="flex items-center space-x-2  rounded-r-xl">
					<UserCircleIcon className="shrink-0" size={20} title={username} />
					<span
						className="text-overflow-ellipsis text-sm overflow-hidden whitespace-nowrap"
						title={username}
					>
						{username}
					</span>
				</div>
			) : (
				<ConnectionStatusIcon size="small" className="transition-all duration-300" />
			)}
			<div className="flex items-center">
				<Logo
					type="dark"
					aClassName="mr-2"
					imgClassName="cursor-pointer transition-all duration-300 w-8"
				/>
				<a
					href="/"
					className="text-lm-gray-900 dark:text-dm-gray-100 font-bold cursor-pointer transition-all duration-300 text-sm"
				>
					{t('common.walletName')}
				</a>
			</div>
		</header>
	);
};

export default Header;
