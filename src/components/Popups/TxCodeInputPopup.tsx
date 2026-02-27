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

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
        {/* Header */}
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          {t('txCodeInput.title', 'Transaction Code Required')}
        </h2>

        {/* Description */}
        <p className="text-gray-600 dark:text-gray-300 mb-4">
          {description || t('txCodeInput.defaultDescription', 'Enter the transaction code displayed on your screen')}
        </p>

        {/* Length hint */}
        {length && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
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
          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg
                     text-center text-2xl tracking-widest font-mono
                     bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
        />

        {/* Error message */}
        {error && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {/* Buttons */}
        <div className="mt-6 flex justify-end space-x-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700
                       rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-4 py-2 text-white bg-blue-600 rounded-lg
                       hover:bg-blue-700 transition-colors"
          >
            {t('common.submit', 'Submit')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TxCodeInputPopup;
