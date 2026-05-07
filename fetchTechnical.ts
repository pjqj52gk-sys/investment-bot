import YahooFinance from 'yahoo-finance2';
import axios from 'axios';
import { fetchEnhancedFinancials, FinancialContext } from './fetchFinancials';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

export interface TechnicalData {
  ticker: string;
  currentPrice: number;
  ma5: number | null;
  ma25: number | null;
  macd: { macd: number; signal: number; hist: number } | null;
  shortTermTrend: string;
  isOwned: boolean;
  avgPrice: number | null;
  summary: string;
  change: number;
  changePercent: number;
  financials?: FinancialContext;
}

function calculateEMA(data: number[], p: number): number[] {
  const k = 2 / (p + 1);
  const ema = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

export interface MarketContext {
  nikkei: { price: number, change: string };
  sp500: { price: number, change: string };
  vix: { price: number, change: string };
}

export async function fetchTechnicalData(ticker: string): Promise<TechnicalData | string> {
  // 日本株か米国株か判定
  const isJpStock = /^[0-9]{3,4}[0-9A-Z]?$/.test(ticker);
  const yahooSymbol = isJpStock ? `${ticker}.T` : ticker;

  try {
    // 過去90日分のデータを取得（EMA計算用）
    const result = await yahooFinance.chart(yahooSymbol, { 
      period1: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), 
      interval: '1d' 
    });

    const quotes = result.quotes.filter((q): q is { close: number; date: Date } => q.close !== null);
    if (quotes.length === 0) throw new Error("株価データが見つかりません。");

    const dailyCloses = quotes.map(q => q.close);
    const currentPrice = dailyCloses[dailyCloses.length - 1];
    
    // 前日比計算
    const prevClose = dailyCloses[dailyCloses.length - 2];
    const change = currentPrice - prevClose;
    const changePercent = (change / prevClose) * 100;

    // 移動平均 (5日, 25日)
    const ma5 = dailyCloses.length >= 5 ? dailyCloses.slice(-5).reduce((a, b) => a + b, 0) / 5 : null;
    const ma25 = dailyCloses.length >= 25 ? dailyCloses.slice(-25).reduce((a, b) => a + b, 0) / 25 : null;
    
    // MACD (12, 26, 9)
    const ema12 = calculateEMA(dailyCloses, 12);
    const ema26 = calculateEMA(dailyCloses, 26);
    const macdValues = ema12.map((val, i) => val - ema26[i]);
    const signalLine = calculateEMA(macdValues, 9);
    
    const currentMacd = macdValues[macdValues.length - 1];
    const currentSignal = signalLine[signalLine.length - 1];
    const macdHist = currentMacd - currentSignal;

    // 1時間足トレンド（直近1週間の1時間足）
    const hourly = await yahooFinance.chart(yahooSymbol, { 
      period1: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), 
      interval: '1h' 
    });
    const hourlyCloses = hourly.quotes.map(q => q.close).filter((c): c is number => c !== null);
    const shortTermTrend = hourlyCloses[hourlyCloses.length - 1] > hourlyCloses[hourlyCloses.length - 3] 
      ? "上昇傾向" 
      : "下落傾向";

    // 5分足トレンド（直近2日間の5分足）
    const fiveMin = await yahooFinance.chart(yahooSymbol, { 
      period1: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), 
      interval: '5m' 
    });
    const fiveMinCloses = fiveMin.quotes.map(q => q.close).filter((c): c is number => c !== null);
    let veryShortTrend = "データ不足";
    if (fiveMinCloses.length >= 3) {
      veryShortTrend = fiveMinCloses[fiveMinCloses.length - 1] > fiveMinCloses[fiveMinCloses.length - 3] 
        ? "上昇傾向" 
        : "下落傾向";
    }

    // --- Real-time Price Integration (Finnhub & FMP & Google Scraping) ---
    let finalPrice = currentPrice;
    let finalChangePercent = changePercent;
    let isRealTime = false;
    const finnhubKey = process.env.FINNHUB_API_KEY;
    const fmpKey = process.env.FMP_API_KEY;

    if (ticker.endsWith('.T')) {
      // --- 日本株: 三段構えのスクレイピング (Google + Yahoo JP + Kabutan) ---
      const symbolOnly = ticker.split('.')[0];
      const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36'
      ];
      const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

      // 1. Google Finance 試行
      try {
        const res = await axios.get(`https://www.google.com/finance/quote/${symbolOnly}:TYO?hl=ja`, {
          headers: { 'User-Agent': randomUA },
          timeout: 5000
        });
        const m = res.data.match(/data-last-price="([\d,.]+)"/);
        if (m) {
          finalPrice = parseFloat(m[1].replace(/,/g, ''));
          const cm = res.data.match(/data-price-change-percentage="([\d,.-]+)"/);
          if (cm) finalChangePercent = parseFloat(cm[1]);
          isRealTime = true;
          console.log(`[REALTIME JP] Google success: ${finalPrice}`);
        }
      } catch (e) {}

      // 2. Yahoo Finance JP 試行
      if (!isRealTime) {
        try {
          const res = await axios.get(`https://finance.yahoo.co.jp/quote/${ticker}`, {
            headers: { 'User-Agent': randomUA },
            timeout: 5000
          });
          const m = res.data.match(/_3rA9nb_j[^>]*>([\d,.]+)</) || res.data.match(/StyledNumber[^>]*>([\d,.]+)</);
          if (m) {
            finalPrice = parseFloat(m[1].replace(/,/g, ''));
            isRealTime = true;
            console.log(`[REALTIME JP] Yahoo JP success: ${finalPrice}`);
          }
        } catch (e) {}
      }

      // 3. 株探 (Kabutan) 試行 - 最後の切り札
      if (!isRealTime) {
        try {
          const res = await axios.get(`https://kabutan.jp/stock/?code=${symbolOnly}`, {
            headers: { 'User-Agent': randomUA },
            timeout: 5000
          });
          const m = res.data.match(/<span class="kabuka">([\d,.]+)<\/span>/);
          if (m) {
            finalPrice = parseFloat(m[1].replace(/,/g, ''));
            isRealTime = true;
            console.log(`[REALTIME JP] Kabutan success: ${finalPrice}`);
          }
        } catch (e) {}
      }
    }
 else if (!ticker.includes('.')) {
      // --- US株: FMP & Finnhub ---
      try {
        if (fmpKey) {
          const fmpQuote = await axios.get(`https://financialmodelingprep.com/api/v3/quote/${ticker}?apikey=${fmpKey}`);
          if (fmpQuote.data && fmpQuote.data.length > 0) {
            finalPrice = fmpQuote.data[0].price;
            finalChangePercent = fmpQuote.data[0].changesPercentage;
            isRealTime = true;
          }
        }
        if (finnhubKey) {
          const fhQuote = await axios.get(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${finnhubKey}`);
          if (fhQuote.data && fhQuote.data.c && fhQuote.data.t > 0) {
            if (Math.abs(fhQuote.data.c - finalPrice) > 0.01 || !isRealTime) {
              finalPrice = fhQuote.data.c;
              finalChangePercent = fhQuote.data.dp;
              isRealTime = true;
            }
          }
        }
      } catch (e) {
        console.log("Real-time API fetch failed, using Yahoo fallback.");
      }
    }

    const summary = `
【短期分析サマリー】
現在値: ${finalPrice} (${finalChangePercent > 0 ? '+' : ''}${finalChangePercent.toFixed(2)}%) ${isRealTime ? '⚡(Real-time)' : '🕒(Delayed)'}
5日線: ${ma5?.toFixed(2)}, 25日線: ${ma25?.toFixed(2)}
1時間足トレンド: ${shortTermTrend}
5分足トレンド: ${veryShortTrend}
MACDヒストグラム: ${macdHist.toFixed(2)}
    `.trim();

    const enhancedFinancials = await fetchEnhancedFinancials(ticker);

    return { 
      ticker: yahooSymbol, 
      currentPrice: finalPrice, 
      ma5, 
      ma25, 
      macd: { macd: currentMacd, signal: currentSignal, hist: macdHist }, 
      shortTermTrend, 
      isOwned: false, 
      avgPrice: null, 
      summary, 
      change, 
      changePercent: finalChangePercent,
      financials: enhancedFinancials
    };
  } catch (error) {
    console.error(`[ERROR] Technical data fetch failed for ${ticker}:`, error);
    return "テクニカルデータ取得エラー";
  }
}

export async function fetchMarketContext(): Promise<MarketContext> {
  const symbols = ["^N225", "^GSPC", "^VIX"];
  try {
    const results = await yahooFinance.quote(symbols);
    const getInfo = (sym: string) => {
      const q = results.find(r => r.symbol === sym);
      return {
        price: q?.regularMarketPrice || 0,
        change: q?.regularMarketChangePercent?.toFixed(2) + "%" || "0%"
      };
    };
    return {
      nikkei: getInfo("^N225"),
      sp500: getInfo("^GSPC"),
      vix: getInfo("^VIX")
    };
  } catch (error) {
    console.error("Market context error:", error);
    return {
      nikkei: { price: 0, change: "0%" },
      sp500: { price: 0, change: "0%" },
      vix: { price: 0, change: "0%" }
    };
  }
}
