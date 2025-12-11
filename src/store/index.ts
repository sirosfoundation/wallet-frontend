import { configureStore, createAsyncThunk } from '@reduxjs/toolkit';
import {
	importMainKey,
	openPrivateData,
	signJwtPresentation as keystoreSignJwtPresentation,
} from "@/services/keystore";
import { jsonParseTaggedBinary } from '@/util';

import statusReducer from "./statusSlice";
import sessionsReducer from "./sessionsSlice";

export const store = configureStore({
	reducer: {
		status: statusReducer,
		sessions: sessionsReducer,
	},
	middleware: (getDefaultMiddleware) => {
		return getDefaultMiddleware({
			serializableCheck: {
				ignoredActionPaths: [
					'payload',
					'meta.arg.credentialEngine',
				],
				ignoredPaths: [
					'sessions.eventStore',
					'sessions.keystore',
					'sessions.storage',
					'sessions.privateData',
					'sessions.calculatedWalletState',
					'sessions.api',
					'sessions.vcEntityList',
				],
			},
		})
	},
});

type SignJwtPresentationParams = {
	nonce: string;
	audience: string;
	verifiableCredentials: any[];
	transactionDataResponseParams?: {
		transaction_data_hashes: string[];
		transaction_data_hashes_alg: string[];
	};
}

export const signJwtPresentation = createAsyncThunk('keystore/signJwtPresentation', async (
	{
		nonce,
		audience,
		verifiableCredentials,
		transactionDataResponseParams,
	}: SignJwtPresentationParams,
	{ getState }
) => {
	const privateData = (getState() as AppState).sessions.privateData;
	// TODO get from storage service
	const mainKey = jsonParseTaggedBinary(sessionStorage.getItem("mainKey"));
	console.log(await openPrivateData(mainKey, privateData))
	return keystoreSignJwtPresentation(
		await openPrivateData(await importMainKey(mainKey), privateData),
		nonce,
		audience,
		verifiableCredentials,
		transactionDataResponseParams
	);
});

export { setOnline, setOffline, setPwaInstallable, setPwaNotInstallable } from "./statusSlice";
export {
	setKeystore,
	setPrivateData,
	setCalculatedWalletState,
	setStorageValue,
	setApi,
	setVcEntityList,
	setKeypairs,
} from "./sessionsSlice";

export type AppState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
