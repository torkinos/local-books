/**
 * A real mainnet transaction, fetched verbatim via `getTransaction` (jsonParsed) from
 * solana-rpc.publicnode.com on 2026-08-23 (S1 tooling). Public chain data.
 *
 * Shape notes that drove the normalizer (see normalize/extract.ts):
 *   - parsed instructions carry no account lists;
 *   - the destination ATA's owner resolves only via pre/postTokenBalances;
 *   - `transferChecked` names mint and decimals inline.
 *
 * One plain transferChecked of 0.5 USDC: rrLC… -> 9WzD…, preceded by two ATA
 * createIdempotent instructions (a common wallet-app pattern).
 */
export const REAL_SPL_TRANSFER_CHECKED = {
  signature:
    '2UWGKQdPa6CJTbV7zwKvj9gmAgQyngKggdaNHtRuX7ExZ863ugaKNFNtYuKbj221FGCQy7yFNE9yuAL9aVTo4XMw',
  slot: 441095455,
  blockTime: 1787465383,
  sender: 'rrLCPad9qWyKDXgAaunP5UbqUMCfNpUKtt3x1YMwRjV',
  recipient: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
  raw: {
    blockTime: 1787465383,
    meta: {
      computeUnitsConsumed: 11880,
      err: null,
      fee: 5000,
      innerInstructions: [],
      postTokenBalances: [
        {
          accountIndex: 1,
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          owner: 'rrLCPad9qWyKDXgAaunP5UbqUMCfNpUKtt3x1YMwRjV',
          programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          uiTokenAmount: { amount: '134410', decimals: 6, uiAmount: 0.13441, uiAmountString: '0.13441' },
        },
        {
          accountIndex: 2,
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          owner: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
          programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          uiTokenAmount: {
            amount: '1093243449',
            decimals: 6,
            uiAmount: 1093.243449,
            uiAmountString: '1093.243449',
          },
        },
      ],
      preTokenBalances: [
        {
          accountIndex: 1,
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          owner: 'rrLCPad9qWyKDXgAaunP5UbqUMCfNpUKtt3x1YMwRjV',
          programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          uiTokenAmount: { amount: '634410', decimals: 6, uiAmount: 0.63441, uiAmountString: '0.63441' },
        },
        {
          accountIndex: 2,
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          owner: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
          programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          uiTokenAmount: {
            amount: '1092743449',
            decimals: 6,
            uiAmount: 1092.743449,
            uiAmountString: '1092.743449',
          },
        },
      ],
      status: { Ok: null },
    },
    slot: 441095455,
    transaction: {
      message: {
        accountKeys: [
          { pubkey: 'rrLCPad9qWyKDXgAaunP5UbqUMCfNpUKtt3x1YMwRjV', signer: true, source: 'transaction', writable: true },
          { pubkey: '9jLtYXZdVxJHzzLV3oppNGL5Vs9S1KX7b4PBaLj55bkq', signer: false, source: 'transaction', writable: true },
          { pubkey: 'FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B', signer: false, source: 'transaction', writable: true },
          { pubkey: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', signer: false, source: 'transaction', writable: false },
          { pubkey: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', signer: false, source: 'transaction', writable: false },
          { pubkey: '11111111111111111111111111111111', signer: false, source: 'transaction', writable: false },
          { pubkey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', signer: false, source: 'transaction', writable: false },
          { pubkey: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', signer: false, source: 'transaction', writable: false },
        ],
        addressTableLookups: [],
        instructions: [
          {
            parsed: {
              info: {
                account: '9jLtYXZdVxJHzzLV3oppNGL5Vs9S1KX7b4PBaLj55bkq',
                mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                source: 'rrLCPad9qWyKDXgAaunP5UbqUMCfNpUKtt3x1YMwRjV',
                systemProgram: '11111111111111111111111111111111',
                tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                wallet: 'rrLCPad9qWyKDXgAaunP5UbqUMCfNpUKtt3x1YMwRjV',
              },
              type: 'createIdempotent',
            },
            program: 'spl-associated-token-account',
            programId: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
            stackHeight: 1,
          },
          {
            parsed: {
              info: {
                account: 'FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B',
                mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                source: 'rrLCPad9qWyKDXgAaunP5UbqUMCfNpUKtt3x1YMwRjV',
                systemProgram: '11111111111111111111111111111111',
                tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                wallet: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
              },
              type: 'createIdempotent',
            },
            program: 'spl-associated-token-account',
            programId: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
            stackHeight: 1,
          },
          {
            parsed: {
              info: {
                authority: 'rrLCPad9qWyKDXgAaunP5UbqUMCfNpUKtt3x1YMwRjV',
                destination: 'FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B',
                mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                source: '9jLtYXZdVxJHzzLV3oppNGL5Vs9S1KX7b4PBaLj55bkq',
                tokenAmount: { amount: '500000', decimals: 6, uiAmount: 0.5, uiAmountString: '0.5' },
              },
              type: 'transferChecked',
            },
            program: 'spl-token',
            programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            stackHeight: 1,
          },
        ],
        recentBlockhash: 'EiHztz94X2M6pofEdRUSXQg2xPcQWkoahmzoQ3WZxhU7',
      },
      signatures: [
        '2UWGKQdPa6CJTbV7zwKvj9gmAgQyngKggdaNHtRuX7ExZ863ugaKNFNtYuKbj221FGCQy7yFNE9yuAL9aVTo4XMw',
      ],
    },
    version: 0,
  } as unknown,
} as const;
