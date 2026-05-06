import OpenAI from 'openai';
import dotenv from 'dotenv';
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
  };
}

export async function analyzeInvestment(
  tavily: TavilyResult,
  isOwned: boolean = false,
  avgPrice: number | null = null
): Promise<InvestmentDecision> {
  
  const model = "o1";

  const systemPrompt = `
あなたは世界トップクラスの短期投機家です。
「数日から最大1週間以内」の短期利益確定を狙うデイトレ・スイングの視点で判断を下してください。

【出力形式】
JSON形式で出力してください。

【スキーマ】
{
  "judgment": "BUY | DON'T BUY | SELL | HOLD",
  "confidence": 0.0-1.0,
  "reason": "根拠を日本語で",
  "strategy": {
    "order_type": "MARKET | LIMIT",
    "price": 数値またはnull,
    "quantity": "推奨数量"
  }
}
`.trim();

  const userPrompt = `
【分析対象】 ${tavily.name} (${tavily.ticker})
【保有状況】 ${isOwned ? '保有中' : '未保有'} (取得単価: ${avgPrice || 'なし'})
【最新の市場・ニュース・ファンダメンタルズ情報】
${tavily.summary}
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
      reason: "分析エラーが発生しました。",
      strategy: { order_type: "MARKET", price: null, quantity: "なし" }
    };
  }
}
