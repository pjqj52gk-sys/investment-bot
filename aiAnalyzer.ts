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
  marketContext?: MarketContext
): Promise<InvestmentDecision> {
  
  const model = "gpt-4o";

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
${marketContext ? `日経平均: ${marketContext.nikkei.price} (${marketContext.nikkei.change}), S&P500: ${marketContext.sp500.price} (${marketContext.sp500.change}), VIX(恐怖指数): ${marketContext.vix.price}` : 'なし'}

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
