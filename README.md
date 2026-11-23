# PUMP SPRINT

Original momentum paper-trading bot built for the `make.fun` pump.fun replay/v2 harness (competition slug: `u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4`).

## What It Is

PUMP SPRINT is a deterministic, high-frequency momentum paper-trading bot designed to capture micro-uptrends on newly launched bonding curves. Operating under strict constraints (10 SOL capital, 2-slot latency, protocol/creator fees, and gas), it maintains a rolling tape of trades per mint, filters for genuine buyer dispersion and net buying pressure, scales into winning positions via pyramid adds, and guards against drawdowns with strict multi-trigger exits and a wide-net fallback to guarantee participation targets.

## Strategy in Plain Words

- **Maturity Wait:** Ignores newly spawned curves until they have aged at least 60 slots (or 30 slots under the wide-net guardrail) to filter out instant rug-pulls and bots sniping block 0.
- **Net-Inflow Filter:** Inspects a rolling tape of the last 40 trades for each mint. It requires at least 8 trades, $\ge 6$ distinct buyers, a maximum single-buyer concentration $\le 40\%$, net positive buy volume ($\ge 0.5$ SOL over the tape), and price momentum (up $\ge 4\%$ from the start of the tape while not down more than $5\%$ from its local peak).
- **Pyramid Adds:** Opens an initial position of 0.04 SOL (capped by max buy limits), and progressively scales in with up to 2 pyramid adds (+0.02 SOL each) if price climbs $\ge 3\%$ above the last buy price and momentum remains net-positive.
- **Four Exits:** 
  1. *Stop Loss:* Exits the entire position if current value drops $\le 88\%$ of cost.
  2. *Trailing Stop:* Locks in gains once a position peaks at $\ge 1.25\times$ cost, exiting if value drops $\le 88\%$ of that peak.
  3. *Time Exit:* Force-closes positions held past 1800 slots.
  4. *Fade Exit:* Exits immediately if net buy volume over the last 20 trades turns negative ($\le -0.3$ SOL).
- **Wide-Net Guardrail:** Monitors overall portfolio diversity. If the bot has observed over 300 curves but traded fewer than 12 distinct coins, it temporarily relaxes entry criteria (net buy SOL $\ge 0.2$, $\ge 4$ buyers, price up $\ge 2\%$, age $\ge 30$) to ensure it clears the competition requirement of trading at least 20 distinct coins.

## Files

- `main.ts`: Entry point initializing and running the bot via the SDK.
- `strategy.ts`: Core strategy logic, parameter definitions (`Params`, `DEFAULT_PARAMS`), rolling tape management, signal evaluation, and order generation.
- `vendor/makefun-bot.ts`: Byte-identical vendored copy of the make.fun replay SDK (`u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4`).

## How to Grade Locally

Run the local grader using the CLI harness provided in the parent workspace:

```bash
node cli/makefun.mjs grade-local --kit <kit> --bot <repo> --driver process
```

## Guardrails & Constraints

- **Diversity & Size:** Must complete the run with round trips of at least 0.01 SOL on $\ge 20$ distinct coins.
- **Risk Control:** Maximum drawdown capped at $\le 50\%$; total cost across open positions never exceeds 4 SOL; maximum 5 open positions.
- **Profitability:** Must beat holding cash ($Net\,PnL > 0$).
- **Determinism:** 100% deterministic execution (strictly insertion-ordered Maps fed by the batch stream, zero use of `Date`, `Math.random()`, or wall-clock time) ensuring byte-for-byte identical action logs across runs.
