import React from 'react';

const ShowQrCode = () => {
	const [text, setText] = React.useState<string | null>(null);

	React.useEffect(() => {
		void (async () => {
			const startResult = await window.nativeWrapper.proximityStart?.({ mode: 'central' });
			setText(JSON.stringify(startResult, null, 2));
		})();
	}, []);

	return (
		<pre>
			{text}
		</pre>
	);
};

export default ShowQrCode;
