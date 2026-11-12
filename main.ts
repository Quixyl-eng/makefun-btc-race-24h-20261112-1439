// btc-race-24h-20261112-1439. Node 22 and the vendored protocol shim.
// Four sleeves on the one-minute bars. The opening hour buys one pullback.
// After that, a rising hour buys a deeper dip. One flat-hour bounce is allowed
// while the session is still up, and one sharp twenty-minute drop gets a
// single bounce of its own. A stop caps every trade. Both runs read the same
// bars, see the same hello and batches, and send the same orders.

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
const SCALP_LOOK = 40;
const SCALP_DIP = 50n;
const SCALP_TP = 50n;
const SCALP_STOP = 80n;
const SCALP_DAY = 40n;
const SCALP_HOUR = 40n;
const BOUNCE_LOOK = 20;
const BOUNCE_DIP = 60n;
const BOUNCE_TP = 50n;
const BOUNCE_STOP = 80n;
const BOUNCE_DROP = 40n;
const SLIP = 300;

const closes: bigint[] = [];
let openUsed = false;
let scalpUsed = false;
let bounceUsed = false;
let sleeveTp = TP_BPS;
let sleeveStop = STOP_BPS;

function windowHigh(end: number, look: number): bigint {
  let high = 0n;
  const start = end - look;
  for (let i = start; i < end; i++) {
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
      const hi = windowHigh(closes.length, OPEN_LOOK);
      if (price * 10_000n <= hi * (10_000n - OPEN_DIP)) {
        openUsed = true;
        sleeveTp = OPEN_TP;
        sleeveStop = OPEN_STOP;
        return [{ side: 'buy', symbol, notional_quote_units: cash, max_slippage_bps: SLIP }];
      }
    }
    if (closes.length <= TREND || closes.length <= LOOK) return [];
    const past = closes[closes.length - 1 - TREND]!;
    if (price > past) {
      const high = windowHigh(closes.length, LOOK);
      if (price * 10_000n <= high * (10_000n - DIP_BPS)) {
        sleeveTp = TP_BPS;
        sleeveStop = STOP_BPS;
        return [{ side: 'buy', symbol, notional_quote_units: cash, max_slippage_bps: SLIP }];
      }
    }
    if (!scalpUsed && price <= past && price * 10_000n >= past * (10_000n - SCALP_HOUR)) {
      const day = closes[0]!;
      if (price * 10_000n >= day * (10_000n + SCALP_DAY)) {
        const high = windowHigh(closes.length, SCALP_LOOK);
        if (price * 10_000n <= high * (10_000n - SCALP_DIP)) {
          const prev = closes[closes.length - 2]!;
          const prevHigh = windowHigh(closes.length - 1, SCALP_LOOK);
          if (prev * 10_000n > prevHigh * (10_000n - SCALP_DIP)) {
            scalpUsed = true;
            sleeveTp = SCALP_TP;
            sleeveStop = SCALP_STOP;
            return [{ side: 'buy', symbol, notional_quote_units: cash, max_slippage_bps: SLIP }];
          }
        }
      }
    }
    if (!bounceUsed && price <= past && closes.length > BOUNCE_LOOK) {
      const recent = closes[closes.length - 1 - BOUNCE_LOOK]!;
      if (price * 10_000n <= recent * (10_000n - BOUNCE_DROP)) {
        const dropHigh = windowHigh(closes.length, BOUNCE_LOOK);
        if (price * 10_000n <= dropHigh * (10_000n - BOUNCE_DIP)) {
          const earlier = closes[closes.length - 2]!;
          const earlierHigh = windowHigh(closes.length - 1, BOUNCE_LOOK);
          if (earlier * 10_000n > earlierHigh * (10_000n - BOUNCE_DIP)) {
            bounceUsed = true;
            sleeveTp = BOUNCE_TP;
            sleeveStop = BOUNCE_STOP;
            return [{ side: 'buy', symbol, notional_quote_units: cash, max_slippage_bps: SLIP }];
          }
        }
      }
    }
    return [];
  },
});
