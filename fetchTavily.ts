import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export interface TavilyResult {
  ticker: string;
  name: string;
  summary: string;
  currentPrice?: number;
  changePercent?: number;
}

export async function fetchTavilyData(ticker: string, name: string): Promise<TavilyResult | string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.error("TAVILY_API_KEYが設定されていません。");
    return "APIキー設定エラー";
  }

  const query = `Provide the latest financial news, stock price, fundamentals, industry trends, competitors, and market sentiment for ${name} (${ticker} stock). Summarize the current situation for short-term trading.`;

  try {
    const response = await axios.post(
      'https://api.tavily.com/search',
      {
        query: query,
        search_depth: "advanced",
        include_answer: true,
        days: 3 // 直近3日間のニュースに絞る
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        }
      }
    );

    const answer = response.data.answer;
    
    // Tavilyはテキスト（answer）を返してくるので、それをそのままAIのプロンプトに渡す
    return {
      ticker,
      name,
      summary: answer || "詳細な情報を取得できませんでした。"
    };
  } catch (error) {
    console.error(`[ERROR] Tavily fetch failed for ${ticker}:`, error);
    return "データ取得エラー";
  }
}
