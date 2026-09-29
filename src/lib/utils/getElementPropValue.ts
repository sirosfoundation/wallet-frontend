// To get the values of possible nested properties
export function getElementPropValue(
	obj: any,
	property: string
): string | number | undefined {
	let value = obj;
	const propsArray = property.split(".");
	while (propsArray.length) {
		if (!value) {
			break;
		}
		value = value[propsArray.shift()];
	}
	return value;
}
