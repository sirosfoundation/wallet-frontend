/**
 * Client-side Credential Matching Service
 *
 * This service matches local credentials against a DIF Presentation Definition
 * without revealing credentials to the server until after matching.
 *
 * Privacy benefits:
 * - Only credential IDs and types are shared, not the full credentials
 * - Matching happens entirely on the client side
 * - Server only learns about credentials that match the request
 */

import { ExtendedVcEntity } from '@/context/CredentialsContext';

// Types for presentation definition matching (DIF PEX format)
export interface PresentationDefinition {
  id: string;
  name?: string;
  purpose?: string;
  input_descriptors: InputDescriptor[];
  format?: Record<string, unknown>;
}

export interface InputDescriptor {
  id: string;
  name?: string;
  purpose?: string;
  format?: Record<string, unknown>;
  constraints?: Constraints;
}

export interface Constraints {
  limit_disclosure?: 'required' | 'preferred';
  fields?: Field[];
}

export interface Field {
  path: string[];
  filter?: Record<string, unknown>;
  optional?: boolean;
}

export interface CredentialMatch {
  input_descriptor_id: string;
  credential_id: string;
  format: string;
  vct?: string;
  available_claims?: string[];
}

export interface CredentialsMatchedResult {
  matches: CredentialMatch[];
  no_match_reason?: string;
}

/**
 * Match local credentials against a presentation definition.
 * Returns credentials that satisfy the input descriptors.
 */
export function matchCredentials(
  credentials: ExtendedVcEntity[],
  presentationDefinition: PresentationDefinition
): CredentialsMatchedResult {
  const matches: CredentialMatch[] = [];
  const unmatchedDescriptors: string[] = [];

  for (const descriptor of presentationDefinition.input_descriptors) {
    const descriptorMatches = matchDescriptor(credentials, descriptor);

    if (descriptorMatches.length > 0) {
      // Add all matching credentials for this descriptor
      // The user will choose which one to use during consent
      matches.push(...descriptorMatches);
    } else {
      unmatchedDescriptors.push(descriptor.id);
    }
  }

  if (unmatchedDescriptors.length > 0 && matches.length === 0) {
    return {
      matches: [],
      no_match_reason: `No credentials match descriptors: ${unmatchedDescriptors.join(', ')}`,
    };
  }

  return { matches };
}

/**
 * Match credentials against a single input descriptor.
 */
function matchDescriptor(
  credentials: ExtendedVcEntity[],
  descriptor: InputDescriptor
): CredentialMatch[] {
  const matches: CredentialMatch[] = [];

  for (const credential of credentials) {
    if (credentialMatchesDescriptor(credential, descriptor)) {
      // Extract available claims from the credential
      const availableClaims = extractAvailableClaims(credential);

      matches.push({
        input_descriptor_id: descriptor.id,
        credential_id: String(credential.credentialId),
        format: credential.format || 'vc+sd-jwt', // Default to SD-JWT if not specified
        vct: credential.parsedCredential?.metadata?.credential?.vct,
        available_claims: availableClaims,
      });
    }
  }

  return matches;
}

/**
 * Check if a credential matches an input descriptor.
 */
function credentialMatchesDescriptor(
  credential: ExtendedVcEntity,
  descriptor: InputDescriptor
): boolean {
  // Check format constraints
  if (descriptor.format) {
    const credFormat = credential.format || 'vc+sd-jwt';
    const allowedFormats = Object.keys(descriptor.format);

    if (allowedFormats.length > 0 && !allowedFormats.includes(credFormat)) {
      return false;
    }
  }

  // Check field constraints
  if (descriptor.constraints?.fields) {
    for (const field of descriptor.constraints.fields) {
      if (!field.optional && !credentialHasField(credential, field)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Check if a credential has a field matching the path.
 */
function credentialHasField(credential: ExtendedVcEntity, field: Field): boolean {
  // For SD-JWT credentials, check in the signed claims from parsed credential
  const claims = credential.parsedCredential?.signedClaims || {};

  for (const path of field.path) {
    // Parse JSON path (simplified - handles $.field and $.field.subfield)
    const value = resolveJsonPath(claims, path);

    if (value !== undefined) {
      // Check filter if specified
      if (field.filter) {
        if (!matchesFilter(value, field.filter)) {
          continue;
        }
      }
      return true;
    }
  }

  return false;
}

/**
 * Resolve a JSON path against an object.
 * Supports paths like "$.claim" or "$.claim.subclaim".
 */
function resolveJsonPath(obj: Record<string, unknown>, path: string): unknown {
  // Remove leading $. if present
  const cleanPath = path.replace(/^\$\.?/, '');

  if (!cleanPath) {
    return obj;
  }

  const parts = cleanPath.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Check if a value matches a JSON Schema-like filter.
 */
function matchesFilter(value: unknown, filter: Record<string, unknown>): boolean {
  // Type matching
  if (filter.type) {
    const actualType = typeof value;
    if (filter.type !== actualType) {
      // Special case: array is type "array" but typeof says "object"
      if (filter.type === 'array' && !Array.isArray(value)) {
        return false;
      }
      if (filter.type !== 'array' && filter.type !== actualType) {
        return false;
      }
    }
  }

  // Pattern matching (regex)
  if (filter.pattern && typeof value === 'string') {
    const regex = new RegExp(filter.pattern as string);
    if (!regex.test(value)) {
      return false;
    }
  }

  // Const matching (exact value)
  if (filter.const !== undefined) {
    if (value !== filter.const) {
      return false;
    }
  }

  // Enum matching (one of values)
  if (filter.enum && Array.isArray(filter.enum)) {
    if (!filter.enum.includes(value)) {
      return false;
    }
  }

  return true;
}

/**
 * Extract available claims from a credential for disclosure selection.
 */
function extractAvailableClaims(credential: ExtendedVcEntity): string[] {
  const claims: string[] = [];

  // For SD-JWT credentials, get the disclosable claims from parsed credential
  const vcClaims = credential.parsedCredential?.signedClaims || {};

  // Recursively extract claim paths
  extractClaimPaths(vcClaims, '', claims);

  return claims;
}

/**
 * Recursively extract claim paths from an object.
 */
function extractClaimPaths(
  obj: Record<string, unknown>,
  prefix: string,
  paths: string[]
): void {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;

    // Skip internal/metadata fields
    if (key.startsWith('_') || key === 'iss' || key === 'iat' || key === 'exp') {
      continue;
    }

    paths.push(path);

    // Recurse into nested objects (but not arrays)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      extractClaimPaths(value as Record<string, unknown>, path, paths);
    }
  }
}

export default {
  matchCredentials,
};
