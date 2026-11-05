import { FC, useEffect, useState } from 'react'
import { CredentialImageStatusOverlay } from './CredentialImageStatusOverlay';
import { logger } from '@/logger';
import DefaultCred from "../../assets/images/cred.png";
import { CredentialCardSkeleton } from '../Skeletons';
import { ExtendedVcEntity } from '@/context/CredentialsContext';

export type CredentialImageProps = {
	vcEntity: ExtendedVcEntity;
	className?: string;
	onClick?: () => void;
	showRibbon?: boolean;
	showOverlay?: boolean;
	filter?: any | null;
	onLoad?: () => void;
	fixedRatio?: boolean;
};

const CredentialImage: FC<CredentialImageProps> = ({
	vcEntity,
	className,
	onClick = undefined,
	filter = null,
	onLoad = undefined,
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
						{showOverlay && (
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
