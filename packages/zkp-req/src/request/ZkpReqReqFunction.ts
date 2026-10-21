import { SerializedReqFunction } from '../resources';
import { IZkpReqReqFunction, JsonValue } from '../types';

/**
 * @todo consider folding this into ZkpReqRequest, if it doesn't do
 * 			 anything on it's own (right now just holds the data).
 */
export class ZkpReqReqFunction implements IZkpReqReqFunction {
	readonly fnId: string;
	readonly return: string;
	readonly params?: Record<string, JsonValue>;

	constructor(options: {
		fnId: string;
		return: string;
		params?: Record<string, JsonValue>,
	}) {
		this.fnId = options.fnId;
		this.return = options.return;
		this.params = options.params;
	}

	serialize(): SerializedReqFunction {
		return {
			fn_id: this.fnId,
			return: this.return,
			params: this.params,
		};
	}
}
