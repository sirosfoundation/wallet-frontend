import type { IOIDFlowTransport } from "../types";

export class OIDFlowTransportDecorator<T extends IOIDFlowTransport> {
	private transport: IOIDFlowTransport;

	constructor(transport: T) {
		this.transport = transport;
	}

	static from<T extends IOIDFlowTransport>(transport: T): OIDFlowTransportDecorator<T> {
		return new OIDFlowTransportDecorator(transport);
	}

	with<D extends IOIDFlowTransport, O>(
		Decorator: new (t: IOIDFlowTransport, options?: O) => D,
		options?: O
	): OIDFlowTransportDecorator<T & D> {
		this.transport = new Decorator(this.transport, options);
		return this as unknown as OIDFlowTransportDecorator<T & D>;
	}

	build(): T {
		return this.transport as T;
	}
}
