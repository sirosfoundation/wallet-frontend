// AppProvider.tsx
import { Provider as StateProvider } from 'react-redux';
import React, { ReactNode } from 'react';

// Import i18next and set up translations
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n';

// Contexts
import { StatusContextProvider } from './context/StatusContextProvider';
import { SessionContextProvider } from './context/SessionContextProvider';
import { ClientCoreContextProvider } from './context/ClientCoreContextProvider';
import { CredentialsContextProvider } from './context/CredentialsContextProvider';
import { ErrorDialogContextProvider } from './context/ErrorDialogContextProvider';
import { OpenID4VPContextProvider } from './context/OpenID4VPContextProvider';
import { OpenID4VCIContextProvider } from './context/OpenID4VCIContextProvider';
import { AppSettingsProvider } from './context/AppSettingsProvider';
import { NotificationProvider } from './context/NotificationProvider';

// Hocs
import { store } from './store';
import UriHandler from './hocs/UriHandler/UriHandler';
import { NativeWrapperProvider } from './hocs/NativeWrapperProvider';

type RootProviderProps = {
	children: ReactNode;
};

const AppProvider: React.FC<RootProviderProps> = ({ children }) => {
	return (
		<StateProvider store={store}>
			<ErrorDialogContextProvider>
				<StatusContextProvider>
					<SessionContextProvider>
						<CredentialsContextProvider>
							<I18nextProvider i18n={i18n}>
								<ClientCoreContextProvider>
									<OpenID4VPContextProvider>
										<OpenID4VCIContextProvider>
											<UriHandler>
												<AppSettingsProvider>
													<NotificationProvider>
														<NativeWrapperProvider>
															{children}
														</NativeWrapperProvider>
													</NotificationProvider>
												</AppSettingsProvider>
											</UriHandler>
										</OpenID4VCIContextProvider>
									</OpenID4VPContextProvider>
								</ClientCoreContextProvider>
							</I18nextProvider>
						</CredentialsContextProvider>
					</SessionContextProvider>
				</StatusContextProvider>
			</ErrorDialogContextProvider>
		</StateProvider>
	);
};

export default AppProvider;
