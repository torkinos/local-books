/**
 * App-level port assembly: the one place platform modules meet core's interfaces.
 *
 * Grows as T6 (StoragePort over op-sqlite) and T23 (RatePort over NBG) land; each
 * adapter stays individually testable, and only this file may import Expo modules
 * that need a device to run.
 */
import { getRandomValues } from 'expo-crypto';
import { makeReferenceKeyPort } from './adapters/referenceKeys.js';
import { mainnetEndpoints, devnetEndpoints } from './adapters/rpc.js';

export const referenceKeys = makeReferenceKeyPort((length) =>
  getRandomValues(new Uint8Array(length)),
);

export { mainnetEndpoints, devnetEndpoints };
