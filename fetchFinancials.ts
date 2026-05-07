import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export interface FinancialContext {
  earningsDate: string | null;
  sentiment: {
    buzz: number;
    sentiment: number;
  } | null;
  insiderTransactions: string | null;
  fearAndGreed: number | null;
}

export async function fetchEnhancedFinancials(ticker: string): Promise<FinancialContext> {
  const finnhubKey = process.env.FINNHUB_API_KEY;
  const fmpKey = process.env.FMP_API_KEY;

  const result: FinancialContext = {
    earningsDate: null,
    sentiment: null,
    insiderTransactions: null,
    fearAndGreed: null,
  };

  try {
    // 1. Finnhub: 決算カレンダーとセンチメント
    if (finnhubKey) {
      // 決算
      const earningsRes = await axios.get(`https://finnhub.io/api/v1/calendar/earnings?from=2024-01-01&to=2025-12-31&symbol=${ticker}&token=${finnhubKey}`);
      if (earningsRes.data.earningsCalendar && earningsRes.data.earningsCalendar.length > 0) {
        result.earningsDate = earningsRes.data.earningsCalendar[0].date;
      }

      // ニュースセンチメント
      const sentimentRes = await axios.get(`https://finnhub.io/api/v1/news-sentiment?symbol=${ticker}&token=${finnhubKey}`);
      if (sentimentRes.data && sentimentRes.data.buzz) {
        result.sentiment = {
          buzz: sentimentRes.data.buzz.articlesInLastWeek,
          sentiment: sentimentRes.data.sentiment.bullishPercent
        };
      }
    }

    // 2. FMP: インサイダー取引
    if (fmpKey) {
      const insiderRes = await axios.get(`https://financialmodelingprep.com/api/v4/insider-trading?symbol=${ticker}&limit=5&apikey=${fmpKey}`);
      if (insiderRes.data && insiderRes.data.length > 0) {
        const transactions = insiderRes.data.map((t: any) => `${t.reportingName}(${t.typeOfTransaction}): ${t.securitiesTransacted} shares`).join(', ');
        result.insiderTransactions = transactions;
      }
    }

    // 3. Alternative.me: Fear & Greed Index
    const fgRes = await axios.get('https://api.alternative.me/fng/');
    if (fgRes.data && fgRes.data.data) {
      result.fearAndGreed = Number(fgRes.data.data[0].value);
    }

  } catch (error) {
    console.error(`[ERROR] Enhanced financials fetch failed for ${ticker}:`, error);
  }

  return result;
}
