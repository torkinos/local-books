/**
 * S1 spike: a real RpcPort adapter over fetch, instrumented with call counters.
 *
 * Mirrors what the production adapter in apps/mobile will do (T9): surface 429s as
 * RateLimitedError instead of retrying, so the core driver owns pacing.
 */
import { RateLimitedError } from './core-dist.mjs';

export function makeRpc({ url, label, metrics }) {
  async function call(method, params) {
    metrics.calls += 1;
    const t0 = performance.now();
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
    } catch (err) {
      metrics.networkErrors += 1;
      throw err;
    }
    metrics.httpMsTotal += performance.now() - t0;
    if (res.status === 429) {
      metrics.rateLimited += 1;
      const ra = res.headers.get('retry-after');
      throw new RateLimitedError(label, ra ? Number(ra) * 1000 : undefined);
    }
    if (!res.ok) {
      metrics.httpErrors += 1;
      throw new Error(`${label}: HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
    }
    const json = await res.json();
    if (json.error) {
      if (json.error.code === 429 || /rate.?limit|too many/i.test(json.error.message ?? '')) {
        metrics.rateLimited += 1;
        throw new RateLimitedError(label);
      }
      throw new Error(`${label}: RPC ${json.error.code}: ${json.error.message}`);
    }
    return json.result;
  }

  return {
    endpointLabel: label,

    async getSignatures(address, opts) {
      const result = await call('getSignaturesForAddress', [
        address,
        {
          limit: opts.limit,
          commitment: 'confirmed',
          ...(opts.before ? { before: opts.before } : {}),
        },
      ]);
      return {
        signatures: result.map((s) => ({
          signature: s.signature,
          slot: s.slot,
          blockTime: s.blockTime ?? null,
          err: s.err !== null,
        })),
        // Solana pages backwards; a short page means history is exhausted.
        nextBefore: result.length < opts.limit ? null : result[result.length - 1].signature,
      };
    },

    async getTransactions(signatures) {
      const out = [];
      for (const sig of signatures) {
        const raw = await call('getTransaction', [
          sig,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
        ]);
        out.push({ signature: sig, slot: raw?.slot ?? 0, blockTime: raw?.blockTime ?? null, raw });
      }
      return out;
    },

    /** Probe: does this endpoint accept JSON-RPC batch arrays, and up to what size? */
    async batchGetTransactions(signatures) {
      metrics.calls += 1;
      const body = signatures.map((sig, i) => ({
        jsonrpc: '2.0',
        id: i,
        method: 'getTransaction',
        params: [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
      }));
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429) {
        metrics.rateLimited += 1;
        throw new RateLimitedError(label);
      }
      const json = await res.json().catch(() => null);
      return { httpStatus: res.status, ok: Array.isArray(json), size: Array.isArray(json) ? json.length : 0 };
    },
  };
}

export function freshMetrics() {
  return { calls: 0, rateLimited: 0, httpErrors: 0, networkErrors: 0, httpMsTotal: 0 };
}
