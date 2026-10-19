import { FC, useEffect, useState } from 'react'
import ExpiredRibbon from './ExpiredRibbon';
import UsagesRibbon from "./UsagesRibbon";
import { logger } from '@/logger';
import DefaultCred from "../../assets/images/cred.png";
import { CredentialCardSkeleton } from '../Skeletons';
import { CircleXIcon } from 'lucide-react';

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
						{vcEntity.isBatchExhausted && showOverlay && (
							<div
								className="
									absolute top-0 left-0 w-full h-full p-4
									flex items-center justify-center flex-col gap-2
									bg-black/25 backdrop-blur-xs rounded-lg
									text-sm font-bold
								"
							>
								<p className="py-1 px-4 flex justify-center items-center rounded-full bg-lm-red-light text-lm-red border-2 border-lm-red">
									<CircleXIcon size={18} className="inline-block mr-1" />
									Drained
								</p>
								<p className="text-white max-w-75">
									This credential needs to be renewed before it can be used again
								</p>
							</div>
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
