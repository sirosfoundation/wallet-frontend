// components/Notifications/NotificationOfflineWarning.tsx

import { TriangleAlert, X } from 'lucide-react';
import type React from 'react';
import { useContext } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import SessionContext from '@/context/SessionContext';
import StatusContext from '@/context/StatusContext';
import { useSessionStorage } from '@/hooks/useStorage';

function NotificationOfflineWarning(): React.ReactElement | null {
	useTranslation(); // This ensures reactivity to language changes

	const { isOnline } = useContext(StatusContext);
	const { api } = useContext(SessionContext);
	const [isMessageOfflineVisible, setIsMessageOfflineVisible] = api.useClearOnClearSession(
		useSessionStorage('isMessageOfflineVisible', false),
	);

	const handleCloseMessageOffline = () => {
		setIsMessageOfflineVisible(true);
	};

	const show = isOnline === false && isMessageOfflineVisible === false;
	// if (!show) return null;

	return show ? (
		<div className="px-6 sm:px-12 w-full">
			<div className="bg-lm-orange-bg dark:bg-dm-orange-bg text-lm-gray-900 shadow-sm p-4 rounded-lg mb-4 flex items-center">
				<div className="mr-4 ">
					<TriangleAlert size={24} />
				</div>

				{isOnline === false && isMessageOfflineVisible === false && (
					<>
						<div className="grow">
							<p className="text-sm">
								<Trans i18nKey="layout.messageOffline" components={{ strong: <strong /> }} />
							</p>
						</div>
						{/** biome-ignore lint/a11y/useButtonType: baseline: pre-existing debt. should be fixed */}
						<button id="close-message-offline" className="ml-2" onClick={handleCloseMessageOffline}>
							<X size={20} />
						</button>
					</>
				)}
			</div>
		</div>
	) : (
		// biome-ignore lint/complexity/noUselessFragments: baseline: pre-existing debt. should be fixed
		<></>
	);
}

export default NotificationOfflineWarning;
