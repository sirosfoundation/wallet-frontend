// AppProvider.tsx
import type React from 'react';
import type { ReactNode } from 'react';

// Import i18next and set up translations
import { I18nextProvider } from 'react-i18next';
import { AppSettingsProvider } from './context/AppSettingsProvider';
import { CredentialsContextProvider } from './context/CredentialsContextProvider';
import { ErrorDialogContextProvider } from './context/ErrorDialogContextProvider';
import { NotificationProvider } from './context/NotificationProvider';
import { OIDFlowTransportProvider } from './context/OIDFlowTransportContext';
import { OpenID4VPContextProvider } from './context/OpenID4VPContextProvider';
import { SessionContextProvider } from './context/SessionContextProvider';
// Contexts
import { StatusContextProvider } from './context/StatusContextProvider';
import { TxCodeInputProvider } from './context/TxCodeInputContext';
import { WalletCompanionProvider } from './context/WalletCompanionContext';
import { WebSocketSignHandlerProvider } from './context/WebSocketSignHandlerProvider';
import { WscdManagerClientContextProvider } from './context/WscdManagerClientContextProvider';
import i18n from './i18n';

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
							<WscdManagerClientContextProvider>
								<OIDFlowTransportProvider>
									<WebSocketSignHandlerProvider>
										<OpenID4VPContextProvider>
											<TxCodeInputProvider>
												<NotificationProvider>
													<WalletCompanionProvider>
														<AppSettingsProvider>{children}</AppSettingsProvider>
													</WalletCompanionProvider>
												</NotificationProvider>
											</TxCodeInputProvider>
										</OpenID4VPContextProvider>
									</WebSocketSignHandlerProvider>
								</OIDFlowTransportProvider>
							</WscdManagerClientContextProvider>
						</CredentialsContextProvider>
					</SessionContextProvider>
				</StatusContextProvider>
			</ErrorDialogContextProvider>
		</I18nextProvider>
	);
};

export default AppProvider;
