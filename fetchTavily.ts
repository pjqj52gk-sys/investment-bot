import axios from 'axios';
import dotenv from 'dotenv';
import { fetchRecentNews } from './fetchNews';

dotenv.config();

export interface TavilyResult {
  ticker: string;
  name: string;
  answer: string;
  results: any[];
  summary: string;
}

export async function fetchTavilyData(ticker: string, name: string, deepSearch: boolean = false): Promise<TavilyResult | string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.error("TAVILY_API_KEYが設定されていません。");
    return "TAVILY_API_KEYが設定されていません。";
  }

  // クエリをより詳細にする。ETFなどの場合はキーワードを追加
  const isEtf = ticker.includes('QQQ') || ticker.includes('SOXL') || ticker.includes('VIX');
  const query = `${name} (${ticker}) ${isEtf ? 'ETF' : ''} stock market news analysis, latest financial reports, and expert sentiment`;

  console.log(`[Tavily] Searching for: ${query} (depth: ${deepSearch ? 'advanced' : 'basic'})`);

  try {
    const response = await axios.post(
      'https://api.tavily.com/search',
      {
        api_key: apiKey,
        query: query,
        search_depth: deepSearch ? "advanced" : "basic",
        include_answer: true,
        max_results: deepSearch ? 10 : 5,
      },
      { timeout: 15000 }
    );

    const data = response.data;
    
    if (!data.results || data.results.length === 0) {
      console.warn(`[Tavily] No results found for ${ticker}.`);
      throw new Error("No results found");
    }

    const summary = data.results.map((r: any) => `- ${r.title}\n  ${r.content.substring(0, 200)}...`).join('\n\n');

    return {
      ticker,
      name,
      answer: data.answer || "回答が得られませんでした。",
      results: data.results,
      summary: `【Tavily検索回答】\n${data.answer || "なし"}\n\n【最新ニュースソース】\n${summary}`
    };
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || error.response?.data?.detail || error.message;
    console.error(`[Tavily] API Error for ${ticker}:`, errorMsg);
    
    console.warn("Tavily APIエラーのため、Finnhub Newsフォールバックを実行します。");
    
    // Finnhub News フォールバック
    const finnhubKey = process.env.FINNHUB_API_KEY;
    if (finnhubKey) {
      try {
        const toDate = new Date().toISOString().split('T')[0];
        const fromDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const fhRes = await axios.get(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${fromDate}&to=${toDate}&token=${finnhubKey}`);
        
        if (fhRes.data && Array.isArray(fhRes.data) && fhRes.data.length > 0) {
          const summary = fhRes.data.slice(0, 5).map((n: any) => `- ${n.headline}\n  ${n.summary.substring(0, 200)}...`).join('\n\n');
          return {
            ticker,
            name,
            answer: "Finnhubから直接ニュースを取得しました。",
            results: fhRes.data,
            summary: `【Finnhub提供ニュース】\n${summary}`
          };
        } else {
          console.warn(`[Finnhub] No news found for ${ticker} in the last 14 days.`);
        }
      } catch (fhErr: any) {
        console.error("Finnhub Newsフォールバックも失敗しました:", fhErr.message);
      }
    }

    // NewsAPI (fetchNews.ts) フォールバック
    console.warn("NewsAPIフォールバックを実行します...");
    try {
      const newsApiResult = await fetchRecentNews(name, ticker);
      if (newsApiResult && !newsApiResult.includes("取得できませんでした") && !newsApiResult.includes("見つかりませんでした")) {
        return {
          ticker,
          name,
          answer: "NewsAPIからニュースを取得しました。",
          results: [],
          summary: `【NewsAPI提供ニュース】\n${newsApiResult}`
        };
      }
    } catch (naErr: any) {
      console.error("NewsAPIフォールバックも失敗しました:", naErr.message);
    }

    return "ニュース情報の取得に失敗しました。";
  }
}
