import { CheckCircle } from 'lucide-react';
// biome-ignore lint/correctness/noUnusedImports: baseline: pre-existing debt. should be fixed
import React from 'react';

const VerificationResult = () => {
	return (
		// biome-ignore lint/complexity/noUselessFragments: baseline: pre-existing debt. should be fixed
		<>
			<div className="flex flex-col items-center justify-center min-h-screen">
				<CheckCircle size={100} className="text-lm-green dark:text-dm-green" />
				<h2 className="mt-4 text-2xl font-bold text-lm-gray-800 dark:text-dm-gray-200">
					Verification Successful!
				</h2>
			</div>
		</>
	);
};

export default VerificationResult;
