// FullscreenImg.js

import { XCircle } from 'lucide-react';
// biome-ignore lint/correctness/noUnusedImports: baseline: pre-existing debt. should be fixed
import React from 'react';
import Modal from 'react-modal';

const FullscreenImg = ({ isOpen, onClose, content }) => {
	return (
		<Modal
			isOpen={isOpen}
			onRequestClose={onClose}
			className="relative mx-2"
			overlayClassName="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50"
		>
			{content}
			{/** biome-ignore lint/a11y/useButtonType: baseline: pre-existing debt. should be fixed */}
			<button
				id="close-full-screen-img"
				className="fixed top-4 right-4 text-white text-2xl z-50"
				onClick={onClose}
			>
				<XCircle size={40} />
			</button>
		</Modal>
	);
};

export default FullscreenImg;
