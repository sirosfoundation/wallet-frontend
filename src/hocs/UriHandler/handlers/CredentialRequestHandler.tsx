import React, { useCallback, useContext, useEffect } from "react";
import { calculateJwkThumbprint, decodeJwt, exportJWK, generateKeyPair, JWK, SignJWT } from "jose";
import { OauthError } from "@wwwallet/client-core";
import { OPENID4VCI_PROOF_TYPE_PRECEDENCE } from "@/config";
import { logger, jsonToLog } from "@/logger";
import { WalletStateUtils } from "@/services/WalletStateUtils";
import { ProtocolData, ProtocolStep } from "../resources";

import SessionContext from "@/context/SessionContext";

import { useTranslation } from "react-i18next";
import useClientCore from "@/hooks/useClientCore";
import useErrorDialog from "@/hooks/useErrorDialog";
import CredentialsContext from "@/context/CredentialsContext";

export type CredentialRequestProps = {
	goToStep: (step: ProtocolStep, data: ProtocolData) => void
	data: any
}

const configProofTypes = OPENID4VCI_PROOF_TYPE_PRECEDENCE.split(',') as string[];

export const CredentialRequestHandler = ({ goToStep, data }) => {
	const { displayError } = useErrorDialog();
	const { api, keystore } = useContext(SessionContext);
	const { credentialEngine } = useContext<any>(CredentialsContext);

	const { t } = useTranslation();
	const core = useClientCore();

	const requestKeyAttestation = useCallback(async (jwks: JWK[], nonce: string) => {
		try {
			const response = await api.post("/wallet-provider/key-attestation/generate", {
				jwks,
				openid4vci: {
					nonce: nonce,
				}
			});
			const { key_attestation } = response.data;
			if (!key_attestation || typeof key_attestation != 'string') {
				logger.debug("Cannot parse key_attestation from wallet-backend-server");
				return null;
			}
			return { key_attestation };
		}
		catch (err) {
			logger.debug(err);
			return null;
		}
	}, [api]);


	useEffect(() => {
		const {
			issuer_metadata,
			client_state: clientState,
			access_token,
			state,
			c_nonce
		} = data

		const credential_configuration_ids = clientState
				?.credential_configuration_ids || [];
		const audience = issuer_metadata.issuer;
		const issuer = core.config.static_clients.find(({ issuer }) => issuer === audience).client_id;

		(async () => {
			try {
				const proofTypes = credential_configuration_ids.map(
					(credential_configuration_id: string) => {
						return configProofTypes.find(proofType => {
							return Object.keys(
								issuer_metadata
									.credential_configurations_supported[credential_configuration_id]
									?.proof_types_supported || {}
							).includes(proofType)
						})
					}
				).filter(proofType => proofType)

				const proofs = await Promise.all(
					proofTypes.map(async (proofType) => {
						const proofKey = await generateKeyPair("ES256", { extractable: true });

						if (proofType === "jwt") {
							return {
								proofKey: {
									alg: "ES256",
									...proofKey,
								},
								proof: await new SignJWT({ nonce: c_nonce, aud: audience, iss: issuer })
									.setProtectedHeader({ alg: "ES256", jwk: await exportJWK(proofKey.publicKey) })
									.sign(proofKey.privateKey)
							}
						}

						if (proofType === "attestation") {
							return {
								proofKey: {
									alg: "ES256",
									...proofKey,
								},
								proof: await requestKeyAttestation(
									[proofKey.publicKey],
									c_nonce
								).then(({ key_attestation }) => key_attestation)
							}
						}
					}))

				const credentials = await Promise.all(
					credential_configuration_ids.map(async (credential_configuration_id: string, index: number) => {
						// TODO manage transaction data
						const { data: { credentials } } = await core.credential({
							access_token,
							state,
							credential_configuration_id,
							proofs: {
								jwt: proofTypes
									.filter(proofType => proofType === "jwt")
									.map((_proofType, index) => proofs[index].proof),
								attestation: proofTypes
									.filter(proofType => proofType === "attestation")
									.map((_proofType, index) => proofs[index].proof),
							}
						})

						return [credential_configuration_id, credentials]
					})
				)

				const batchId = WalletStateUtils.getRandomUint32();
				const [, credentialsData, credentialsCommit] = await keystore.addCredentials(
					await Promise.all(credentials
						.flatMap(([credential_configuration_id, credentials], index: number) => {
							return credentials.map(async ({ credential }) => {
								const { cnf }  = decodeJwt(credential) as { cnf: { jwk: JWK } };

								// TODO move credential validation in the core
								// TODO MSoMDoc issuer validation
								const isValid = await credentialEngine.credentialParsingEngine.parse({ rawCredential: credential })
								// TODO display validation warnings
								// TODO display consent if there are warnings
								if (!isValid.success) return

								return {
									data: credential,
									format: "vc+sd-jwt",
									kid: (cnf && await calculateJwkThumbprint(cnf.jwk as JWK)) || "",
									credentialConfigurationId: credential_configuration_id,
									credentialIssuerIdentifier: issuer_metadata.issuer,
									batchId,
									instanceId: index,
								}
							})
						})),
						proofs.map(({ proofKey }) => proofKey)
				)

				await api.updatePrivateData(credentialsData);
				await credentialsCommit();

				return true
			} catch(err) {
				if (err instanceof OauthError) {
					logger.error(t(`errors.invalid_client`), jsonToLog(err));
					displayError({
						title: t(`errors.invalid_client`),
						emphasis: t(`errors.oid4vci.credential_request.description.credential`),
						description: t(`errors.oid4vci.credential_request.invalid_client`),
						err,
					});
				} else {
					logger.error(err);
				}
			}
		})()
	}, []) // eslint-disable-line

	return (
		<></>
	)
}
