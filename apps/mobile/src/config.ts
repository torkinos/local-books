/**
 * Build-time configuration (D18), kept free of Expo imports so the rules are
 * unit-tested in Node and so tokens.ts can import the network without dragging
 * native modules into vitest.
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` when bundling (babel-preset-expo's
 * inline-env-vars, bracket or dot access alike), so each value below is a literal
 * fixed per build, never changed at runtime. Which files feed it: @expo/env loads
 * `.env.<mode>.local`, `.env.local`, `.env.<mode>`, `.env` — and plain `.env` is
 * loaded for EVERY mode, release included. That is why the devnet switch belongs in
 * `.env.development` (debug builds and `expo start` only) and never in `.env`: a
 * release build then cannot inherit it by accident. See apps/mobile/.env.example.
 */
export type Network = 'devnet' | 'mainnet';

/**
 * Anything other than the literal 'devnet' is mainnet: a typo, an empty string, or
 * an absent variable must never ship a devnet build to a real user.
 */
export function parseNetwork(value: string | undefined): Network {
  return value === 'devnet' ? 'devnet' : 'mainnet';
}

export type RpcUrlSetting =
  | { readonly kind: 'unset' }
  | { readonly kind: 'ok'; readonly url: string }
  | { readonly kind: 'invalid'; readonly value: string };

/**
 * A user-supplied RPC URL (PROJECT.md line 72). Empty and whitespace-only values are
 * "unset"; anything that is not an http(s) URL is "invalid" and the caller IGNORES
 * it with a warning. It cannot be rejected at build time (babel inlines whatever the
 * env holds), and throwing here would run at module evaluation on the device --
 * before any screen exists to show the error -- so a release build with a typo
 * would simply close on launch. Falling back to the public endpoints is the honest
 * degradation: the ledger still works, and the warning names the value in logcat.
 */
export function parseRpcUrl(value: string | undefined): RpcUrlSetting {
  const trimmed = value?.trim();
  if (!trimmed) return { kind: 'unset' };
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return { kind: 'invalid', value: trimmed };
  return { kind: 'ok', url: trimmed };
}

export const NETWORK: Network = parseNetwork(process.env['EXPO_PUBLIC_NETWORK']);

const RPC_URL_SETTING = parseRpcUrl(process.env['EXPO_PUBLIC_RPC_URL']);

/** First in the RPC failover list when set (D9). Undefined when unset or invalid. */
export const USER_RPC_URL: string | undefined =
  RPC_URL_SETTING.kind === 'ok' ? RPC_URL_SETTING.url : undefined;

/** Anything the build's configuration was refused for; ports.ts logs these once. */
export const CONFIG_WARNINGS: readonly string[] =
  RPC_URL_SETTING.kind === 'invalid'
    ? [
        `EXPO_PUBLIC_RPC_URL ignored: not an http(s) URL (${JSON.stringify(RPC_URL_SETTING.value)}). ` +
          'Using the public endpoints.',
      ]
    : [];
