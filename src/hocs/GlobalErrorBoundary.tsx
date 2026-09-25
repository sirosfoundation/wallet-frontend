import React from "react";
import GlobalErrorScreen from "@/pages/GlobalErrorScreen/GlobalErrorScreen";
import { logger } from "@/logger";

type GlobalErrorBoundaryState = {
	error: Error | null;
};

class GLobalErrorBoundary extends React.Component<React.PropsWithChildren, GlobalErrorBoundaryState> {
	state: GlobalErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): GlobalErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error, info: React.ErrorInfo) {
		logger.error('Unhandled error caught by GlobalErrorBoundary', error, info.componentStack);
	}

	render() {
		if (this.state.error) {
			return <GlobalErrorScreen error={this.state.error} />;
		}
		return this.props.children;
	}
}

export default GLobalErrorBoundary;
