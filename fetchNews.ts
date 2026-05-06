import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export async function fetchRecentNews(keyword: string): Promise<string> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    return "NewsAPIのキーが設定されていません。";
  }

  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(keyword)}&sortBy=publishedAt&language=jp&apiKey=${apiKey}`;

  try {
    const response = await axios.get(url);
    const articles = response.data.articles.slice(0, 5);
    
    if (articles.length === 0) {
      return "関連するニュースは見つかりませんでした。";
    }

    const newsText = articles.map((article: any, index: number) => {
      return `[記事${index + 1}] タイトル: ${article.title}\n概要: ${article.description}`;
    }).join('\n\n');
    
    return newsText;
  } catch (error) {
    console.error("ニュース取得エラー:", error);
    return "ニュースデータを取得できませんでした。";
  }
}
