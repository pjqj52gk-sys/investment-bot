import YahooFinance from 'yahoo-finance2';

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
}

function calculateEMA(data: number[], p: number): number[] {
  const k = 2 / (p + 1);
  const ema = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
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

    const summary = `
【短期分析サマリー】
現在値: ${currentPrice} (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%)
5日線: ${ma5?.toFixed(2)}, 25日線: ${ma25?.toFixed(2)}
1時間足トレンド: ${shortTermTrend}
MACDヒストグラム: ${macdHist.toFixed(2)}
    `.trim();

    return { 
      ticker: yahooSymbol, 
      currentPrice, 
      ma5, 
      ma25, 
      macd: { macd: currentMacd, signal: currentSignal, hist: macdHist }, 
      shortTermTrend, 
      isOwned: false, // index.ts で上書きされる
      avgPrice: null, // index.ts で上書きされる
      summary, 
      change, 
      changePercent
    };
  } catch (error) {
    console.error(`[ERROR] Technical data fetch failed for ${ticker}:`, error);
    return "テクニカルデータ取得エラー";
  }
}
