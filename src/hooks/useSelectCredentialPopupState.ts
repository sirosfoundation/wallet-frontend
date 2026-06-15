import CredentialsContext, { ExtendedVcEntity } from "@/context/CredentialsContext";
import { Dispatch, SetStateAction, useContext, useState } from "react";

export type SelectCredentialPopupOptions = {
	conformantCredentialsMap: Record<string, {
		credentials: number[];
		requestedFields: Array<{ name?: string; path?: (string | null)[] }>;
	}>;
	verifierDomainName: string;
	verifierPurpose: string;
	parsedTransactionData?: Array<{ type: string; description: string; data: unknown }>;
};

export type SelectCredentialPopupStateValue = {
	isOpen: boolean;
	options: SelectCredentialPopupOptions | null;
	resolve: (selection: Map<string, number>) => void;
};

export type SelectCredentialPopupState = {
	popupState: SelectCredentialPopupStateValue;
	setPopupState: Dispatch<SetStateAction<SelectCredentialPopupStateValue>>;
	showPopup: (options: SelectCredentialPopupOptions) => Promise<Map<string, number>>;
	hidePopup: () => void;
	vcEntityList: ExtendedVcEntity[];
};

export function useSelectCredentialPopupState(): SelectCredentialPopupState {
	const [popupState, setPopupState] = useState<SelectCredentialPopupStateValue>({
		isOpen: false,
		options: null,
		resolve: () => { },
	});

	const showPopup = (options: SelectCredentialPopupOptions): Promise<Map<string, number>> => {
		return new Promise((resolve) => {
			setPopupState({
				isOpen: true,
				options,
				resolve,
			});
		});
	};

	const hidePopup = () => {
		setPopupState((prev) => ({
			...prev,
			isOpen: false,
			options: null,
			resolve: () => { },
		}));
	};

	const { vcEntityList } = useContext(CredentialsContext);

	return {
		popupState,
		setPopupState,
		showPopup,
		hidePopup,
		vcEntityList,
	};
}
