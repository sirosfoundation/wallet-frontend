import StatusContext from "@/context/StatusContext";
import { useContext } from "react";

export function useStatusContext() {
	const context = useContext(StatusContext);
	if (!context) {
		throw new Error('useStatusContext must be used within a StatusContextProvider');
	}
	return context;
}
