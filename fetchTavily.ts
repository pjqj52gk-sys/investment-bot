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
      }
    );

    const data = response.data;
    
    // ニュース結果を整形
    const summary = data.results.map((r: any) => `- ${r.title}\n  ${r.content.substring(0, 200)}...`).join('\n\n');

    return {
      ticker,
      name,
      answer: data.answer || "回答が得られませんでした。",
      results: data.results,
      summary: `【AI検索回答】\n${data.answer || "なし"}\n\n【最新ニュースソース】\n${summary}`
    };
  } catch (error) {
    console.error("Tavily APIエラー:", error);
    return "ニュース情報の取得に失敗しました。";
  }
}
