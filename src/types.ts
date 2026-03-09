export interface TradingViewAlert {
  token: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity?: number;
  stopLoss: number;
  takeProfit: number;
  rr?: number;
}

export interface BitunixOrderRequest {
  symbol: string;
  qty: number;
  side: 'BUY' | 'SELL';
  tradeSide: 'OPEN' | 'CLOSE';
  orderType: 'MARKET' | 'LIMIT';
  price?: number;
  tpPrice?: number;
  tpStopType?: string;
  tpOrderType?: string;
  slPrice?: number;
  slStopType?: string;
  slOrderType?: string;
}

export interface BitunixResponse {
  code: number;
  msg: string;
  data: any;
}
