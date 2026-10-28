/** Return the value unchanged. Useful for narrowing string literals into an
enumerated union type, for example. */
export function coerce<T>(value: T): T {
	return value;
}
