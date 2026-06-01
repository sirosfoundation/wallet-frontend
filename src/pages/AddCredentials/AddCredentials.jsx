import React, { useState, useEffect, useContext } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { logger } from '@/logger';
import { useTenant } from '@/context/TenantContext';
import StatusContext from '@/context/StatusContext';
import SessionContext from '@/context/SessionContext';
import RedirectPopup from '../../components/Popups/RedirectPopup';
import { H1 } from '../../components/Shared/Heading';
import PageDescription from '../../components/Shared/PageDescription';
import QueryableList from '../../components/QueryableList/QueryableList';
import CredentialsContext from '@/context/CredentialsContext';
import useFilterItemByLang from '@/hooks/useFilterItemByLang';
import { buildCredentialConfiguration } from '@/components/QueryableList/CredentialsDisplayUtils';

const AddCredentials = () => {
	const { isOnline } = useContext(StatusContext);
	const { api } = useContext(SessionContext);
	const [issuers, setIssuers] = useState([]);
	const [recent, setRecent] = useState([]);
	const [credentialConfigurations, setCredentialConfigurations] = useState([]);
	const [showRedirectPopup, setShowRedirectPopup] = useState(false);

	const [selectedCredentialConfiguration, setSelectedCredentialConfiguration] = useState(null);
	const { vcEntityList, getData } = useContext(CredentialsContext);

	const { buildPath } = useTenant();
	const navigate = useNavigate();
	const { t } = useTranslation();
	const filterItemByLang = useFilterItemByLang();


	useEffect(() => {
		if (vcEntityList === null) {
			getData();
		}
	}, [vcEntityList, getData]);

	useEffect(() => {
		const fetchRecentCredConfigs = async () => {
			vcEntityList.map(async (vcEntity, key) => {
				const identifierField = JSON.stringify([vcEntity.credentialConfigurationId, vcEntity.credentialIssuerIdentifier]);
				setRecent((currentArray) => {
					const recentRecordExists = currentArray.some((rec) =>
						rec === identifierField
					);

					if (!recentRecordExists) {
						return [...currentArray, identifierField];
					}
					return currentArray;
				});

			})
		};

		if (vcEntityList) {
			fetchRecentCredConfigs();
		}
	}, [vcEntityList]);

	const getSelectedIssuer = () => {
		if (selectedCredentialConfiguration) {
			const { credentialIssuerIdentifier } = selectedCredentialConfiguration;
			return issuers.filter((issuer) => issuer.credential_issuer === credentialIssuerIdentifier)[0];
		}
		return null;
	}

	const getSelectedIssuerDisplay = () => {
		const selectedIssuer = getSelectedIssuer();

		if (selectedIssuer) {
			const selectedDisplayBasedOnLang = filterItemByLang(selectedIssuer.display, 'locale')
			if (selectedDisplayBasedOnLang) {
				const { name, description } = selectedDisplayBasedOnLang;
				return { name, description };
			}
		}
		return null;
	}

	useEffect(() => {
		const fetchIssuers = async () => {
			try {
				const response = await api.getExternalEntity('/issuer/all', undefined, true);
				let fetchedIssuers = response.data;
				fetchedIssuers.map(async (issuer) => {
					try {
						if (!issuer.visible) {
							return;
						}
						const metadata = (await api.getExternalEntity(`/issuer/${issuer.id}/metadata`, undefined, true)).data;
						const configs = metadata.credential_configurations_supported;

						// add issuer
						setIssuers((currentArray) => {
							const issuerExists = currentArray.some((issuerMetadata) =>
								issuerMetadata.credential_issuer === metadata.credential_issuer
							);

							if (!issuerExists) {
								return [...currentArray, metadata];
							}
							return currentArray;
						});

						Object.keys(configs).forEach((key) => {
							const credentialConfiguration = buildCredentialConfiguration(key, configs[key], metadata, filterItemByLang);
							setCredentialConfigurations((currentArray) => {
								const credentialConfigurationExists = currentArray.some(({ credentialConfigurationId, credentialIssuerIdentifier, credentialConfiguration }) =>
									credentialConfigurationId === key && credentialIssuerIdentifier === metadata.credential_issuer
								);
								if (!credentialConfigurationExists) {
									return [...currentArray, credentialConfiguration];
								}
								return currentArray;
							})
						});
					}
					catch (err) {
						logger.error(err);
						return null;
					}
				})
			} catch (error) {
				logger.error('Error fetching issuers:', error);
			}
		};

		if (filterItemByLang) {
			logger.debug("Fetching issuers...")
			fetchIssuers();
		}
	}, [api, isOnline, filterItemByLang]);

	const handleCredentialConfigurationClick = async (credentialConfigurationIdWithCredentialIssuerIdentifier) => {
		const [credentialConfigurationId, credentialIssuerIdentifier] = JSON.parse(credentialConfigurationIdWithCredentialIssuerIdentifier);
		const clickedCredentialConfiguration = credentialConfigurations.find((conf) => conf.credentialConfigurationId === credentialConfigurationId && conf.credentialIssuerIdentifier === credentialIssuerIdentifier);
		if (clickedCredentialConfiguration) {
			setSelectedCredentialConfiguration(clickedCredentialConfiguration);
			setShowRedirectPopup(true);
		}
	}

	const handleCancel = () => {
		setShowRedirectPopup(false);
		setSelectedCredentialConfiguration(null);
	};

	const handleContinue = () => {
		if (selectedCredentialConfiguration) {
			const { credentialConfigurationId, credentialIssuerIdentifier } = selectedCredentialConfiguration;

			/**
			 * Construct a minimal credential offer for the wallet to handle.
			 */
			const credentialOffer = {
				credential_issuer: credentialIssuerIdentifier,
				credential_configuration_ids: [credentialConfigurationId],
				// TODO: we shouldn't need to specify grants here but it's currently needed.
				// Remove once the stack is equipped to handle missing `grants` in offers.
				grants: {
					authorization_code: {},
				}
			};
			const credentialOfferString = JSON.stringify(credentialOffer);
			const path = buildPath(`cb?credential_offer=${encodeURIComponent(credentialOfferString)}`);

			navigate(path);
		}

		setShowRedirectPopup(false);
	};

	return (
		<>
			<div className="px-6 sm:px-12 w-full">
				<H1 heading={t('common.navItemAddCredentials')} />
				<PageDescription description={t('pageAddCredentials.description')} />

				{credentialConfigurations && recent && (
					<QueryableList
						isOnline={isOnline}
						list={credentialConfigurations}
						recent={recent}
						queryField='credentialConfigurationDisplayName'
						translationPrefix='pageAddCredentials'
						identifierField='identifierField'
						onClick={handleCredentialConfigurationClick}
					/>
				)}
			</div>

			{showRedirectPopup && selectedCredentialConfiguration && (
				<RedirectPopup
					onClose={handleCancel}
					handleContinue={handleContinue}
					popupTitle={`${t('pageAddCredentials.popup.title')} ${selectedCredentialConfiguration?.credentialConfigurationDisplayName}`}
					popupMessage={
						<Trans
							i18nKey="pageAddCredentials.popup.message"
							values={{
								issuerName: getSelectedIssuerDisplay()?.name ?? "Unknown",
								issuerDescription: getSelectedIssuerDisplay()?.description ? `(${getSelectedIssuerDisplay()?.description})` : "",
								credentialName: selectedCredentialConfiguration?.credentialDisplay.name ?? "Unknown",
								credentialDescription: selectedCredentialConfiguration?.credentialDisplay?.description ? `(${selectedCredentialConfiguration?.credentialDisplay?.description})` : "",
							}}
							components={{ strong: <strong />, italic: <i /> }}
						/>
					}
				/>
			)}
		</>
	);
};

export default AddCredentials;
