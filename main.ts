/**
 * PUMP SPRINT: Bot Entry Point
 * Competition: u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4
 * Harness: pumpfun-replay/v2
 */
import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS)); // deterministic: no clock, no randomness
