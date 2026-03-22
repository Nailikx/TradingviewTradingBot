export interface GodCheatAlert {
  token: string;
  message: string;
}

export interface ParsedSignal {
  signal: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  sl: number;
  tp: number;
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

export interface ActiveTrade {
  symbol: string;
  positionId: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  originalSL: number;
  halfSlTriggered: boolean;
  signal: string;
}
