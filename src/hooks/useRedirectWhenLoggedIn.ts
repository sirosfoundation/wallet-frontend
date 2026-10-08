import { useContext, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import SessionContext from '@/context/SessionContext';
import { useTenant } from '@/context/TenantContext';
import { buildTenantRoutePath, matchesTenantFromUrl } from '@/lib/tenant';
import { getReturnToUrl } from '@/lib/utils/returnToUrl';

export function useRedirectWhenLoggedIn(honourReturnTo: boolean) {
	const { isLoggedIn } = useContext(SessionContext);
	const { urlTenantId, effectiveTenantId } = useTenant();
	const navigate = useNavigate();
	const location = useLocation();

	useEffect(() => {
		if (!isLoggedIn) return;

		const redirect = async () => {
			const returnTo = getReturnToUrl();
			const target = (honourReturnTo ? returnTo : null)
				?? buildTenantRoutePath(effectiveTenantId, `/${location.search}`);

			if (matchesTenantFromUrl(effectiveTenantId, urlTenantId)) { await navigate(target, { replace: true }); }
			else {
				window.location.href = target; 
			}
		};
		void redirect();
	}, [isLoggedIn, honourReturnTo, effectiveTenantId, urlTenantId, navigate, location.search]);
}
