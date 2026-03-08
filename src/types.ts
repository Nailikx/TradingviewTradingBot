export interface TradingViewAlert {
  token: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity?: number;
  stopLoss: number;
  takeProfit: number;
}

export interface BitunixOrderRequest {
  symbol: string;
  qty: number;
  side: 'BUY' | 'SELL';
  tradeSide: 'OPEN' | 'CLOSE';
  orderType: 'MARKET' | 'LIMIT';
  stopLoss?: number;
  takeProfit?: number;
  price?: number;
}

export interface BitunixResponse {
  code: number;
  msg: string;
  data: any;
}
