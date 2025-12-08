import { BackendApi } from "@/api";
import { ExtendedVcEntity } from "@/context/CredentialsContext";
import { CredentialKeyPair, EncryptedContainer } from "@/services/keystore";
import { LocalStorageKeystore } from "@/services/LocalStorageKeystore";
import { WalletState } from "@/services/WalletStateSchemaCommon";
import { createSlice } from "@reduxjs/toolkit";

type State = {
	keystore: LocalStorageKeystore | null;
	privateData: EncryptedContainer | null;
	calculatedWalletState: WalletState | null;
	api: BackendApi | null;
	storage: {
		"Local storage": {
			currentValue: Record<string, unknown>;
		};
		"Session storage": {
			currentValue: Record<string, unknown>;
		};
	};
	vcEntityList: ExtendedVcEntity[];
	keypairs: Record<string, CredentialKeyPair>;
}

export const sessionsSlice = createSlice({
	name: 'status',
	initialState: {
		keystore: null,
		privateData: null,
		calculatedWalletState: null,
		storage: {
			"Local storage": {
				currentValue: {},
			},
			"Session storage": {
				currentValue: {},
			},
		},
		api: null,
		vcEntityList: null,
		keypairs: null,
	},
	reducers: {
		setKeystore: (state: State, { payload }: { payload: LocalStorageKeystore }) => {
			state.keystore = payload
		},
		setPrivateData: (state: State, { payload }: { payload: EncryptedContainer | null }) => {
			state.privateData = payload
		},
		setStorageValue: <T>(
			state: State,
			{ payload }: { payload: { type: "Local storage" | "Session storage", name: string, value: T } }
		) => {
			state.storage[payload.type].currentValue[payload.name] = payload.value
		},
		setCalculatedWalletState: (state: State, { payload }: { payload: WalletState | null }) => {
			state.calculatedWalletState = payload
		},
		setApi: (state: State, { payload }: { payload: BackendApi }) => {
			state.api = payload
		},
		setVcEntityList: (state: State, { payload }: { payload: ExtendedVcEntity[] }) => {
			if (!state.vcEntityList) {
				state.vcEntityList = payload
				return
			}

			const current = state.vcEntityList || []
			const newList = payload.filter(vcEntity => {
				if (!current.length) return true

				return !current.map(({ batchId }) => batchId).includes(vcEntity.batchId)
			})

			if (newList.length) {
				state.vcEntityList = newList.concat(current)
			}
			if (payload.length < current.length) state.vcEntityList = payload
		},
		setKeypairs: (state: State, { payload }: { payload:  CredentialKeyPair[] }) => {
			if (!state.keypairs) {
				state.keypairs = {}
				return
			}

			payload.forEach(keypair => {
				state.keypairs[keypair.kid] = keypair
			})
		},
	}
});

export const {
	setKeystore,
	setPrivateData,
	setCalculatedWalletState,
	setStorageValue,
	setApi,
	setVcEntityList,
	setKeypairs,
} = sessionsSlice.actions;
export default sessionsSlice.reducer;
