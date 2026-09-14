import init, { WscdManagerJs } from '@sirosfoundation/wscd-manager-wasm';
import wasmUrl from '@sirosfoundation/wscd-manager-wasm/siros_wscd_manager_bg.wasm?url';
import { WorkerMessage } from './types';

const ready = (async () => {
	await init({ module_or_path: wasmUrl });

	return new WscdManagerJs();
})();

globalThis.onmessage = async ({ data }: MessageEvent<WorkerMessage>) => {
	const wscd = await ready;

	try {
		let result: unknown;

		switch (data.action) {
			case 'import_container':
				wscd.importContainer(data.container);
				break;
			case 'export_container':
				result = wscd.exportContainer();
				break;
			case 'sign_request':
				result = await wscd.sign(data.kid, data.data);
				break;
		}
		globalThis.postMessage({
			id: data.id,
			result
		});
	} catch (err) {
		globalThis.postMessage({
			id: data.id,
			error: err instanceof Error ? err.message : String(err)
		});
	}
};
