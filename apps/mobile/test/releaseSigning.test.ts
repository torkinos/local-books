/**
 * The release-signing config plugin's Gradle patch (T17). The generated
 * android/app/build.gradle is gitignored, so the test carries the exact template
 * fragment the patch is written against; if Expo's template changes shape the patch
 * throws rather than silently producing a debug-signed release.
 */
import { describe, expect, it } from 'vitest';
import { patchBuildGradle } from '../plugins/withReleaseSigning.js';

const TEMPLATE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'
            shrinkResources enableShrinkResources.toBoolean()
        }
    }
}
`;

describe('withReleaseSigning.patchBuildGradle', () => {
  it('adds a release signing config fed by gradle properties and points the release build type at it', () => {
    const out = patchBuildGradle(TEMPLATE);
    expect(out).toMatch(/signingConfigs \{[\s\S]*release \{[\s\S]*storeFile file\(LOCAL_BOOKS_RELEASE_STORE_FILE\)/);
    expect(out).toContain("storePassword LOCAL_BOOKS_RELEASE_STORE_PASSWORD");
    expect(out).toContain("keyAlias LOCAL_BOOKS_RELEASE_KEY_ALIAS");
    expect(out).toContain("keyPassword LOCAL_BOOKS_RELEASE_KEY_PASSWORD");
    // The release build type never silently falls back to the debug key: without
    // the properties (and without the explicit opt-in) the signing config is null,
    // which makes Gradle emit app-release-unsigned.apk.
    expect(out).toMatch(
      /release \{[\s\S]*signingConfig = \(project\.hasProperty\('LOCAL_BOOKS_RELEASE_STORE_FILE'\)\s*\?\s*signingConfigs\.release\s*:\s*\(project\.hasProperty\('LOCAL_BOOKS_ALLOW_DEBUG_SIGNED_RELEASE'\) \? signingConfigs\.debug : null\)\)/,
    );
    expect(out).not.toMatch(/release \{\n(?:            \/\/.*\n)*            signingConfig signingConfigs\.debug\n/);
    // The debug build type is untouched.
    expect(out).toMatch(/debug \{\n            signingConfig signingConfigs\.debug\n        \}/);
    // Everything after the signing line survives.
    expect(out).toContain('shrinkResources enableShrinkResources.toBoolean()');
  });

  it('is idempotent', () => {
    const once = patchBuildGradle(TEMPLATE);
    expect(patchBuildGradle(once)).toBe(once);
  });

  it('throws on a template it does not recognise instead of no-op-ing into a debug-signed release', () => {
    expect(() => patchBuildGradle('android {\n}\n')).toThrow(/signingConfigs\.debug block not found/);
    const noRelease = TEMPLATE.replace('            signingConfig signingConfigs.debug\n            def', '            def');
    expect(() => patchBuildGradle(noRelease)).toThrow(/release signingConfig line not found/);
  });
});
