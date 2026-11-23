import { LAMPORTS_PER_SOL } from './vendor/makefun-bot.ts';
import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  maxAgeSlots: number;
  minTrades: number;
  minBuyers: number;
  minNetSol: number;
  minDevBuySol: number;
  maxDevBuySol: number;
  maxBuyers: number;
  minRqSol: number;
  maxRqSol: number;
  maxRunup: number;
  maxSellRatio: number;
  initialStakeSol: number;
  addTriggerMult: number;
  addCheckNetSol: number;
  maxStakeSol: number;
  addSol: number;
  minBuyLamports: number;
  takeProfit: number;
  stopLoss: number;
  trailArm: number;
  trailDrop: number;
  maxHoldSlots: number;
  staleSlots: number;
  fadeNetSol: number;
  wideNetTriggerCurves: number;
  wideNetMinCoins: number;
  wideNetMinTrades: number;
  wideNetMinNetSol: number;
  wideNetMaxAge: number;
  wideNetMaxBuyers: number;
  maxExposureSol: number;
  cooldownSlots: number;
  tapeLimit: number;
}

export const DEFAULT_PARAMS: Params = {
  maxAgeSlots: 12,
  minTrades: 3,
  minBuyers: 3,
  minNetSol: 0.15,
  minDevBuySol: 0.01,
  maxDevBuySol: 3.0,
  maxBuyers: 8,
  minRqSol: 0.2,
  maxRqSol: 40.0,
  maxRunup: 1.25,
  maxSellRatio: 0.5,
  initialStakeSol: 0.1,
  addTriggerMult: 1.10,
  addCheckNetSol: 0.2,
  maxStakeSol: 0.12,
  addSol: 0.04,
  minBuyLamports: 10_000_000,
  takeProfit: 1.5, // sell the whole position at +50%
  stopLoss: 0.94,
  trailArm: 1.50,
  trailDrop: 0.85,
  maxHoldSlots: 900,
  staleSlots: 300,
  fadeNetSol: -0.5,
  wideNetTriggerCurves: 400,
  wideNetMinCoins: 15,
  wideNetMinTrades: 2,
  wideNetMinNetSol: 0.02,
  wideNetMaxAge: 30,
  wideNetMaxBuyers: 20,
  maxExposureSol: 6.0,
  cooldownSlots: 100,
  tapeLimit: 40,
};

interface TradeRecord {
  slot: number;
  price: number;
  isBuy: boolean;
  sol: number;
  user: Pubkey;
}

interface CoinState {
  mint: Pubkey;
  createdSlot: number;
  creator: Pubkey;
  creatorBuySol: number;
  creatorSold: boolean;
  tape: TradeRecord[];
  lastTradeSlot: number;
  peakValRatio: number;
  entrySlot: number;
  lastBuyPrice: number;
  addsCount: number;
  cooldownUntil: number;
  spentSol: number;
  createPrice: number;
  nonCreatorBuyers: Set<string>;
  distinctBuyers: Set<string>;
  totalBuySolOthers: number;
  totalSellSolOthers: number;
}

export function createStrategy(params: Params = DEFAULT_PARAMS): Bot {
  const coins = new Map<string, CoinState>();
  const distinctCoinsTraded = new Set<string>();

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const orders: OrderInput[] = [];
      let newPositionsCount = 0;
      let totalExposureSol = 0;

      for (const [mint, pos] of state.positions.entries()) {
        const curve = state.curves.get(mint);
        if (curve) {
          const price = Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
          const costSol = Number(pos.cost_lamports) / Number(LAMPORTS_PER_SOL);
          totalExposureSol += costSol;
        }
      }

      for (const event of batch.events) {
        if (event.event === 'CreateEvent') {
          if (!coins.has(event.mint)) {
            const initPrice = Number(event.virtual_quote_reserves) / Number(event.virtual_token_reserves);
            coins.set(event.mint, {
              mint: event.mint,
              createdSlot: event.slot,
              creator: event.creator,
              creatorBuySol: 0,
              creatorSold: false,
              tape: [],
              lastTradeSlot: event.slot,
              peakValRatio: 1.0,
              entrySlot: 0,
              lastBuyPrice: 0,
              addsCount: 0,
              cooldownUntil: 0,
              spentSol: 0,
              createPrice: initPrice,
              nonCreatorBuyers: new Set<string>(),
              distinctBuyers: new Set<string>(),
              totalBuySolOthers: 0,
              totalSellSolOthers: 0,
            });
          }
        } else if (event.event === 'TradeEvent') {
          const coin = coins.get(event.mint);
          if (coin) {
            coin.lastTradeSlot = event.slot;
            const price = Number(event.virtual_quote_reserves) / Number(event.virtual_token_reserves);
            const solVal = Number(BigInt(event.sol_amount)) / Number(LAMPORTS_PER_SOL);

            if (event.user === coin.creator) {
              if (event.is_buy && event.slot === coin.createdSlot) {
                coin.creatorBuySol += solVal;
              }
              if (!event.is_buy) {
                coin.creatorSold = true;
              }
            } else {
              if (event.is_buy) {
                coin.nonCreatorBuyers.add(event.user);
                coin.distinctBuyers.add(event.user);
                coin.totalBuySolOthers += solVal;
              } else {
                coin.totalSellSolOthers += solVal;
              }
            }

            coin.tape.push({
              slot: event.slot,
              price,
              isBuy: event.is_buy,
              sol: solVal,
              user: event.user,
            });

            if (coin.tape.length > params.tapeLimit) {
              coin.tape.shift();
            }
          }
        }
      }

      const curvesSeenCount = state.curves.size;
      const relaxed = curvesSeenCount > params.wideNetTriggerCurves && distinctCoinsTraded.size < params.wideNetMinCoins;
      const curMaxAge = relaxed ? params.wideNetMaxAge : params.maxAgeSlots;
      const curMinTrades = relaxed ? params.wideNetMinTrades : params.minTrades;
      const curMinNetSol = relaxed ? params.wideNetMinNetSol : params.minNetSol;
      const curMaxBuyers = relaxed ? params.wideNetMaxBuyers : params.maxBuyers;

      for (const [mint, coin] of coins.entries()) {
        const curve = state.curves.get(mint);
        if (!curve || curve.complete) continue;

        const hasPosition = state.positions.has(mint);
        const age = batch.slot - coin.createdSlot;

        if (hasPosition) {
          const pos = state.positions.get(mint)!;
          const price = Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
          const costNum = Number(pos.cost_lamports);
          const tokenNum = Number(pos.token_amount);
          const valNum = tokenNum * price;
          const valRatio = valNum / costNum;

          if (valRatio > coin.peakValRatio) {
            coin.peakValRatio = valRatio;
          }

          let tapeNetSol = 0;
          for (const t of coin.tape) {
            tapeNetSol += t.isBuy ? t.sol : -t.sol;
          }

          let fadeNet = 0;
          const fadeSlice = coin.tape.slice(-20);
          for (const t of fadeSlice) {
            fadeNet += t.isBuy ? t.sol : -t.sol;
          }

          let shouldExit = false;
          if (valRatio >= params.takeProfit) shouldExit = true;
          else if (valRatio <= params.stopLoss) shouldExit = true;
          else if (coin.peakValRatio >= params.trailArm && valRatio <= coin.peakValRatio * params.trailDrop) shouldExit = true;
          else if ((batch.slot - coin.entrySlot) >= params.maxHoldSlots) shouldExit = true;
          else if (coin.creatorSold) shouldExit = true;
          else if ((batch.slot - coin.lastTradeSlot) >= params.staleSlots) shouldExit = true;
          else if (fadeNet < params.fadeNetSol) shouldExit = true;

          if (shouldExit) {
            orders.push({
              side: 'sell',
              mint,
              token_amount: pos.token_amount,
              max_slippage_bps: 10000,
            });
            coin.cooldownUntil = batch.slot + params.cooldownSlots;
            continue;
          }

          if (coin.addsCount === 0 &&
              price >= coin.lastBuyPrice * params.addTriggerMult &&
              tapeNetSol >= params.addCheckNetSol &&
              coin.spentSol < params.maxStakeSol &&
              orders.length < state.hello.caps.max_orders_per_batch) {

            const addSolTarget = params.addSol;
            const addLamports = BigInt(Math.floor(addSolTarget * Number(LAMPORTS_PER_SOL)));
            const maxBuyL = state.maxBuyLamports(mint);
            const allowedBuyL = addLamports < maxBuyL ? addLamports : maxBuyL;
            const feeL = state.txFeeLamports();
            const freeC = state.freeCashLamports();

            if (allowedBuyL >= BigInt(params.minBuyLamports) && freeC >= (allowedBuyL + feeL)) {
              orders.push({
                side: 'buy',
                mint,
                quote_lamports: allowedBuyL,
                max_slippage_bps: 1000,
              });
              coin.spentSol += Number(allowedBuyL) / Number(LAMPORTS_PER_SOL);
              coin.addsCount++;
              coin.lastBuyPrice = price;
            }
          }
        } else {
          const price = Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
          if (batch.slot < coin.cooldownUntil) continue;
          if (age < 0 || age > curMaxAge) continue;
          if (coin.tape.length < curMinTrades) continue;
          if (coin.nonCreatorBuyers.size < params.minBuyers) continue;

          let tapeNetSol = 0;
          for (const t of coin.tape) {
            tapeNetSol += t.isBuy ? t.sol : -t.sol;
          }
          if (tapeNetSol < curMinNetSol) continue;
          if (coin.creatorSold) continue;
          if (coin.creatorBuySol < params.minDevBuySol || coin.creatorBuySol > params.maxDevBuySol) continue;
          if (coin.nonCreatorBuyers.size > curMaxBuyers) continue;

          const realSol = Number(curve.real_quote_reserves) / Number(LAMPORTS_PER_SOL);
          if (realSol < params.minRqSol || realSol > params.maxRqSol) continue;

          if (price > coin.createPrice * params.maxRunup) continue;

          const sellRatio = coin.totalBuySolOthers > 0 ? (coin.totalSellSolOthers / coin.totalBuySolOthers) : 0;
          if (sellRatio > params.maxSellRatio) continue;

          const currentCommitted = state.committedPositionCount();
          const maxOpen = state.hello.caps.max_open_positions;
          if ((currentCommitted + newPositionsCount) >= maxOpen) continue;
          if ((totalExposureSol + params.initialStakeSol) > params.maxExposureSol) continue;
          if (orders.length >= state.hello.caps.max_orders_per_batch) continue;

          const stakeSol = params.initialStakeSol;
          const stakeLamports = BigInt(Math.floor(stakeSol * Number(LAMPORTS_PER_SOL)));
          const maxBuyL = state.maxBuyLamports(mint);
          const allowedBuyL = stakeLamports < maxBuyL ? stakeLamports : maxBuyL;
          const feeL = state.txFeeLamports();
          const freeC = state.freeCashLamports();

          if (allowedBuyL >= BigInt(params.minBuyLamports) && freeC >= (allowedBuyL + feeL)) {
            orders.push({
              side: 'buy',
              mint,
              quote_lamports: allowedBuyL,
              max_slippage_bps: 1000,
            });
            newPositionsCount++;
            totalExposureSol += Number(allowedBuyL) / Number(LAMPORTS_PER_SOL);
            coin.entrySlot = batch.slot;
            coin.lastBuyPrice = price;
            coin.peakValRatio = 1.0;
            coin.addsCount = 0;
            coin.spentSol = Number(allowedBuyL) / Number(LAMPORTS_PER_SOL);
            distinctCoinsTraded.add(mint);
          }
        }
      }

      return orders;
    },
  };
}
