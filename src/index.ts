import express from 'express';
import dotenv from 'dotenv';
import { BitunixAPI } from './bitunix';
import { TradingViewAlert } from './types';
dotenv.config();

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

const bitunix = new BitunixAPI(BITUNIX_API_KEY, BITUNIX_API_SECRET);
const RISK_PERCENT = 0.03; // 3% risk per trade
const LIMIT_BUFFER = 0.0005; // 0.05% buffer to guarantee fill

app.post('/webhook', async (req, res) => {
  try {
    const alert: TradingViewAlert = req.body;

    if (alert.token !== TRADINGVIEW_TOKEN) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    if (!alert.symbol || !alert.side || !alert.stopLoss || !alert.takeProfit) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Step 1: Get current USDT futures balance
    const accountInfo = await bitunix.getAccountInfo();
    const usdtBalance = parseFloat(accountInfo.data.available);
    console.log(`Balance: ${usdtBalance} USDT`);

    // Step 2: Get current price
    const ticker = await bitunix.getTicker(alert.symbol);
    const currentPrice = parseFloat(ticker.data.lastPrice);
    console.log(`Current price: ${currentPrice}`);

    // Step 3: Calculate aggressive limit price to guarantee fill
    // BUY → slightly above market | SELL → slightly below market
    const limitPrice = alert.side === 'BUY'
      ? parseFloat((currentPrice * (1 + LIMIT_BUFFER)).toFixed(2))
      : parseFloat((currentPrice * (1 - LIMIT_BUFFER)).toFixed(2));
    console.log(`Limit price: ${limitPrice}`);

    // Step 4: Calculate position size so SL = exactly 3% of balance
    const riskAmount = usdtBalance * RISK_PERCENT;
    const slDistance = Math.abs(currentPrice - alert.stopLoss);

    if (slDistance === 0) {
      return res.status(400).json({ error: 'Stop loss cannot equal entry price' });
    }

    const quantity = parseFloat((riskAmount / slDistance).toFixed(3));
    console.log(`Risk: $${riskAmount.toFixed(2)} | SL Distance: $${slDistance.toFixed(2)} | Qty: ${quantity}`);

    // Step 5: Place limit order (maker fee instead of taker fee)
    const order = await bitunix.placeOrder({
      symbol: alert.symbol,
      qty: quantity,
      side: alert.side,
      tradeSide: 'OPEN',
      orderType: 'LIMIT',
      price: limitPrice,
      stopLoss: alert.stopLoss,
      takeProfit: alert.takeProfit
    });

    console.log(`✅ Order placed: ${order.data.orderId} | Price: ${limitPrice} | SL: ${alert.stopLoss} | TP: ${alert.takeProfit}`);
    res.json({
      status: 'Order placed',
      orderId: order.data.orderId,
      balance: usdtBalance,
      riskAmount: riskAmount.toFixed(2),
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

app.get('/health', (_, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
