import {
	Fragment,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
	type FC,
	type PropsWithChildren,
	type ReactElement,
} from 'react';
import { Navigate } from 'react-router-dom';
import { CircleCheckIcon, CircleXIcon, HatGlassesIcon, IdCardIcon, ScrollTextIcon } from 'lucide-react';
import type {
	PresentationErrorState,
	PresentationResult,
	PresentCredentialsFlowView,
	PresentCredentialsRequest,
	PresentCredentialsResult,
} from './types';
import Spinner from '@/components/Shared/Spinner';
import { useTenant } from '@/context/TenantContext';
import Button from '@/components/Buttons/Button';
import { H1 } from '@/components/Shared/Heading';
import Header from '@/components/Layout/Header';
import {
	SwitchCredentialPopup,
	type SwitchCredentialPopupState
} from '@/components/Popups/SwitchCredentialPopup';
import { useTranslation } from 'react-i18next';
import { prettyDomain, truncateByWords } from '@/utils';
import { logger } from '@/logger';
import SessionContext from '@/context/SessionContext';

type PresentCredentialsFlowProps = {
	view: PresentCredentialsFlowView;
};

/**
 * Present Credentials Flow.
 *
 * Renders the flow for presenting credentials to a verifier.
 */
export const PresentCredentialsFlow: FC<PresentCredentialsFlowProps> = ({
	view,
}) => {
	return (
		<FlowContainer>
			<PresentCredentialsFlowRouter view={view} />
		</FlowContainer>
	);
};

type PresentCredentialsFlowRouterProps = {
	view: PresentCredentialsFlowView;
};

/**
 * Router for the Present Credentials Flow.
 */
const PresentCredentialsFlowRouter: FC<PresentCredentialsFlowRouterProps> = ({
	view,
}) => {
	switch (view.status) {
		case 'loading':
			return <PresentationLoadingScreen />;
		case 'request':
			return <PresentationOverviewScreen {...view} />;
		case 'sharing':
			return <PresentationSharingScreen {...view} />;
		case 'shared':
			return <PresentationCompleteScreen {...view} />;
		case 'error':
			return <PresentationErrorScreen {...view} />;
		default:
			// If no handler found, we assume the user isn't meant to be here,
			// and redirect to home.
			return <RedirectHome />;
	}
};

const RedirectHome: FC = () => {
	const { buildPath } = useTenant();
	return <Navigate to={buildPath()} />;
};

/**
 * Loading screen for the Present Credentials Flow.
 */
const PresentationLoadingScreen: FC = () => (
	<FlowScreen>
		<div className="flex flex-col gap-4 justify-center items-center h-[80vh]">
			<Spinner size="large" standalone />
		</div>
	</FlowScreen>
);

type PresentationOverviewScreenProps = {
	request: PresentCredentialsRequest;
	onAccept: (result: PresentCredentialsResult) => void;
	onDecline: () => void;
};

/**
 * Screen that shows the overview of the presentation request,
 * including the verifier information, purpose, and requested credentials.
 */
const PresentationOverviewScreen: FC<PresentationOverviewScreenProps> = ({
	request,
	onAccept,
	onDecline,
}) => {
	const { t } = useTranslation();
	const { verifier, queries, sets } = request;

	// The requested credentials, in order.
	const requested = sets.flatMap((set) =>
		set.options.flat().flatMap((id) => {
			const query = queries.find((q) => q.id === id);
			return query ? [query] : [];
		}),
	);

	// State: chosen batchId per query. Swap = change one entry.
	const [selection, setSelection] = useState<Record<string, number>>(() =>
		Object.fromEntries(requested.map((q) => [q.id, q.matches[0]?.batchId])),
	);

	const [
		switchCredentialState,
		setSwitchCredentialState,
	] = useState<SwitchCredentialPopupState | null>(null);

	const swap = (queryId: string, batchId: number) =>
		setSelection((prev) => ({ ...prev, [queryId]: batchId }));


	// Derived, display-ready. The render map just reads this.
	const view = requested.map((q) => ({
		id: q.id,
		selected: q.matches.find((m) => m.batchId === selection[q.id]),
		alternatives: q.matches.filter((m) => m.batchId !== selection[q.id]),
		total: q.matches.length,
	}));

	const buttons = (
		<>
			<Button
				variant="primary"
				size="lg"
				onClick={() =>
					onAccept(
						view.flatMap((entry) =>
							entry.selected
								? [{ queryId: entry.id, batchId: entry.selected.batchId }]
								: [],
						),
					)
				}
			>
				{t('presentCredentialsFlow.overview.share')}
			</Button>
			{/* TODO: We need a outline delete variant... */}
			<Button variant="outline" size="lg" onClick={onDecline}>
				{t('presentCredentialsFlow.overview.decline')}
			</Button>
		</>
	);

	const singlePurpose =
		sets.length === 1 && sets[0].purpose != null ? sets[0].purpose : null;

	return (
		<FlowScreen buttons={buttons}>
			<div className="mt-4">
				<H1 heading={t('presentCredentialsFlow.overview.title')} />
			</div>
			<dl>
				<dt className="font-bold not-first:mt-4">{t('presentCredentialsFlow.overview.requester')}</dt>
				<dd className="mt-2">
					{prettyDomain(verifier.domain)}
				</dd>
			</dl>
			<div className="mt-8">
				<h2 className="font-bold">
					{t('presentCredentialsFlow.overview.requestedInformation')}
				</h2>
				<ul>
				{view.map((entry) => (
					<li key={entry.id} className="mt-4 flex flex-col gap-3">
						<div className="flex flex-col gap-4">
							<dl className="flex flex-col gap-3">
								{[
									{
										title: t('presentCredentialsFlow.overview._demo.proofTitle'),
										source: entry.selected?.display.name ?? 'PID',
										icon: <ScrollTextIcon />,
									},
									{
										title: t('presentCredentialsFlow.overview._demo.pseudonymTitle'),
										source: entry.selected?.display.name ?? 'PID',
										icon: <HatGlassesIcon />,
										properties: [
											t('presentCredentialsFlow.overview._demo.pseudonymBenefits.noTracking'),
											t('presentCredentialsFlow.overview._demo.pseudonymBenefits.recognizeAccount'),
											t('presentCredentialsFlow.overview._demo.pseudonymBenefits.courtReveal'),
										],
									}
								].map(({ title, source, icon, properties }) => (
									<div className="p-4 border border-lm-gray-700 dark:border-dm-gray-400 rounded-xl">
										<div className="flex items-center gap-4">
											<div className="flex items-center gap-2 bg-lm-gray-200 dark:bg-dm-gray-600 text-primary dark:text-white p-3 rounded-lg">
												{icon}
											</div>
											<div>
												<dt className="font-bold not-first:mt-2 not-first:pt-2">
													{title}
												</dt>
												<dd className="mt-1 wrap-break-word">{t('presentCredentialsFlow.overview._demo.derivedFrom', { source })}</dd>
											</div>
										</div>
										{properties && properties.length > 0 && (
											<div className="mt-3 pt-3 text-sm border-t border-t-lm-gray-400 dark:border-t-dm-gray-600">
												<ul className="list-disc list-inside space-y-2">
													{properties.map((property, index) => (
														<li key={index}>{property}</li>
													))}
												</ul>
											</div>
										)}
									</div>
								))}
							</dl>

							{/* {entry.alternatives.length > 0 && (
								<div className=" pt-4 pb-1 border-t border-t-lm-gray-600 dark:border-t-dm-gray-400">
									<Button
										variant="link"
										linkClassName="flex items-center gap-2"
										aria-label={t('presentCredentialsFlow.overview.switchCredentialAria', {
											name: entry.selected?.display.name ?? '',
											count: entry.total,
										})}
										onClick={() =>
											setSwitchCredentialState({
												id: entry.id,
												matches: [
													entry.selected,
													...entry.alternatives,
												],
											})
										}
									>
										{t('presentCredentialsFlow.overview.switchCredential')}
										<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" strokeWidth={2} className="w-6 h-6" aria-hidden="true">
											<rect x="4" y="4" width="19" height="14" rx="2" fill="transparent" className="stroke-black dark:stroke-white" />
											<rect x="2" y="7" width="19" height="14" rx="2" className="fill-black dark:fill-white" />
											<text x="11" y="18" textAnchor="middle" fontSize="12" fontWeight="600" className="fill-white dark:fill-black">
												{entry.total}
											</text>
										</svg>
									</Button>
								</div>
							)} */}
						</div>
					</li>
				))}
				</ul>
			</div>
			{switchCredentialState && (
				<SwitchCredentialPopup
					switchCredentialState={switchCredentialState}
					setSwitchCredentialState={setSwitchCredentialState}
					selectCredential={(batchId) => {
						logger.debug('Switching credential', { batchId });
						swap(switchCredentialState.id, batchId);
						setSwitchCredentialState(null);
					}}
				/>
			)}
		</FlowScreen>
	);
};

type PresentationSharingScreenProps = {
	onCancel?: () => void;
	messages?: string[];
};

/**
 * Screen that shows the sharing progress of the presentation request.
 */
const PresentationSharingScreen: FC<PresentationSharingScreenProps> = ({
	onCancel,
	messages,
}) => {
	const { t } = useTranslation();
	const items = messages?.length ? messages : [t('common.loading')];
	const [index, setIndex] = useState(0);

	useEffect(() => {
		if (items.length <= 1) return;
		const id = setInterval(
			() => setIndex((i) => (i + 1) % items.length),
			1000 * 8,
		);
		return () => clearInterval(id);
	}, [items.length]);

	return (
		<FlowScreen
			buttons={
				typeof onCancel === 'function' && (
					<Button variant="outline" size="lg" onClick={onCancel}>
						{t('common.cancel')}
					</Button>
				)
			}
		>
			<div className="flex flex-col gap-4 justify-center items-center h-100">
				<Spinner size="large" standalone />
				<p
					className="text-center text-2xl font-bold animate-text-shimmer"
					role="status"
					aria-live="polite"
				>
					{items[index]}
				</p>
			</div>
		</FlowScreen>
	);
};

type PresentationCompleteScreenProps = {
	result: PresentationResult;
};

/**
 * Screen that shows the completion of the presentation request.
 */
const PresentationCompleteScreen: FC<PresentationCompleteScreenProps> = ({
	result,
}) => {
	const { t } = useTranslation();
	return (
		<FlowScreen>
			<CircleCheckIcon
				size={80}
				strokeWidth={1}
				className="mt-10 text-lm-green dark:text-dm-green"
				aria-hidden="true"
			/>
			<div className="pt-6 space-y-4" role="status">
				<h1 className="text-2xl font-bold">{t('presentCredentialsFlow.completed.title')}</h1>
		</div>
		</FlowScreen>

	);
};

type PresentationErrorScreenProps = {
	state: PresentationErrorState
};

/**
 * Screen that shows the error state of the presentation request.
 */
const PresentationErrorScreen: FC<PresentationErrorScreenProps> = ({
	state,
}) => {
	const { t } = useTranslation();
	return (
		<FlowScreen
			buttons={
				<Button variant="primary" size="lg" onClick={state.onClose}>
					{t('presentCredentialsFlow.error.close')}
				</Button>
			}
		>
			<CircleXIcon
				size={80}
				strokeWidth={1}
				className="mt-10 text-lm-red dark:text-dm-red"
				aria-hidden="true"
			/>
			<div className="pt-6 space-y-4" role="alert">
				<h1 className="text-2xl font-bold">{state.title}</h1>
				<p>{state.description}</p>
			</div>
		</FlowScreen>
	);
};

// UI components for the flow screens.

const FlowContainer: FC<PropsWithChildren> = ({ children }) => {
	const { api } = useContext(SessionContext);
	const { displayName, username } = api.getSession() ?? { displayName: 'Elisa\'s Wallet' };
	return (
		<div className="relative max-w-[500px] m-auto flex flex-col gap-4 min-h-screen">
			<Header sticky={false} alwaysVisible username={displayName || username} />
			{children}
		</div>
	);
};

const FlowScreen: FC<PropsWithChildren<{ buttons?: ReactElement }>> = ({
	children,
	buttons,
}) => {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		ref.current?.focus();
	}, []);

	return (
		<>
			<div
				ref={ref}
				tabIndex={-1}
				className="max-w-[500px] mx-6 mb-[25vh] focus:outline-none"
			>
				{children}
			</div>
			{buttons && (
				<div
					className="
					fixed bottom-0 w-[min(500px,100%)] px-6 pt-4 pb-10 bg-lm-gray-100 dark:bg-dm-gray-900 flex flex-col gap-4
					before:content-[''] before:pointer-events-none before:absolute before:bottom-full before:left-0 before:right-0 before:h-12
					before:bg-linear-to-t before:from-lm-gray-100 dark:before:from-dm-gray-900 before:to-transparent"
				>
					{buttons}
				</div>
			)}
		</>
	);
};

const Purpose: FC<{ purpose: string }> = ({ purpose }) => {
	const { t } = useTranslation();
	const id = useId();
	const { text, truncated } = truncateByWords(purpose, 40);
	const [expanded, setExpanded] = useState(false);

	return (
		<p>
			<span id={id}>
				{expanded ? purpose : text}
			</span>
			{truncated && (
				<>
					{' '}
					{expanded && <br />}
					<Button
						onClick={() => setExpanded(!expanded)}
						variant='link'
						aria-expanded={expanded}
						aria-controls={id}
					>
						{expanded ? t('common.showLess') : t('common.showMore')}
					</Button>
				</>
			)}
		</p>
	);
};
