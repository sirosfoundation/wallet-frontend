import { SerializedReqFunction } from '../resources';
import { ICircuitZkReqFunction, JsonValue } from '../types';

/**
 * @todo consider folding this into CircuitZkRequest, if it doesn't do
 * 			 anything on it's own (right now just holds the data).
 */
export class CircuitZkReqFunction implements ICircuitZkReqFunction {
	readonly fnId: string;
	readonly id: string;
	readonly params?: JsonValue;

	constructor(options: {
		fnId: string;
		id: string;
		params?: JsonValue,
	}) {
		this.fnId = options.fnId;
		this.id = options.id;
		this.params = options.params;
	}

	serialize(): SerializedReqFunction {
		return {
			fn_id: this.fnId,
			id: this.id,
			params: this.params,
		};
	}
}
