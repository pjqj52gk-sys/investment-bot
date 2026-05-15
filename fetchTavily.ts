import axios from 'axios';
import dotenv from 'dotenv';

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

  const query = `${name} (${ticker}) stock market news analysis and latest financial reports`;

  try {
    const response = await axios.post(
      'https://api.tavily.com/search',
      {
        api_key: apiKey,
        query: query,
        search_depth: deepSearch ? "advanced" : "basic",
        include_answer: true,
        max_results: deepSearch ? 10 : 5,
        days: 3 // 直近3日間のニュースに絞る
      },
      { timeout: 10000 }
    );

    const data = response.data;
    const summary = data.results.map((r: any) => `- ${r.title}\n  ${r.content.substring(0, 200)}...`).join('\n\n');

    return {
      ticker,
      name,
      answer: data.answer || "回答が得られませんでした。",
      results: data.results,
      summary: `【Tavily検索回答】\n${data.answer || "なし"}\n\n【最新ニュースソース】\n${summary}`
    };
  } catch (error) {
    console.warn("Tavily APIエラーのため、Finnhub Newsフォールバックを実行します。");
    
    // Finnhub News フォールバック
    const finnhubKey = process.env.FINNHUB_API_KEY;
    if (finnhubKey) {
      try {
        const toDate = new Date().toISOString().split('T')[0];
        const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // 過去7日間
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
        }
      } catch (fhErr) {
        console.error("Finnhub Newsフォールバックも失敗しました:", fhErr);
      }
    }

    return "ニュース情報の取得に失敗しました。";
  }
}
