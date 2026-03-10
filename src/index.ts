import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { BitunixAPI } from './bitunix';
import { TradingViewAlert } from './types';

const app = express();
app.use(express.json());

const {
  PORT = 3000,
  TRADINGVIEW_TOKEN,
  BITUNIX_API_KEY,
  BITUNIX_API_SECRET
} = process.env;

if (!TRADINGVIEW_TOKEN || !BITUNIX_API_KEY || !BITUNIX_API_SECRET) {
  throw new Error('Missing required environment variables');
}

const bitunix = new BitunixAPI(
  BITUNIX_API_KEY,
  BITUNIX_API_SECRET,
  process.env.PROXY_HOST,
  process.env.PROXY_PORT,
  process.env.PROXY_USER,
  process.env.PROXY_PASS
);

const RISK_PERCENT = 0.03;
const LIMIT_BUFFER = 0.0005;
const MAX_LEVERAGE = 40;
const MIN_LEVERAGE = 1;

interface ActiveTrade {
  symbol: string;
  positionId: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  halfSlTriggered: boolean;
  originalSL: number;
}

const activeTrades: Map<string, ActiveTrade> = new Map();

app.post('/webhook', async (req, res) => {
  try {
    const alert: TradingViewAlert = req.body;

    if (alert.token !== TRADINGVIEW_TOKEN) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    if (!alert.symbol || !alert.side || !alert.stopLoss || !alert.takeProfit) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const MIN_RR = 0.5;
    if (alert.rr && alert.rr < MIN_RR) {
      console.log(`❌ Trade rejected — RR too low: ${alert.rr} (min ${MIN_RR})`);
      return res.status(200).json({ status: 'Trade skipped', reason: `RR ${alert.rr} below minimum ${MIN_RR}` });
    }

    // Step 1: Get balance
    const accountInfo = await bitunix.getAccountInfo();
    const usdtBalance = parseFloat(accountInfo.data.available);
    console.log(`Balance: ${usdtBalance} USDT`);

    // Step 2: Get current price
    const ticker = await bitunix.getTicker(alert.symbol);
    const currentPrice = parseFloat(ticker.data[0].lastPrice);
    console.log(`Current price: ${currentPrice}`);

    // Step 3: Calculate limit price
    const limitPrice = alert.side === 'BUY'
      ? parseFloat((currentPrice * (1 + LIMIT_BUFFER)).toFixed(2))
      : parseFloat((currentPrice * (1 - LIMIT_BUFFER)).toFixed(2));

    // Step 4: Calculate position size based on 3% risk
    const riskAmount = usdtBalance * RISK_PERCENT;
    const slDistance = Math.abs(currentPrice - alert.stopLoss);

    if (slDistance === 0) {
      return res.status(400).json({ error: 'Stop loss cannot equal entry price' });
    }

    const quantity = parseFloat((riskAmount / slDistance).toFixed(3));
    console.log(`Risk: $${riskAmount.toFixed(2)} | SL Distance: $${slDistance.toFixed(2)} | Qty: ${quantity}`);

    // Step 5: Calculate required leverage
    const notionalValue = quantity * currentPrice;
    const requiredLeverage = Math.ceil(notionalValue / usdtBalance);
    const leverage = Math.min(Math.max(requiredLeverage, MIN_LEVERAGE), MAX_LEVERAGE);
    console.log(`Notional: $${notionalValue.toFixed(2)} | Required leverage: ${requiredLeverage}x | Using: ${leverage}x`);

    // Step 6: Set leverage on Bitunix
    await bitunix.changeLeverage(alert.symbol, leverage);
    console.log(`✅ Leverage set to ${leverage}x`);

    // Step 7: Place limit order
    const order = await bitunix.placeOrder({
      symbol: alert.symbol,
      qty: quantity,
      side: alert.side,
      tradeSide: 'OPEN',
      orderType: 'LIMIT',
      price: limitPrice,
      tpPrice: alert.takeProfit,
      tpStopType: 'MARK_PRICE',
      tpOrderType: 'MARKET',
      slPrice: alert.stopLoss,
      slStopType: 'MARK_PRICE',
      slOrderType: 'MARKET'
    });

    const positionId = order.data.orderId;

    activeTrades.set(positionId, {
      symbol: alert.symbol,
      positionId,
      side: alert.side,
      entryPrice: limitPrice,
      stopLoss: alert.stopLoss,
      takeProfit: alert.takeProfit,
      halfSlTriggered: false,
      originalSL: alert.stopLoss
    });

    console.log(`✅ Order placed: ${positionId} | Price: ${limitPrice} | SL: ${alert.stopLoss} | TP: ${alert.takeProfit}`);
    res.json({
      status: 'Order placed',
      orderId: positionId,
      balance: usdtBalance,
      riskAmount: riskAmount.toFixed(2),
      leverage,
      limitPrice,
      quantity
    });

  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({
      error: 'Failed to place order',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

setInterval(async () => {
  if (activeTrades.size === 0) return;

  try {
    const positions = await bitunix.getOpenPositions();
    const openPositionIds = new Set(
      (positions.data?.list || []).map((p: any) => p.positionId)
    );

    for (const [positionId, trade] of activeTrades.entries()) {
      if (!openPositionIds.has(positionId)) {
        console.log(`Trade ${positionId} closed — removing from monitor`);
        activeTrades.delete(positionId);
        continue;
      }

      if (trade.halfSlTriggered) continue;

      const ticker = await bitunix.getTicker(trade.symbol);
      const currentPrice = parseFloat(ticker.data[0].lastPrice);

      const totalDistance = Math.abs(trade.takeProfit - trade.entryPrice);
      const halfWay = trade.side === 'BUY'
        ? trade.entryPrice + totalDistance * 0.5
        : trade.entryPrice - totalDistance * 0.5;

      const halfWayReached = trade.side === 'BUY'
        ? currentPrice >= halfWay
        : currentPrice <= halfWay;

      if (halfWayReached) {
        const newSL = parseFloat(((trade.entryPrice + trade.originalSL) / 2).toFixed(2));
        await bitunix.modifySL(trade.symbol, positionId, newSL);
        trade.halfSlTriggered = true;
        console.log(`✅ Half SL triggered for ${positionId} | New SL: ${newSL}`);
      }
    }
  } catch (error) {
    console.error('Error in SL monitor:', error);
  }
}, 30000);

app.get('/test', async (_, res) => {
  try {
    const ticker = await bitunix.getTicker('BTCUSDT');
    res.json({ success: true, price: ticker.data[0].lastPrice });
  } catch (error) {
    res.json({ success: false, error: error instanceof Error ? error.message : 'Unknown' });
  }
});

app.get('/health', (_, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
