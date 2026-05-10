import YahooFinance from 'yahoo-finance2';
import axios from 'axios';
import { fetchEnhancedFinancials, FinancialContext } from './fetchFinancials';
import { fetchMacroContext, fetchUnusualOptions, MacroData } from './fetchMacro';

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
  macro: MacroData;
  dataTimestamp: Date;
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
  vix: { price: number, change?: string };
  macro: MacroData;
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
    let marketTime = quotes.length > 0 ? quotes[quotes.length - 1].date : new Date();
    const finnhubKey = process.env.FINNHUB_API_KEY;
    const fmpKey = process.env.FMP_API_KEY;

    const isJP = ticker.endsWith('.T') || /^\d{4}$/.test(ticker);
    const cleanTicker = isJP && !ticker.endsWith('.T') ? `${ticker}.T` : ticker;
    const symbolOnly = cleanTicker.split('.')[0];

    if (isJP) {
      // --- 日本株: 究極のリアルタイム取得 (Yahoo JP > Nikkei > Kabutan > Google) ---
      const randomUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

      // 1. Yahoo Finance JP (本家)
      try {
        const res = await axios.get(`https://finance.yahoo.co.jp/quote/${cleanTicker}`, { headers: { 'User-Agent': randomUA }, timeout: 3000 });
        const m = res.data.match(/_3rA9nb_j[^>]*>([\d,.]+)</) || res.data.match(/StyledNumber[^>]*>([\d,.]+)</) || res.data.match(/"price":([\d.]+)/);
        if (m) {
          finalPrice = parseFloat(m[1].replace(/,/g, ''));
          isRealTime = true;
          marketTime = new Date();
          console.log(`[REALTIME JP] Yahoo JP success: ${finalPrice}`);
        }
      } catch (e) {}

      // 2. 日経新聞 (Nikkei)
      if (!isRealTime) {
        try {
          const res = await axios.get(`https://www.nikkei.com/nkd/company/?scode=${symbolOnly}`, { headers: { 'User-Agent': randomUA }, timeout: 3000 });
          const m = res.data.match(/class="m-stockPriceElm_value[^>]*>([\d,.]+)<\/span>/);
          if (m) {
            finalPrice = parseFloat(m[1].replace(/,/g, ''));
            isRealTime = true;
            console.log(`[REALTIME JP] Nikkei success: ${finalPrice}`);
          }
        } catch (e) {}
      }

      // 3. 株探 (Kabutan)
      if (!isRealTime) {
        try {
          const res = await axios.get(`https://kabutan.jp/stock/?code=${symbolOnly}`, { headers: { 'User-Agent': randomUA }, timeout: 3000 });
          const m = res.data.match(/<span class="kabuka">([\d,.]+)<\/span>/);
          if (m) {
            finalPrice = parseFloat(m[1].replace(/,/g, ''));
            isRealTime = true;
            console.log(`[REALTIME JP] Kabutan success: ${finalPrice}`);
          }
        } catch (e) {}
      }

      // 4. Google Finance (バックアップ)
      if (!isRealTime) {
        try {
          const res = await axios.get(`https://www.google.com/finance/quote/${symbolOnly}:TYO?hl=ja`, { headers: { 'User-Agent': randomUA }, timeout: 3000 });
          const m = res.data.match(/data-last-price="([\d,.]+)"/);
          if (m) { finalPrice = parseFloat(m[1].replace(/,/g, '')); isRealTime = true; }
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
              marketTime = new Date(fhQuote.data.t * 1000);
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
当日高値: ${quotes[quotes.length - 1]?.high?.toFixed(2)}, 当日安値: ${quotes[quotes.length - 1]?.low?.toFixed(2)}
出来高: ${quotes[quotes.length - 1]?.volume?.toLocaleString()}
5日線: ${ma5?.toFixed(2)}, 25日線: ${ma25?.toFixed(2)}
1時間足トレンド: ${shortTermTrend}
5分足トレンド: ${veryShortTrend}
MACDヒストグラム: ${macdHist.toFixed(2)}
    `.trim();

    const enhancedFinancials = await fetchEnhancedFinancials(ticker);
    const macroData = await fetchMacroContext();
    
    if (!isJpStock) {
      macroData.unusualOptions = await fetchUnusualOptions(ticker);
    }

    let analystTarget = null;
    let analystRatings = null;
    if (!ticker.includes('.')) {
      try {
        const targetRes = await fetch(`https://finnhub.io/api/v1/stock/price-target?symbol=${ticker}&token=${process.env.FINNHUB_API_KEY}`);
        const targetData = await targetRes.json();
        if (targetData && targetData.targetMean) {
          analystTarget = {
            mean: targetData.targetMean,
            high: targetData.targetHigh,
            low: targetData.targetLow,
            upside: (((targetData.targetMean / finalPrice) - 1) * 100).toFixed(2) + "%"
          };
        }

        const ratingRes = await fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${process.env.FINNHUB_API_KEY}`);
        const ratingData = await ratingRes.json();
        if (ratingData && ratingData.length > 0) {
          analystRatings = ratingData[0];
        }

        // Reddit/Twitterのソーシャルセンチメントを取得
        const socialRes = await fetch(`https://finnhub.io/api/v1/stock/social-sentiment?symbol=${ticker}&token=${process.env.FINNHUB_API_KEY}`);
        const socialData = await socialRes.json();
        if (socialData) {
          const reddit = socialData.reddit?.[0] || { mention: 0, positiveScore: 0, sentiment: 0 };
          const twitter = socialData.twitter?.[0] || { mention: 0, positiveScore: 0, sentiment: 0 };
          (enhancedFinancials as any).socialSentiment = {
            reddit: `言及数: ${reddit.mention}, センチメント: ${reddit.sentiment?.toFixed(2)}`,
            twitter: `言及数: ${twitter.mention}, センチメント: ${twitter.sentiment?.toFixed(2)}`
          };
        }
      } catch (err) {
        console.error("Finnhub extra data fetch error:", err);
      }
    }

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
      change: finalPrice - (quotes.length >= 2 ? (quotes[quotes.length - 2]?.close || 0) : 0), 
      changePercent: finalChangePercent,
      financials: {
        ...enhancedFinancials,
        analystTarget,
        analystRatings
      },
      macro: {
        ...macroData,
        analystTarget,
        analystRatings
      },
      dataTimestamp: marketTime
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
    const macroData = await fetchMacroContext();
    return {
      nikkei: getInfo("^N225"),
      sp500: getInfo("^GSPC"),
      vix: getInfo("^VIX"),
      macro: macroData
    };
  } catch (error) {
    console.error("Market context error:", error);
    return {
      nikkei: { price: 0, change: "0%" },
      sp500: { price: 0, change: "0%" },
      vix: { price: 0 },
      macro: { economicEvents: "不明", usdJpy: 0, us10Y: 0 }
    };
  }
}
