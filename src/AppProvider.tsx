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
import { AppSettingsProvider } from './context/AppSettingsProvider';
import { NotificationProvider } from './context/NotificationProvider';
import { OIDFlowTransportProvider } from './context/OIDFlowTransportContext';
import { WebSocketSignHandlerProvider } from './context/WebSocketSignHandlerProvider';
import { ErrorDialogContextProvider } from './context/ErrorDialogContextProvider';
import { TxCodeInputProvider } from './context/TxCodeInputContext';
import { WalletCompanionProvider } from './context/WalletCompanionContext';
import { WscdManagerClientContextProvider } from './context/WscdManagerClientContextProvider';
import { TokenStatusListsContextProvider } from './context/TokenStatusListsContextProvider';
import { ActiveTabProvider } from './hocs/ActiveTabProvider';
import { OpenIdReissuanceContextProvider } from './context/OpenIdReissuanceContextProvider';

type RootProviderProps = {
	children: ReactNode;
};

const AppProvider: React.FC<RootProviderProps> = ({ children }) => {
	return (
		<I18nextProvider i18n={i18n}>
			<ErrorDialogContextProvider>
				<StatusContextProvider>
					<AppSettingsProvider>
						<ActiveTabProvider>
							<SessionContextProvider>
								<TokenStatusListsContextProvider>
									<CredentialsContextProvider>
										<WscdManagerClientContextProvider>
											<OIDFlowTransportProvider>
												<WebSocketSignHandlerProvider>
													<OpenID4VPContextProvider>
														<TxCodeInputProvider>
															<NotificationProvider>
																<OpenIdReissuanceContextProvider>
																	<WalletCompanionProvider>
																		{children}
																	</WalletCompanionProvider>
																</OpenIdReissuanceContextProvider>
															</NotificationProvider>
														</TxCodeInputProvider>
													</OpenID4VPContextProvider>
												</WebSocketSignHandlerProvider>
											</OIDFlowTransportProvider>
										</WscdManagerClientContextProvider>
									</CredentialsContextProvider>
								</TokenStatusListsContextProvider>
							</SessionContextProvider>
						</ActiveTabProvider>
					</AppSettingsProvider>
				</StatusContextProvider>
			</ErrorDialogContextProvider>
		</I18nextProvider>
	);
};

export default AppProvider;
