export * from './PresentCredentialsFlow';
export * from './usePresentCredentialsFlow';
export type * from './types';

/**
 * @todo - Refactor this directory structure
 *
 * It's fairly obvious that this dir is a bit of a mess,
 * with both UI components, a hook and utils all mashed together.
 *
 * I'll split this up into a better structure, when we have a more
 * generic place for `credentials` related logic.
 *
 * For the moment though, since this is all fairly uncomplicated
 * and already self-contained, I'm leaving it as-is.
 */
