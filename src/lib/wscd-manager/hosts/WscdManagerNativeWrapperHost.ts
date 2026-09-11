import { WscdPlugin } from '../resources';
import { IWscdManagerHost } from '../types';

export class WscdManagerNativeWrapperHost implements IWscdManagerHost {
	#providedPlugins: ReadonlySet<WscdPlugin> = new Set([
		WscdPlugin.SOFTKEY,
		WscdPlugin.FIDO2,
		WscdPlugin.R2PS,
	]);
}
