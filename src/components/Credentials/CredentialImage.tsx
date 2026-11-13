import { FC, useEffect, useState } from 'react'
import { CredentialImageStatusOverlay } from './CredentialImageStatusOverlay';
import ExpiredRibbon from './ExpiredRibbon';
import UsagesRibbon from "./UsagesRibbon";
import { logger } from '@/logger';
import DefaultCred from "../../assets/images/cred.png";
import { CredentialCardSkeleton } from '../Skeletons';
import { TokenStatus } from '@sirosfoundation/token-status-list';

export type CredentialImageProps = {
	vcEntity: any;
	className?: string;
	onClick?: () => void;
	showRibbon?: boolean;
	showOverlay?: boolean;
	vcEntityInstances?: any[] | null;
	filter?: any | null;
	onLoad?: () => void;
	borderColor?: string;
	fixedRatio?: boolean;
};

const CredentialImage: FC<CredentialImageProps> = ({
	vcEntity,
	className,
	onClick = undefined,
	showRibbon = true,
	vcEntityInstances = null,
	filter = null,
	onLoad = undefined,
	borderColor = undefined,
	showOverlay = true,
	fixedRatio = true
}) => {
	const [imageSrc, setImageSrc] = useState(undefined);

	useEffect(() => {
		let isMounted = true;

		async function loadImage() {
			const imageFn = vcEntity?.parsedCredential?.metadata?.credential?.image?.dataUri;
			if (!imageFn) {
				setImageSrc(DefaultCred);
				onLoad?.();
				return;
			}

			try {
				const uri = await (filter !== null ? imageFn(filter) : imageFn());
				if (isMounted && uri) {
					setImageSrc(uri);
					onLoad?.();
				} else {
					setImageSrc(DefaultCred);
				}
			} catch (error) {
				logger.warn('Failed to load credential image:', error);
				if (isMounted) {
					setImageSrc(DefaultCred);
					onLoad?.();
				}
			}
		}

		loadImage();

		return () => { isMounted = false };
	}, [vcEntity, filter, onLoad]);

	const hasStatus = (
		vcEntity.isBatchExhausted ||
		vcEntity.isExpired ||
		TokenStatus.isBlocked(vcEntity.status)
	);

	return (
		<>
			{vcEntity && imageSrc ? (
				<>
					<div className={`relative w-full overflow-visible ${fixedRatio ? 'aspect-[1.6]' : ''}`}>
						<img
							src={imageSrc}
							alt="Credential"
							className={`w-full h-full object-cover object-top ${className ?? ''}`}
							onClick={onClick}
						/>
						{vcEntity.isBatchExhausted && showRibbon &&
							<ExpiredRibbon vcEntity={vcEntity} borderColor={borderColor} />
						}
						{vcEntity.isBatchExhausted !== true && showRibbon &&
							<UsagesRibbon vcEntityInstances={vcEntityInstances} borderColor={borderColor} />
						}
						{hasStatus && showOverlay && (
							<CredentialImageStatusOverlay vcEntity={vcEntity} />
						)}
					</div>
				</>
			) : (
				<CredentialCardSkeleton />
			)}
		</>
	);
};

export default CredentialImage;
