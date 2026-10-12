import { QrCode } from 'lucide-react';
// biome-ignore lint/correctness/noUnusedImports: baseline: pre-existing debt. should be fixed
import React from 'react';
import useScreenType from '../../hooks/useScreenType';
import Button from './Button';

// biome-ignore lint/correctness/noUnusedFunctionParameters: baseline: pre-existing debt. should be fixed
const QRButton = ({ openQRScanner, isSmallScreen }) => {
	const screenType = useScreenType();

	if (screenType === 'tablet') {
		return (
			<div className="mb-2">
				<Button
					id="open-qr-scanner"
					onClick={openQRScanner}
					variant="primary"
					additionalClassName={`step-2`}
				>
					<QrCode size={20} className="text-inherit" />
				</Button>
			</div>
		);
	}

	return null;
};

export default QRButton;
