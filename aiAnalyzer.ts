import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { TechnicalData, MarketContext } from './fetchTechnical';
import { TavilyResult } from './fetchTavily';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type ActionType = "BUY" | "DON'T BUY" | "SELL" | "HOLD";

export interface InvestmentDecision {
  judgment: ActionType;
  confidence: number;
  reason: string;
  strategy: {
    order_type: "MARKET" | "LIMIT";
    price: number | null;
    quantity: string;
    stop_loss: number | null;
    take_profit: number | null;
    risk_level: "LOW" | "MEDIUM" | "HIGH";
    allocation_percent: number;
  };
}

export async function analyzeInvestment(
  technical: TechnicalData,
  tavily: TavilyResult,
  totalCapital: number = 0,
  marketContext?: MarketContext,
  modelName: string = "gpt-4o-mini"
): Promise<InvestmentDecision> {
  
  const model = modelName;

  // 学習した教訓（ルールブック）を読み込む
  let lessons = "";
  const lessonsFile = path.join(process.cwd(), 'logs', 'lessons.txt');
  if (fs.existsSync(lessonsFile)) {
    lessons = fs.readFileSync(lessonsFile, 'utf-8');
  }

  const systemPrompt = `
あなたは世界トップクラスの短期投機家です。
「数日から最大1週間以内」の短期利益確定を狙うデイトレ・スイングの視点で判断を下してください。
${lessons ? `\n【過去の失敗と教訓（必ず守ること）】\n${lessons}\n` : ''}

【思考プロセス（リスク管理の強化）】
1. **ニュースの鮮度**: 直近24〜48時間以内の情報を最優先。古いニュースで株価が動いている場合は「材料出尽くし」を警戒せよ。
2. **損切り・利確の設定**: 感情を排除し、テクニカル的な節目（直近安値の少し下、抵抗線の少し下など）に基づいた具体的な数値を算出せよ。
3. **ボラティリティ調整**: 銘柄の振れ幅（ボラティリティ）が大きい場合は、配分(allocation_percent)を通常より下げ、リスクを一定に保て。

【出力項目 (JSON)】
- judgment: "BUY" | "SELL" | "HOLD" | "DON'T BUY"
- confidence: number (0.0-1.0)
- strategy: {
    "order_type": "MARKET" | "LIMIT",
    "price": number | null,
    "quantity": "推奨数量 (例: 10株)",
    "stop_loss": 損切価格 (数値またはnull),
    "take_profit": 利確価格 (数値またはnull),
    "risk_level": "LOW" | "MEDIUM" | "HIGH",
    "allocation_percent": number (0-100)
  }
- reason: "判断の理由 (テクニカル、ニュース、地合い、MTF分析、そしてなぜその損切・利確価格にしたかを説明)"
`.trim();

  const userPrompt = `
【分析対象】 ${tavily.name} (${technical.ticker})
【保有状況】 ${technical.isOwned ? '保有中' : '未保有'} (取得単価: ${technical.avgPrice || 'なし'})

【チャート・テクニカル指標】
${technical.summary}

【追加財務・センチメントデータ】
- 次回決算日: ${technical.financials?.earningsDate || '不明'}
- インサイダー取引: ${technical.financials?.insiderTransactions || 'なし'}
- ニュースセンチメント: ${technical.financials?.sentiment ? `${technical.financials.sentiment.sentiment}% Bullish (Buzz: ${technical.financials.sentiment.buzz})` : '不明'}
- 恐怖強欲指数 (Fear & Greed): ${technical.financials?.fearAndGreed || 'N/A'} (0-100)

【最新の市場・ニュース・ファンダメンタルズ情報】
${tavily.summary}

【市場全体の地合い (Market Context)】
${marketContext ? `
- 日経平均: ${marketContext.nikkei?.price || '不明'} (${marketContext.nikkei?.change || '不明'})
- S&P500: ${marketContext.sp500?.price || '不明'} (${marketContext.sp500?.change || '不明'})
- VIX(恐怖指数): ${marketContext.vix?.price || '不明'}
- 為替 (USD/JPY): ${marketContext.macro?.usdJpy || '不明'}
- 米10年債利回り: ${marketContext.macro?.us10Y || '不明'}%
- 今日の重要イベント: ${marketContext.macro?.economicEvents || 'なし'}
- 【大口監視】異常なオプション取引: ${technical.macro?.unusualOptions || 'データなし（または日本株）'}
- 【プロの予想】アナリスト目標価格: ${technical.financials?.analystTarget ? `${technical.financials.analystTarget.mean} (上昇余地: ${technical.financials.analystTarget.upside})` : '不明'}
- 【プロの推奨】買い: ${technical.financials?.analystRatings?.strongBuy + technical.financials?.analystRatings?.buy || 0}, 売り: ${technical.financials?.analystRatings?.strongSell + technical.financials?.analystRatings?.sell || 0}
- 【コミュニティ】Reddit: ${technical.financials?.socialSentiment?.reddit || 'データなし'}, Twitter: ${technical.financials?.socialSentiment?.twitter || 'データなし'}
`.trim() : 'なし'}

【資産状況】
総予算: ${totalCapital} JPY
`.trim();

  try {
    const response = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("AI応答エラー");

    return JSON.parse(content) as InvestmentDecision;
  } catch (error) {
    console.error("AI分析エラー:", error);
    // フォールバック
    return {
      judgment: "HOLD",
      confidence: 0,
      reason: "AIによる解析中にエラーが発生しました。もう一度お試しください。",
      strategy: { 
        order_type: "MARKET", 
        price: null, 
        quantity: "なし",
        stop_loss: null,
        take_profit: null,
        risk_level: "MEDIUM",
        allocation_percent: 0
      }
    };
  }
}

/**
 * 全銘柄の分析結果から「本日のおすすめ（BUYのみ）」を選定する
 */
export async function getBestRecommendation(results: { ticker: string, decision: any }[]) {
  // BUY判定の銘柄のみを抽出
  const buyResults = results.filter(r => r.decision.judgment === 'BUY');
  
  if (buyResults.length === 0) {
    return {
      best_ticker: "なし",
      reason: "本日、AIが「BUY（買い）」と判断した銘柄はありませんでした。無理なエントリーは控え、キャッシュポジションを維持することを推奨します。",
      summary: "地合いの改善、または個別銘柄の好材料待ちです。"
    };
  }

  const prompt = `
あなたは世界最高峰のヘッジファンドマネージャーです。
以下の「BUY（買い）」と判定された銘柄リストから、現在最も投資価値が高い（リスクリワードが良い）と思われる銘柄を1つだけ選んでください。

【BUY判定の銘柄リスト】
${JSON.stringify(buyResults, null, 2)}

回答は必ず以下のJSON形式のみで返してください：
{
  "best_ticker": "銘柄コード",
  "reason": "選定した詳細な理由（なぜ他のBUY銘柄より優れているか）",
  "summary": "推奨されるエントリー戦略の要約"
}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [{ role: "system", content: "あなたはプロの投資コンサルタントです。提供されたデータに基づき、常に一貫性のある論理的な判断を行ってください。" }, { role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const content = response.choices[0].message.content || '{}';
    return JSON.parse(content);
  } catch (error) {
    console.error("[ERROR] Failed to get best recommendation:", error);
    return {
      best_ticker: "エラー",
      reason: "分析の集計中にエラーが発生しました。個別の分析結果を確認してください。",
      summary: "システムエラー"
    };
  }
}

/**
 * 投資に関する一般的な質問に答える
 */
export async function askGeneralQuestion(question: string, marketContext: any, portfolio: any[]) {
  const prompt = `
あなたは世界最高峰の投資アドバイザーです。
以下の現在の市場環境と、ユーザーの保有状況を考慮して、ユーザーの質問に日本語で親身に答えてください。

【現在の市場環境】
- 日経平均: ${marketContext.nikkei?.price} (${marketContext.nikkei?.change})
- S&P500: ${marketContext.sp500?.price} (${marketContext.sp500?.change})
- 為替 (USD/JPY): ${marketContext.macro?.usdJpy}
- 米10年債利回り: ${marketContext.macro?.us10Y}%
- 直近のイベント: ${marketContext.macro?.economicEvents}

【ユーザーの保有状況】
${JSON.stringify(portfolio, null, 2)}

【ユーザーからの質問】
"${question}"

回答の指針：
- 具体的で論理的なアドバイスを行ってください。
- リスクとリターンの両面から説明してください。
- 週末の持ち越しリスクなど、時期的な要因も考慮してください。
- ユーモアを交えつつも、プロフェッショナルな口調で答えてください。
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.5",
      messages: [{ role: "system", content: "あなたは優秀な投資アドバイザーです。" }, { role: "user", content: prompt }]
    });

    return response.choices[0].message.content || "申し訳ありません、うまく回答を生成できませんでした。";
  } catch (error) {
    console.error("[ERROR] Failed to answer general question:", error);
    return "すみません、少し考え込んでしまいました（エラーが発生しました）。時間を置いてもう一度聞いてください。";
  }
}
