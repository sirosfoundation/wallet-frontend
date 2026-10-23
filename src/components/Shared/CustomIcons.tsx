import { createLucideIcon } from "lucide-react";

export const UsbStickDotIcon = createLucideIcon("usb-stick-dot", [
	[
		"path",
		{
			"d": "M18 8v10a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z",
			"key": "1pvj0n"
		}
	],
	[
		"path",
		{
			"d": "M8 7V2h8v5",
			"key": "payjgv"
		}
	],
	[
		"circle",
		{
			"cx": "12",
			"cy": "15",
			"r": "1",
			"fill": "currentColor",
			"key": "3me149"
		}
	]
]);

export const DoubleUsbStickDotIcon = ({ size = 24 }: { size?: number }) => (
	<svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
		<g transform="translate(14 0) scale(0.55)">
			<UsbStickDotIcon />
		</g>
		<g transform="translate(-2 3) scale(0.8)">
			<UsbStickDotIcon />
		</g>
	</svg>
);