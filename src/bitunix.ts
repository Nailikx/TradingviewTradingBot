import axios from 'axios';
import crypto from 'crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { BitunixOrderRequest, BitunixResponse } from './types';

export class BitunixAPI {
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly baseUrl = 'https://fapi.bitunix.com';
  private readonly proxyAgent: any;

  constructor(
    apiKey: string,
    secretKey: string,
    proxyHost?: string,
    proxyPort?: string,
    proxyUser?: string,
    proxyPass?: string
  ) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;

    if (proxyHost && proxyPort && proxyUser && proxyPass) {
      const proxyUrl = `http://${proxyUser}:${proxyPass}@${proxyHost}:${proxyPort}`;
      this.proxyAgent = new HttpsProxyAgent(proxyUrl);
      console.log('✅ Proxy enabled');
    } else {
      this.proxyAgent = null;
      console.log('⚠️ No proxy configured');
    }
  }

  private generateNonce(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private buildQuerySignaturePart(params: Record<string, string>): string {
    return Object.keys(params)
      .sort()
      .map(k => k + params[k])
      .join('');
  }

  private generateSignature(nonce: string, timestamp: string, querySignaturePart: string, body: string): string {
    const digestInput = nonce + timestamp + this.apiKey + querySignaturePart + body;
    const digest = crypto.createHash('sha256').update(digestInput).digest('hex');
    const signInput = digest + this.secretKey;
    return crypto.createHash('sha256').update(signInput).digest('hex');
  }

  private getConfig(nonce: string, timestamp: string, sign: string) {
    return {
      headers: {
        'api-key': this.apiKey,
        'nonce': nonce,
        'timestamp': timestamp,
        'sign': sign,
        'Content-Type': 'application/json'
      },
      ...(this.proxyAgent && { httpsAgent: this.proxyAgent })
    };
  }

  async getAccountInfo(): Promise<BitunixResponse> {
    const nonce = this.generateNonce();
    const timestamp = Date.now().toString();
    const params = { marginCoin: 'USDT' };
    const querySignaturePart = this.buildQuerySignaturePart(params);
    const sign = this.generateSignature(nonce, timestamp, querySignaturePart, '');
    const config = this.getConfig(nonce, timestamp, sign);

    const response = await axios.get<BitunixResponse>(
      `${this.baseUrl}/api/v1/futures/account?marginCoin=USDT`,
      config
    );
    return response.data;
  }

  async getTicker(symbol: string): Promise<BitunixResponse> {
    const nonce = this.generateNonce();
    const timestamp = Date.now().toString();
    const params = { symbols: symbol };
    const querySignaturePart = this.buildQuerySignaturePart(params);
    const sign = this.generateSignature(nonce, timestamp, querySignaturePart, '');
    const config = this.getConfig(nonce, timestamp, sign);

    const response = await axios.get<BitunixResponse>(
      `${this.baseUrl}/api/v1/futures/market/tickers?symbols=${symbol}`,
      config
    );
    return response.data;
  }

  async changeLeverage(symbol: string, leverage: number): Promise<BitunixResponse> {
    const nonce = this.generateNonce();
    const timestamp = Date.now().toString();
    const body = { symbol, leverage, marginCoin: 'USDT' };
    const bodyStr = JSON.stringify(body);
    const sign = this.generateSignature(nonce, timestamp, '', bodyStr);
    const config = this.getConfig(nonce, timestamp, sign);

    const response = await axios.post<BitunixResponse>(
      `${this.baseUrl}/api/v1/futures/account/change_leverage`,
      body,
      config
    );
    return response.data;
  }

  async placeOrder(order: BitunixOrderRequest): Promise<BitunixResponse> {
    const nonce = this.generateNonce();
    const timestamp = Date.now().toString();
    const bodyStr = JSON.stringify(order);
    const sign = this.generateSignature(nonce, timestamp, '', bodyStr);
    const config = this.getConfig(nonce, timestamp, sign);

    const response = await axios.post<BitunixResponse>(
      `${this.baseUrl}/api/v1/futures/trade/place_order`,
      order,
      config
    );

    if (response.data.code !== 0) {
      throw new Error(`Bitunix API error: ${response.data.msg} (code: ${response.data.code})`);
    }
    return response.data;
  }

  async getOpenPositions(): Promise<BitunixResponse> {
    const nonce = this.generateNonce();
    const timestamp = Date.now().toString();
    const sign = this.generateSignature(nonce, timestamp, '', '');
    const config = this.getConfig(nonce, timestamp, sign);

    const response = await axios.get<BitunixResponse>(
      `${this.baseUrl}/api/v1/futures/position/get_pending_positions`,
      config
    );
    return response.data;
  }

  async modifySL(symbol: string, positionId: string, newSL: number): Promise<BitunixResponse> {
    const nonce = this.generateNonce();
    const timestamp = Date.now().toString();
    const body = { symbol, positionId, stopLoss: newSL };
    const bodyStr = JSON.stringify(body);
    const sign = this.generateSignature(nonce, timestamp, '', bodyStr);
    const config = this.getConfig(nonce, timestamp, sign);

    const response = await axios.post<BitunixResponse>(
      `${this.baseUrl}/api/v1/futures/trade/modify_tpsl`,
      body,
      config
    );

    if (response.data.code !== 0) {
      throw new Error(`Bitunix API error: ${response.data.msg} (code: ${response.data.code})`);
    }
    return response.data;
  }
}
