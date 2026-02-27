/**
 * TxCodeInputContext - Promise-based Transaction Code Input
 *
 * Provides a promise-based interface for requesting transaction code input,
 * allowing async/await usage in protocol flows instead of blocking prompt().
 *
 * Usage:
 *   const { requestTxCode } = useTxCodeInput();
 *   const code = await requestTxCode({ description: '...', length: 6 });
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import type { TxCodeConfig } from '@/components/Popups/TxCodeInputPopup';

export interface TxCodeInputState {
  isOpen: boolean;
  config: TxCodeConfig;
}

export interface TxCodeInputContextValue {
  /** Request transaction code input - returns promise that resolves with code or rejects on cancel */
  requestTxCode: (config: TxCodeConfig) => Promise<string>;
  /** Current state for rendering the popup */
  state: TxCodeInputState;
  /** Handle user submission */
  handleSubmit: (code: string) => void;
  /** Handle user cancellation */
  handleCancel: () => void;
}

const TxCodeInputContext = createContext<TxCodeInputContextValue | null>(null);

export function useTxCodeInput(): TxCodeInputContextValue {
  const context = useContext(TxCodeInputContext);
  if (!context) {
    throw new Error('useTxCodeInput must be used within TxCodeInputProvider');
  }
  return context;
}

/**
 * Safe version that returns null if not within provider
 */
export function useTxCodeInputSafe(): TxCodeInputContextValue | null {
  return useContext(TxCodeInputContext);
}

interface PendingRequest {
  resolve: (code: string) => void;
  reject: (error: Error) => void;
}

export function TxCodeInputProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<TxCodeInputState>({
    isOpen: false,
    config: {},
  });

  const pendingRef = useRef<PendingRequest | null>(null);

  const requestTxCode = useCallback((config: TxCodeConfig): Promise<string> => {
    return new Promise((resolve, reject) => {
      // Store the promise handlers
      pendingRef.current = { resolve, reject };

      // Open the popup with config
      setState({
        isOpen: true,
        config,
      });
    });
  }, []);

  const handleSubmit = useCallback((code: string) => {
    if (pendingRef.current) {
      pendingRef.current.resolve(code);
      pendingRef.current = null;
    }
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleCancel = useCallback(() => {
    if (pendingRef.current) {
      pendingRef.current.reject(new Error('User cancelled transaction code input'));
      pendingRef.current = null;
    }
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const value: TxCodeInputContextValue = {
    requestTxCode,
    state,
    handleSubmit,
    handleCancel,
  };

  return (
    <TxCodeInputContext.Provider value={value}>
      {children}
    </TxCodeInputContext.Provider>
  );
}

export default TxCodeInputContext;
