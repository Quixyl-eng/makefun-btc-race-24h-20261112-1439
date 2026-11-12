// btc-race-24h-20261112-1439. Node 22 and the vendored protocol shim.
// Buy cbBTC only when a 60-minute rise has pulled back, then sell at the target.
// A wide stop caps a crash. Two runs read the same bars and send the same orders.

import { runBars } from './vendor/makefun-bars.ts';

const DIP_BPS = 60n;
const TREND = 60;
const LOOK = 40;
const TP_BPS = 80n;
const STOP_BPS = 1200n;
const SLIP = 250;

const closes: bigint[] = [];

function windowHigh(look: number): bigint {
  let high = 0n;
  for (let i = closes.length - look; i < closes.length; i++) {
    const price = closes[i]!;
    if (price > high) high = price;
  }
  return high;
}

await runBars({
  onBatch(state, batch) {
    const symbol = state.hello.symbols[0]!.symbol;
    const bar = batch.bars.find((item) => item.symbol === symbol);
    if (bar === undefined) return [];
    closes.push(BigInt(bar.c));
    if (state.warmingUp) return [];
    const price = closes[closes.length - 1]!;
    const held = state.positions.get(symbol);
    if (held !== undefined && held.qty > 0n) {
      const mark = state.value(symbol, held.qty);
      const target = (held.cost * (10_000n + TP_BPS)) / 10_000n;
      const stop = (held.cost * (10_000n - STOP_BPS)) / 10_000n;
      if (mark >= target || mark <= stop) {
        return [{ side: 'sell', symbol, qty: held.qty, max_slippage_bps: SLIP }];
      }
      return [];
    }
    if (closes.length <= TREND || closes.length <= LOOK) return [];
    const past = closes[closes.length - 1 - TREND]!;
    if (price <= past) return [];
    const high = windowHigh(LOOK);
    if (price * 10_000n > high * (10_000n - DIP_BPS)) return [];
    if (state.cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    return [{ side: 'buy', symbol, notional_quote_units: state.cash, max_slippage_bps: SLIP }];
  },
});
