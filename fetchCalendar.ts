import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export interface EconomicEvent {
  event: string;
  country: string;
  date: string;
  estimate: string | number | null;
  prev: string | number | null;
  impact: string; // "Low", "Medium", "High"
}

export interface EarningsEvent {
  ticker: string;
  date: string;
  hour: string; // "am", "pm" (market open or close)
  epsEstimate: number | null;
  revenueEstimate: number | null;
}

/**
 * 今日の重要経済指標を取得
 */
export async function fetchEconomicCalendar(): Promise<EconomicEvent[]> {
  const apiKey = process.env.FINNHUB_API_KEY;
  try {
    // 今日と明日のデータを取得
    const today = new Date().toISOString().split('T')[0];
    const response = await axios.get(`https://finnhub.io/api/v1/calendar/economic?token=${apiKey}`);
    
    // 米国と日本の重要度(impact)が高いものを抽出
    return response.data.economicCalendar
      .filter((e: any) => (e.country === 'United States' || e.country === 'Japan'))
      .map((e: any) => ({
        event: e.event,
        country: e.country,
        date: e.date,
        estimate: e.estimate,
        prev: e.prev,
        impact: e.impact === 'High' ? '🔴HIGH' : e.impact === 'Medium' ? '🟡MED' : '⚪LOW'
      }))
      .slice(0, 10);
  } catch (error) {
    console.error("Economic calendar fetch error:", error);
    return [];
  }
}

/**
 * 指定した期間の決算スケジュールを取得
 */
export async function fetchEarningsCalendar(tickers: string[]): Promise<EarningsEvent[]> {
  const apiKey = process.env.FINNHUB_API_KEY;
  try {
    const from = new Date().toISOString().split('T')[0];
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 14); // 2週間先まで
    const to = toDate.toISOString().split('T')[0];
    
    const response = await axios.get(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${apiKey}`);
    
    return response.data.earningsCalendar
      .filter((e: any) => tickers.includes(e.symbol))
      .map((e: any) => ({
        ticker: e.symbol,
        date: e.date,
        hour: e.hour,
        epsEstimate: e.epsEstimate,
        revenueEstimate: e.revenueEstimate
      }));
  } catch (error) {
    console.error("Earnings calendar fetch error:", error);
    return [];
  }
}
