/**
 * JSON serialization for domain values that contain bigints.
 *
 * Every money field in the domain is a bigint (TokenAmount.raw,
 * InvoiceLineItem.unitAmount), and JSON.stringify throws on bigint. Round-trip
 * fidelity is non-negotiable: an op that comes back from SQLite different from how it
 * went in would corrupt the source of truth. bigints are wrapped as
 * `{"$bigint": "123"}` on the way out and revived on the way in.
 *
 * The wrapper shape cannot collide with domain data: no domain type has a `$bigint`
 * field, and free-text fields (memos, client names) are strings, which never
 * serialize as objects.
 */

const BIGINT_TAG = '$bigint';

/** Canonical bigint text: what bigint.toString() produces, and nothing else. */
const CANONICAL_BIGINT = /^-?\d+$/;

const isWrapperShape = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.keys(v).length === 1 &&
  typeof (v as Record<string, unknown>)[BIGINT_TAG] === 'string';

export function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'bigint') return { [BIGINT_TAG]: v.toString() };
    // A GENUINE object of the wrapper's shape in the input would come back as a
    // bigint -- silent round-trip infidelity in the source of truth. No persisted
    // domain type contains one today; if pass-through external data ever does, this
    // throw is the moment to switch to an escaping scheme rather than corrupt the log.
    if (isWrapperShape(v)) {
      throw new TypeError(`Refusing to serialize a value that collides with the ${BIGINT_TAG} wrapper`);
    }
    return v;
  });
}

export function deserialize<T>(json: string): T {
  return JSON.parse(json, (_key, v: unknown) => {
    if (isWrapperShape(v)) {
      const text = v[BIGINT_TAG] as string;
      // Strict: BigInt('') is 0n and BigInt('0x10') is 16n -- a corrupted wrapper
      // must fail LOUDLY, not deserialize into a silently wrong amount.
      if (!CANONICAL_BIGINT.test(text)) {
        throw new SyntaxError(`Corrupted ${BIGINT_TAG} wrapper: ${JSON.stringify(text)}`);
      }
      return BigInt(text);
    }
    return v;
  }) as T;
}
