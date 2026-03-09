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

    console.log('PROXY DEBUG:', proxyHost, proxyPort, proxyUser, proxyPass ? 'pass-set' : 'no-pass');

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

  private generateSignature(nonce: string, timestamp: string, queryParams: string, body: string): string {
    const digestInput = nonce + timestamp + this.apiKey + queryParams + body;
    const digest = crypto.createHash('sha256').update(digestInput).digest('hex');
    const signInput = digest + this.secretKey;
    return crypto.createHash('sha256').update(signInput).digest('hex');
  }

  private async request(method: 'GET' | 'POST', endpoint: string, body: any = {}, queryParams: string = ''): Promise<BitunixResponse> {
    const nonce = this.generateNonce();
    const timestamp = Date.now().toString();
    const bodyStr = method === 'POST' ? JSON.stringify(body) : '';
    const signature = this.generateSignature(nonce, timestamp, queryParams, bodyStr);

    const headers = {
      'api-key': this.apiKey,
      'nonce': nonce,
      'timestamp': timestamp,
      'sign': signature,
      'Content-Type': 'application/json'
    };

    const config = {
      headers,
      ...(this.proxyAgent && { httpsAgent: this.proxyAgent })
    };

    const url = queryParams
      ? `${this.baseUrl}${endpoint}?${queryParams}`
      : `${this.baseUrl}${endpoint}`;

    try {
      const response = method === 'POST'
        ? await axios.post<BitunixResponse>(url, body, config)
        : await axios.get<BitunixResponse>(url, config);

      if (response.data.code !== 0) {
        throw new Error(`Bitunix API error: ${response.data.msg} (code: ${response.data.code})`);
      }
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.log('Axios error code:', error.code);
        console.log('Axios error message:', error.message);
        console.log('Response status:', error.response?.status);
        console.log('Response data:', JSON.stringify(error.response?.data));
        throw new Error(`Bitunix API error: ${error.response?.data?.msg || error.message}`);
      }
      throw error;
    }
  }

  async placeOrder(order: BitunixOrderRequest): Promise<BitunixResponse> {
    return this.request('POST', '/api/v1/futures/trade/place_order', order);
  }

  async getAccountInfo(): Promise<BitunixResponse> {
    const nonce = this.generateNonce();
    const timestamp = Date.now().toString();
    const queryParams = 'marginCoin=USDT';
    const signature = this.generateSignature(nonce, timestamp, queryParams, '');

    const config = {
      headers: {
        'api-key': this.apiKey,
        'nonce': nonce,
        'timestamp': timestamp,
        'sign': signature,
        'Content-Type': 'application/json'
      },
      ...(this.proxyAgent && { httpsAgent: this.proxyAgent })
    };

    const response = await axios.get<BitunixResponse>(
      `${this.baseUrl}/api/v1/futures/account?${queryParams}`,
      config
    );
    return response.data;
  }

  async getTicker(symbol: string): Promise<BitunixResponse> {
    const nonce = this.generateNonce();
    const timestamp = Date.now().toString();
    const queryParams = `symbol=${symbol}`;
    const signature = this.generateSignature(nonce, timestamp, queryParams, '');

    const config = {
      headers: {
        'api-key': this.apiKey,
        'nonce': nonce,
        'timestamp': timestamp,
        'sign': signature,
        'Content-Type': 'application/json'
      },
      ...(this.proxyAgent && { httpsAgent: this.proxyAgent })
    };

    const response = await axios.get<BitunixResponse>(
      `${this.baseUrl}/api/v1/futures/market/tickers?${queryParams}`,
      config
    );
    return response.data;
  }

  async getOpenPositions(): Promise<BitunixResponse> {
    return this.request('GET', '/api/v1/futures/position/get_pending_positions');
  }

  async modifySL(symbol: string, positionId: string, newSL: number): Promise<BitunixResponse> {
    return this.request('POST', '/api/v1/futures/trade/modify_tpsl', {
      symbol,
      positionId,
      stopLoss: newSL
    });
  }
}
