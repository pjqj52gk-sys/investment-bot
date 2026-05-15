import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * NewsAPIを使用してニュースを取得する
 * @param keyword 検索キーワード
 * @param ticker 銘柄コード（オプション）
 * @returns ニューステキスト
 */
export async function fetchRecentNews(keyword: string, ticker?: string): Promise<string> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    return "NewsAPIのキーが設定されていません。";
  }

  // 試行するクエリのリスト
  const searchQueries = [
    ticker ? `${keyword} ${ticker}` : keyword,
    keyword,
    ticker ? ticker.replace('.T', '') : null
  ].filter(Boolean) as string[];

  try {
    for (const query of searchQueries) {
      console.log(`[NewsAPI] Searching for: ${query}`);
      
      // 1. グローバル検索
      const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=5&apiKey=${apiKey}`;
      const response = await axios.get(url);
      let articles = response.data.articles || [];

      // 2. 日本語検索 (グローバルでヒットしない場合)
      if (articles.length === 0) {
        const jaUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&language=ja&pageSize=5&apiKey=${apiKey}`;
        const jaRes = await axios.get(jaUrl).catch(() => ({ data: { articles: [] } }));
        articles = jaRes.data.articles || [];
      }

      if (articles.length > 0) {
        return articles.map((article: any, index: number) => {
          const date = new Date(article.publishedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
          return `[記事${index + 1}] ${date}\nタイトル: ${article.title}\n概要: ${article.description || '概要なし'}\nURL: ${article.url}`;
        }).join('\n\n');
      }
    }

    return "関連するニュースは見つかりませんでした。";
  } catch (error: any) {
    const errorMsg = error.response?.data?.message || error.message;
    console.error("ニュース取得エラー (NewsAPI):", errorMsg);
    return `ニュースデータを取得できませんでした。(${errorMsg})`;
  }
}
