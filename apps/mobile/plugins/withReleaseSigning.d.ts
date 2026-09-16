import type { ConfigPlugin } from 'expo/config-plugins';

/** Pure, idempotent text patch applied to android/app/build.gradle at prebuild. */
export function patchBuildGradle(contents: string): string;

declare const withReleaseSigning: ConfigPlugin;
export default withReleaseSigning;
