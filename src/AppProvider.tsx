// AppProvider.tsx
import React, { ReactNode } from 'react';

// Import i18next and set up translations
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n';

// Contexts
import { StatusContextProvider } from './context/StatusContextProvider';
import { SessionContextProvider } from './context/SessionContextProvider';
import { CredentialsContextProvider } from './context/CredentialsContextProvider';
import { OpenID4VPContextProvider } from './context/OpenID4VPContextProvider';
import { OpenID4VCIContextProvider } from './context/OpenID4VCIContextProvider';
import { AppSettingsProvider } from './context/AppSettingsProvider';
import { NotificationProvider } from './context/NotificationProvider';
import { OIDFlowTransportProvider } from './context/OIDFlowTransportContext';
import { WebSocketSignHandlerProvider } from './context/WebSocketSignHandlerProvider';
import { ErrorDialogContextProvider } from './context/ErrorDialogContextProvider';
import { TxCodeInputProvider } from './context/TxCodeInputContext';
import { WalletCompanionProvider } from './context/WalletCompanionContext';

type RootProviderProps = {
	children: ReactNode;
};

const AppProvider: React.FC<RootProviderProps> = ({ children }) => {
	return (
		<I18nextProvider i18n={i18n}>
			<ErrorDialogContextProvider>
				<StatusContextProvider>
					<SessionContextProvider>
						<CredentialsContextProvider>
							<OIDFlowTransportProvider>
								<WebSocketSignHandlerProvider>
									<OpenID4VPContextProvider>
										<OpenID4VCIContextProvider>
											<TxCodeInputProvider>
												<NotificationProvider>
													<WalletCompanionProvider>
														<AppSettingsProvider>
															{children}
														</AppSettingsProvider>
													</WalletCompanionProvider>
												</NotificationProvider>
											</TxCodeInputProvider>
										</OpenID4VCIContextProvider>
									</OpenID4VPContextProvider>
								</WebSocketSignHandlerProvider>
							</OIDFlowTransportProvider>
						</CredentialsContextProvider>
					</SessionContextProvider>
				</StatusContextProvider>
			</ErrorDialogContextProvider>
		</I18nextProvider>
	);
};

export default AppProvider;
