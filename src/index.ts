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
const RISK_PERCENT = 0.03; // 3% per trade

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
    console.log(`Current balance: ${usdtBalance} USDT`);

    // Step 2: Get current price
    const ticker = await bitunix.getTicker(alert.symbol);
    const currentPrice = parseFloat(ticker.data.lastPrice);
    console.log(`Current price: ${currentPrice}`);

    // Step 3: Calculate 3% of balance in USDT, then convert to coin quantity
    const riskAmount = usdtBalance * RISK_PERCENT;
    const quantity = parseFloat((riskAmount / currentPrice).toFixed(3));
    console.log(`Risk amount: $${riskAmount.toFixed(2)} | Quantity: ${quantity}`);

    // Step 4: Place order
    const order = await bitunix.placeOrder({
      symbol: alert.symbol,
      qty: quantity,
      side: alert.side,
      tradeSide: 'OPEN',
      orderType: 'MARKET',
      stopLoss: alert.stopLoss,
      takeProfit: alert.takeProfit
    });

    console.log(`Order placed: ${order.data.orderId} | SL: ${alert.stopLoss} | TP: ${alert.takeProfit}`);
    res.json({ 
      status: 'Order placed', 
      orderId: order.data.orderId,
      balance: usdtBalance,
      riskAmount: riskAmount.toFixed(2),
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
