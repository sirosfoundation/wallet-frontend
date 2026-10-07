import React, { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRoundIcon } from 'lucide-react';
import { UsbStickDotIcon } from '@/components/Shared/CustomIcons';
import StatusContext from '@/context/StatusContext';
import Button, { Variant } from '../Buttons/Button';

export default function PasskeyButtons({ mode, isSubmitting }: { mode: 'login' | 'signup'; isSubmitting: boolean }) {
	const { t } = useTranslation();
	const { isOnline } = useContext(StatusContext);
	const isLogin = mode === 'login';

	const buttons: { label: string; Icon: React.ElementType; variant: Variant; hint?: string }[] = [
		{ label: isLogin ? t('loginSignup.loginWithPasskey') : t('loginSignup.signUpWithPasskey'), Icon: KeyRoundIcon, variant: 'primary' },
		{ label: isLogin ? t('loginSignup.loginWithSecurityKey') : t('loginSignup.signUpWithSecurityKey'), Icon: UsbStickDotIcon, variant: 'outline', hint: 'security-key' },
	];

	return (
		<>
			{buttons.map(({ label, Icon, variant, hint }) => (
				<div key={label} className="mt-2 relative w-full flex flex-col justify-center">
					<Button
						id={`${isSubmitting ? 'submitting' : isLogin ? 'loginPasskey' : 'loginSignup.signUpPasskey'}-${hint}-submit-loginsignup`}
						type="submit"
						variant={variant}
						size="lg"
						textSize="md"
						additionalClassName={`items-center justify-center relative passkey-button-${hint}`}
						title={!isLogin && !isOnline && t('common.offlineTitle')}
						value={hint}
					>
						<div className="flex flex-row items-center justify-center w-full">
							<Icon size={20} className="inline text-xl mr-2 shrink-0" />
							{isSubmitting ? t('loginSignup.submitting') : label}
						</div>
					</Button>
				</div>
			))}
		</>
	);
}
