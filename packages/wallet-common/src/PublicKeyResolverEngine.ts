import { PublicKeyResolutionError } from './error';
import type { PublicKeyResolver, PublicKeyResolverEngineI } from './interfaces';

export function PublicKeyResolverEngine(): PublicKeyResolverEngineI {
	const resolvers: PublicKeyResolver[] = [];

	return {
		register(resolver: PublicKeyResolver) {
			resolvers.push(resolver);
		},
		async resolve({ identifier }: { identifier: string }) {
			for (const r of resolvers) {
				// biome-ignore lint/performance/noAwaitInLoops: baseline: pre-existing debt. should be fixed
				const result = await r.resolve({ identifier });
				if (result.success) {
					return result;
				}
			}
			return { success: false, error: PublicKeyResolutionError.CannotResolvePublicKey };
		},
	};
}
