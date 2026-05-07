import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const FMP_API_KEY = process.env.FMP_API_KEY;

export interface MacroData {
  economicEvents: string;
  usdJpy: number;
  us10Y: number;
}

/**
 * マクロ経済データを取得 (FMP API)
 */
export async function fetchMacroContext(): Promise<MacroData> {
  let economicEvents = "特になし";
  let usdJpy = 0;
  let us10Y = 0;

  try {
    if (FMP_API_KEY) {
      const today = new Date().toISOString().split('T')[0];
      
      // 1. 経済カレンダー (インパクトの大きいイベントを抽出)
      const econRes = await axios.get(`https://financialmodelingprep.com/api/v3/economic_calendar?from=${today}&to=${today}&apikey=${FMP_API_KEY}`);
      if (econRes.data && Array.isArray(econRes.data)) {
        economicEvents = econRes.data
          .filter((e: any) => e.impact === 'High')
          .map((e: any) => `${e.event} (Impact: ${e.impact})`)
          .join(', ') || "重要なイベントなし";
      }

      // 2. 為替 (USD/JPY)
      const forexRes = await axios.get(`https://financialmodelingprep.com/api/v3/quote/USDJPY?apikey=${FMP_API_KEY}`);
      if (forexRes.data && forexRes.data.length > 0) {
        usdJpy = forexRes.data[0].price;
      }

      // 3. 米10年債利回り
      const treasuryRes = await axios.get(`https://financialmodelingprep.com/api/v4/treasury?from=${today}&to=${today}&apikey=${FMP_API_KEY}`);
      if (treasuryRes.data && treasuryRes.data.length > 0) {
        us10Y = treasuryRes.data[0].tenY;
      }
    }
  } catch (error) {
    console.error("[ERROR] Macro data fetch failed:", error);
  }

  return { economicEvents, usdJpy, us10Y };
}
