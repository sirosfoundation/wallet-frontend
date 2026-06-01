/**
 * TxCodeInputPopup - Transaction Code Input for Pre-Authorized Credential Flows
 *
 * A React popup component for entering transaction codes in OID4VCI pre-authorized
 * credential flows. Supports configurable length validation and input modes.
 *
 * Designed to work with the useTxCodeInput hook for promise-based async/await usage.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import PopupLayout from './PopupLayout';
import Button from '../Buttons/Button';

export interface TxCodeConfig {
	/** Description to display to the user */
	description?: string;
	/** Expected length of the transaction code */
	length?: number;
	/** Input mode: 'numeric' for number pad, 'text' for full keyboard */
	inputMode?: 'numeric' | 'text';
}

export interface TxCodeInputPopupProps {
	/** Whether the popup is visible */
	isOpen: boolean;
	/** Configuration for the transaction code input */
	txCodeConfig: TxCodeConfig;
	/** Called when user submits a valid code */
	onSubmit: (code: string) => void;
	/** Called when user cancels */
	onCancel: () => void;
}

export function TxCodeInputPopup({
	isOpen,
	txCodeConfig,
	onSubmit,
	onCancel,
}: TxCodeInputPopupProps) {
	const { t } = useTranslation();
	const [code, setCode] = useState('');
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const { description, length, inputMode = 'text' } = txCodeConfig;

	// Focus input when popup opens
	useEffect(() => {
		if (isOpen && inputRef.current) {
			inputRef.current.focus();
		}
	}, [isOpen]);

	// Reset state when popup opens/closes
	useEffect(() => {
		if (isOpen) {
			setCode('');
			setError(null);
		}
	}, [isOpen]);

	const handleSubmit = useCallback(() => {
		// Validate input
		if (!code.trim()) {
			setError(t('txCodeInput.errorEmpty', 'Please enter the transaction code'));
			return;
		}

		if (length && code.length !== length) {
			setError(
				t('txCodeInput.errorLength', 'Transaction code must be {{length}} characters', { length })
			);
			return;
		}

		setError(null);
		onSubmit(code.trim());
	}, [code, length, onSubmit, t]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				handleSubmit();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				onCancel();
			}
		},
		[handleSubmit, onCancel]
	);

	return (
		<PopupLayout
			isOpen={isOpen}
			onClose={onCancel}
			shouldCloseOnOverlayClick={false}
		>
			{/* Header */}
			<h2
				id="txcode-dialog-title"
				className="text-xl font-semibold text-lm-gray-900 dark:text-dm-gray-100 mb-4"
			>
				{t('txCodeInput.title', 'Transaction Code Required')}
			</h2>

			{/* Description */}
			<p
				id="txcode-dialog-description"
				className="text-lm-gray-700 dark:text-dm-gray-300 mb-4"
			>
				{description || t('txCodeInput.defaultDescription', 'Enter the transaction code displayed on your screen')}
			</p>

			{/* Length hint */}
			{length && (
				<p className="text-sm text-lm-gray-500 dark:text-dm-gray-400 mb-2">
					{t('txCodeInput.lengthHint', 'Code length: {{length}} characters', { length })}
				</p>
			)}

			{/* Input */}
			<input
				ref={inputRef}
				type="text"
				inputMode={inputMode}
				value={code}
				onChange={(e) => setCode(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder={
					length
						? t('txCodeInput.placeholderWithLength', 'Enter {{length}}-character code', { length })
						: t('txCodeInput.placeholder', 'Enter code')
				}
				maxLength={length}
				className="w-full px-4 py-3 border border-lm-gray-400 dark:border-dm-gray-600 rounded-lg
									text-center text-2xl tracking-widest font-mono
									bg-lm-gray-100 dark:bg-dm-gray-800 text-lm-gray-900 dark:text-dm-gray-100
									focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
				autoComplete="off"
				autoCorrect="off"
				autoCapitalize="off"
				spellCheck="false"
				aria-label={t('txCodeInput.inputLabel', 'Transaction code')}
				aria-invalid={error ? 'true' : 'false'}
				aria-describedby={error ? 'txcode-error' : undefined}
			/>

			{/* Error message */}
			{error && (
				<p id="txcode-error" role="alert" className="mt-2 text-sm text-lm-red-light dark:text-dm-red-light">{error}</p>
			)}

			{/* Buttons */}
			<div className="mt-6 flex justify-end space-x-3">
				<Button
					variant="outline"
					onClick={onCancel}
				>
					{t('common.cancel', 'Cancel')}
				</Button>
				<Button
					variant="primary"
					onClick={handleSubmit}
				>
					{t('common.submit', 'Submit')}
				</Button>
			</div>
		</PopupLayout>
	);
}

export default TxCodeInputPopup;
