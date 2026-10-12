import type React from 'react';
import { useRef } from 'react';
import { CSSTransition } from 'react-transition-group';

export default function FadeInContentTransition({
	children,
	reanimateKey,
}: {
	appear?: boolean;
	children?: React.ReactNode;
	// biome-ignore lint/suspicious/noExplicitAny: baseline: pre-existing debt. should be fixed
	reanimateKey?: any;
}) {
	const nodeRef = useRef(null);
	return (
		<CSSTransition
			appear
			in={true}
			timeout={400}
			classNames="content-fade-in"
			nodeRef={nodeRef}
			key={reanimateKey}
		>
			<div ref={nodeRef}>{children}</div>
		</CSSTransition>
	);
}
