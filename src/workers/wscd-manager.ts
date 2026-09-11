import init, { WscdManagerJs } from '@sirosfoundation/wscd-manager-wasm';
import wasmUrl from '@sirosfoundation/wscd-manager-wasm/siros_wscd_manager_bg.wasm?url';

const ready = (async () => {
	await init({ module_or_path: wasmUrl });

	return new WscdManagerJs();
})();

globalThis.onmessage = async ({ data }: MessageEvent) => {
	const wscd = await ready;

	// TODO: actually do something useful.
	// Tough, wasm running in a worker is pretty
	//   ______   ______     ______    __
	//  /      | /  __  \   /  __  \  |  |
	// |  ,----'|  |  |  | |  |  |  | |  |
	// |  |     |  |  |  | |  |  |  | |  |
	// |  `----.|  `--'  | |  `--'  | |  `----.
	//  \______| \______/   \______/  |_______|

	globalThis.postMessage({ result: await wscd.listKeys() });
};
