// btc-race-24h-20261112-1439. Node 22 and the vendored protocol shim.
// One opening pullback, then dips only while the last hour is still rising.
// A stop caps each trade. Two runs read the same bars and send the same orders.

import { runBars } from './vendor/makefun-bars.ts';

const OPEN_BARS = 60;
const OPEN_LOOK = 20;
const OPEN_DIP = 40n;
const OPEN_TP = 80n;
const OPEN_STOP = 200n;
const DIP_BPS = 60n;
const TREND = 60;
const LOOK = 40;
const TP_BPS = 80n;
const STOP_BPS = 1200n;
const SLIP = 300;

const closes: bigint[] = [];
let openUsed = false;
let sleeveTp = TP_BPS;
let sleeveStop = STOP_BPS;

function windowHigh(look: number): bigint {
  let high = 0n;
  const start = closes.length - look;
  for (let i = start; i < closes.length; i++) {
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
      const target = (held.cost * (10_000n + sleeveTp)) / 10_000n;
      const floor = (held.cost * (10_000n - sleeveStop)) / 10_000n;
      if (mark >= target || mark <= floor) {
        return [{ side: 'sell', symbol, qty: held.qty, max_slippage_bps: SLIP }];
      }
      return [];
    }
    const cash = state.cash;
    if (cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    if (!openUsed && closes.length >= OPEN_LOOK && closes.length <= OPEN_BARS) {
      const hi = windowHigh(OPEN_LOOK);
      if (price * 10_000n <= hi * (10_000n - OPEN_DIP)) {
        openUsed = true;
        sleeveTp = OPEN_TP;
        sleeveStop = OPEN_STOP;
        return [{ side: 'buy', symbol, notional_quote_units: cash, max_slippage_bps: SLIP }];
      }
    }
    if (closes.length <= TREND || closes.length <= LOOK) return [];
    const past = closes[closes.length - 1 - TREND]!;
    if (price <= past) return [];
    const high = windowHigh(LOOK);
    if (price * 10_000n > high * (10_000n - DIP_BPS)) return [];
    sleeveTp = TP_BPS;
    sleeveStop = STOP_BPS;
    return [{ side: 'buy', symbol, notional_quote_units: cash, max_slippage_bps: SLIP }];
  },
});
