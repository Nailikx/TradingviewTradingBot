export interface TradingViewAlert {
  token: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity?: number;
  stopLoss: number;
  takeProfit: number;
}
