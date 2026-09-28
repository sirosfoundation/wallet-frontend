/** Get the last element of `arr`, or `undefined` if `arr` is empty or nullish. */
export function last<T>(arr: T[]): T | undefined {
	return arr ? arr[arr.length - 1] : undefined;
}

/**
	Like `Array.findIndex`, but returns the index past the end of the array
	instead of -1 if no matching element is found.
	*/
export function findIndexOrEnd<T>(arr: T[], predicate: (element: T) => boolean): number {
	const index = arr.findIndex(predicate);
	if (index === -1) {
		return arr.length;
	} else {
		return index;
	}
}

/**
	Split `arr` into two contiguous segments. The second segment begins with the
	first element that satisfies the `predicate`.

	If no element satisfies the `predicate`, then the first segment is a shallow
	copy of `arr` and the second segment is empty.
	*/
export function splitWhen<T>(arr: T[], predicate: (element: T) => boolean): [T[], T[]] {
	const splitIndex = findIndexOrEnd(arr, predicate);
	return [arr.slice(0, splitIndex), arr.slice(splitIndex)];
}

/**
	Filter `arr` for duplicates as determined by `f`, keeping the first element
	of each duplicate class.
	*/
export function deduplicateBy<T, U extends (string | number | boolean | bigint | symbol)>(
	arr: T[],
	f: (element: T) => U,
): T[] {
	return [
		...arr.reduce(
			(map, e: T) => {
				const key = f(e);
				if (!map.has(key)) {
					map.set(key, e);
				}
				return map;
			},
			new Map<U, T>(),
		).values(),
	];
}

/**
	Filter `arr` for duplicates as determined by `f`, keeping the last element of
	each duplicate class.
	*/
export function deduplicateFromRightBy<T, U extends (string | number | boolean | bigint | symbol)>(
	arr: T[],
	f: (element: T) => U,
): T[] {
	return [
		...arr.reduce(
			(map, e: T) => {
				map.set(f(e), e);
				return map;
			},
			new Map<U, T>(),
		).values(),
	];
}

/**
	Create a comparator function comparing the result of passing each argument through the given function.
	The function returned by `compareBy` is suitable as an argument to `Array.sort()`, for example.

	Example:
	```
	list.sort(compareBy(obj => new Date(obj.issuanceDate)));
	```

	The above is equivalent to:
	```
	list.sort((objA, objB) => new Date(objB.issuanceDate) - new Date(objA.issuanceDate));
	```
 */
export function compareBy<T, U>(f: (v: T) => U): (a: T, b: T) => number {
	return (a: T, b: T) => {
		const fa = f(a);
		const fb = f(b);
		if (fa < fb) {
			return -1;
		} else if (fb < fa) {
			return 1;
		} else {
			return 0;
		}
	};
}

/**
	Return the element of `arr` for which the value returned by `byKey` is
	greatest, as determined by the `>` operator.

	If `arr` is empty, return `undefined`.

	If the maximum is not unique, return the first maximum.
	 */
export function maxByKey<T, U extends string | number | boolean | bigint>(arr: T[], byKey: (v: T) => U): T | undefined {
	if (arr.length === 0) {
		return undefined;
	} else {
		return arr.slice(1).reduce<[T, U]>(
			([max, maxKey], next) => {
				const nextKey = byKey(next);
				return (nextKey > maxKey) ? [next, nextKey] : [max, maxKey];
			},
			[arr[0], byKey(arr[0])],
		)[0];
	}
}

/** Reverse the given comparator function. */
export function reverse<T>(f: (a: T, b: T) => number): (a: T, b: T) => number {
	return (a: T, b: T) => -f(a, b);
}
