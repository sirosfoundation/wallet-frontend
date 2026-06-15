// AppProvider.tsx
import React, { ReactNode } from 'react';

// Import i18next and set up translations
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n';

// Contexts
import { StatusContextProvider } from './context/StatusContextProvider';
import { SessionContextProvider } from './context/SessionContextProvider';
import { CredentialsContextProvider } from './context/CredentialsContextProvider';
import { AppSettingsProvider } from './context/AppSettingsProvider';
import { NotificationProvider } from './context/NotificationProvider';
import { OIDFlowTransportProviderWrapper } from './context/OIDFlowTransportProviderWrapper';
import { WebSocketSignHandlerProvider } from './context/WebSocketSignHandlerProvider';
import { ErrorDialogContextProvider } from './context/ErrorDialogContextProvider';
import { TxCodeInputProvider } from './context/TxCodeInputContext';
import { WalletCompanionProvider } from './context/WalletCompanionContext';

type RootProviderProps = {
	children: ReactNode;
};

const AppProvider: React.FC<RootProviderProps> = ({ children }) => {
	return (
		<StatusContextProvider>
			<SessionContextProvider>
				<CredentialsContextProvider>
					<OIDFlowTransportProviderWrapper>
						<WebSocketSignHandlerProvider>
							<I18nextProvider i18n={i18n}>
								<ErrorDialogContextProvider>
									<TxCodeInputProvider>
										<NotificationProvider>
											<WalletCompanionProvider>
												<AppSettingsProvider>
													{children}
												</AppSettingsProvider>
											</WalletCompanionProvider>
										</NotificationProvider>
									</TxCodeInputProvider>
								</ErrorDialogContextProvider>
							</I18nextProvider>
						</WebSocketSignHandlerProvider>
					</OIDFlowTransportProviderWrapper>
				</CredentialsContextProvider>
			</SessionContextProvider>
		</StatusContextProvider>
	);
};

export default AppProvider;
