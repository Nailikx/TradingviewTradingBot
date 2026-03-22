import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { BitunixAPI } from './bitunix';
import { GodCheatAlert, ParsedSignal, ActiveTrade } from './types';

const app = express();
app.use(express.json());

const {
  PORT = 3000,
  WEBHOOK_SECRET,
  BITUNIX_API_KEY,
  BITUNIX_API_SECRET,
  RISK_PCT = '0.03',
  MAX_LEVERAGE = '20',
  COPY_ACCOUNTS = '',
} = process.env;

if (!WEBHOOK_SECRET || !BITUNIX_API_KEY || !BITUNIX_API_SECRET) {
  throw new Error('Missing required env vars: WEBHOOK_SECRET, BITUNIX_API_KEY, BITUNIX_API_SECRET');
}

const RISK_PERCENT = parseFloat(RISK_PCT);
const MAX_LEV = parseInt(MAX_LEVERAGE);
const LIMIT_BUFFER = 0.0005; // 0.05% buffer for limit order
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const mainApi = new BitunixAPI(BITUNIX_API_KEY, BITUNIX_API_SECRET);

const copyApis: BitunixAPI[] = COPY_ACCOUNTS
  .split(',')
  .filter(s => s.includes(':'))
  .map(s => {
    const [key, secret] = s.split(':');
    return new BitunixAPI(key, secret);
  });

const activeTrades = new Map<string, ActiveTrade>();
const tradeLog: any[] = [];

function parseGodCheatAlert(message: string): ParsedSignal | null {
  if (!message || message.includes('👀')) return null;
  const slMatch = message.match(/SL\s+([\d.]+)/);
  const tpMatch = message.match(/TP\s+([\d.]+)/);
  if (!slMatch || !tpMatch) return null;
  const sl = parseFloat(slMatch[1]);
  const tp = parseFloat(tpMatch[1]);
  if (!sl || !tp) return null;
  let signal = '';
  let side: 'BUY' | 'SELL' = 'BUY';
  if      (message.includes('VSB Long'))   { signal = 'VSB Long';   side = 'BUY';  }
  else if (message.includes('RSI50 Long')) { signal = 'RSI50 Long'; side = 'BUY';  }
  else if (message.includes('Dbl Bottom')) { signal = 'Dbl Bottom'; side = 'BUY';  }
  else if (message.includes('VSB Short'))  { signal = 'VSB Short';  side = 'SELL'; }
  else return null;
  const symMatch = message.match(/—\s+([A-Z]+USDT)/);
  const symbol = symMatch ? symMatch[1] : 'BTCUSDT';
  return { signal, symbol, side, sl, tp };
}

async function executeTrade(api: BitunixAPI, parsed: ParsedSignal, label: string): Promise<any> {
  const log: any = { account: label, signal: parsed.signal, side: parsed.side, time: new Date().toISOString() };
  try {
    // 1. Balance
    const accountInfo = await api.getAccountInfo();
    const balance = parseFloat(accountInfo.data.available);
    log.balance = balance.toFixed(2);
    if (balance < 5) throw new Error(`Balance too low: $${balance}`);

    // 2. Current price
    const ticker = await api.getTicker(parsed.symbol);
    const price = parseFloat(ticker.data[0].lastPrice);
    log.price = price;

    // 3. Limit price — slightly above for BUY, slightly below for SELL
    const limitPrice = parsed.side === 'BUY'
      ? parseFloat((price * (1 + LIMIT_BUFFER)).toFixed(2))
      : parseFloat((price * (1 - LIMIT_BUFFER)).toFixed(2));

    // 4. Set leverage based on this trade's notional
    const slDist = Math.abs(limitPrice - parsed.sl);
    if (slDist === 0) throw new Error('SL cannot equal entry price');
    const riskUsd = balance * RISK_PERCENT;
    const qty = parseFloat((riskUsd / slDist).toFixed(3));
    if (qty < 0.001) throw new Error(`Qty too small: ${qty}`);
    const notional = qty * limitPrice;
    const reqLev = Math.ceil(notional / balance);
    const leverage = Math.min(Math.max(reqLev, 1), MAX_LEV);

    // Only set leverage if no open position (avoid error when already open)
    const positions = await api.getOpenPositions();
    const positionList = positions.data?.list || [];
    const hasOpen = positionList.some((p: any) => p.symbol === parsed.symbol);
    if (!hasOpen) {
      await api.changeLeverage(parsed.symbol, leverage);
      console.log(`  [${label}] Leverage: ${leverage}x`);
    }

    // 5. Place LIMIT order — multiple trades allowed simultaneously
    const order = await api.placeOrder({
      symbol: parsed.symbol,
      qty,
      side: parsed.side,
      tradeSide: 'OPEN',
      orderType: 'LIMIT',
      price: limitPrice,
      tpPrice: parsed.tp,
      tpStopType: 'MARK_PRICE',
      tpOrderType: 'MARKET',
      slPrice: parsed.sl,
      slStopType: 'MARK_PRICE',
      slOrderType: 'MARKET',
    });

    const orderId = order.data?.orderId;

    if (label === 'MAIN' && orderId) {
      activeTrades.set(orderId, {
        symbol: parsed.symbol,
        positionId: orderId,
        side: parsed.side,
        entryPrice: limitPrice,
        stopLoss: parsed.sl,
        takeProfit: parsed.tp,
        originalSL: parsed.sl,
        halfSlTriggered: false,
        signal: parsed.signal,
      });
    }

    log.status = 'executed';
    log.qty = qty;
    log.limitPrice = limitPrice;
    log.sl = parsed.sl;
    log.tp = parsed.tp;
    log.leverage = leverage;
    log.riskUsd = riskUsd.toFixed(2);
    log.orderId = orderId;
    console.log(`  [${label}] ✅ LIMIT ${parsed.side} ${qty} @ $${limitPrice} | SL $${parsed.sl} | TP $${parsed.tp} | Risk $${riskUsd.toFixed(2)}`);

  } catch (err: any) {
    log.status = `error: ${err.message}`;
    console.error(`  [${label}] ❌ ${err.message}`);
  }
  return log;
}

app.post('/webhook', async (req, res) => {
  const { token, message } = req.body as GodCheatAlert;
  if (token !== WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'Invalid token' });
  }
  console.log(`\n📡 [${new Date().toISOString()}] ${message}`);
  if (message?.includes('👀')) {
    return res.json({ status: 'ignored' });
  }
  const parsed = parseGodCheatAlert(message);
  if (!parsed) {
    return res.json({ status: 'ignored', reason: 'unrecognized format' });
  }
  console.log(`  → ${parsed.signal} | ${parsed.side} | SL: ${parsed.sl} | TP: ${parsed.tp}`);
  const results = [];
  const mainResult = await executeTrade(mainApi, parsed, 'MAIN');
  results.push(mainResult);
  tradeLog.unshift(mainResult);
  for (let i = 0; i < copyApis.length; i++) {
    const result = await executeTrade(copyApis[i], parsed, `COPY_${i + 1}`);
    results.push(result);
    tradeLog.unshift(result);
  }
  if (tradeLog.length > 500) tradeLog.splice(500);
  res.json({ status: 'ok', signal: parsed.signal, results });
});

// Half-SL monitor
setInterval(async () => {
  if (activeTrades.size === 0) return;
  try {
    const positions = await mainApi.getOpenPositions();
    const openIds = new Set((positions.data?.list || []).map((p: any) => p.positionId));
    for (const [id, trade] of activeTrades.entries()) {
      if (!openIds.has(id)) {
        console.log(`Trade ${id} (${trade.signal}) closed`);
        activeTrades.delete(id);
        continue;
      }
      if (trade.halfSlTriggered) continue;
      const ticker = await mainApi.getTicker(trade.symbol);
      const currentPrice = parseFloat(ticker.data[0].lastPrice);
      const totalDist = Math.abs(trade.takeProfit - trade.entryPrice);
      const halfWay = trade.side === 'BUY'
        ? trade.entryPrice + totalDist * 0.5
        : trade.entryPrice - totalDist * 0.5;
      const reached = trade.side === 'BUY' ? currentPrice >= halfWay : currentPrice <= halfWay;
      if (reached) {
        const newSL = parseFloat(((trade.entryPrice + trade.originalSL) / 2).toFixed(2));
        await mainApi.modifySL(trade.symbol, id, newSL);
        trade.halfSlTriggered = true;
        console.log(`✅ Half-SL triggered for ${trade.signal} | New SL: $${newSL}`);
      }
    }
  } catch (err: any) {
    console.error('SL monitor error:', err.message);
  }
}, 30000);

app.get('/health', async (_, res) => {
  let balance = null;
  let positions = null;
  try {
    const acc = await mainApi.getAccountInfo();
    balance = parseFloat(acc.data.available).toFixed(2);
    const pos = await mainApi.getOpenPositions();
    positions = pos.data?.list || [];
  } catch (e) {}
  res.json({
    bot: 'GodCheat Auto-Trader',
    status: '🟢 running',
    risk: `${RISK_PERCENT * 100}% per trade`,
    maxLeverage: MAX_LEV,
    copyAccounts: copyApis.length,
    balance: balance ? `$${balance}` : 'error',
    openPositions: positions?.length || 0,
    activeTrades: activeTrades.size,
    totalTrades: tradeLog.length,
    recentTrades: tradeLog.slice(0, 5),
  });
});

app.get('/trades', (_, res) => {
  res.json({ total: tradeLog.length, trades: tradeLog });
});

app.get('/test', async (_, res) => {
  try {
    const ticker = await mainApi.getTicker('BTCUSDT');
    const acc = await mainApi.getAccountInfo();
    res.json({ success: true, price: ticker.data[0].lastPrice, balance: acc.data.available });
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🟢 GodCheat bot | Risk: ${RISK_PERCENT * 100}%/trade | Leverage: max ${MAX_LEV}x | Copies: ${copyApis.length}`);
});
