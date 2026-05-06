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

【思考プロセス（マルチタイムフレーム分析）】
1. **日足・25日線（大局）**: 全体のトレンドを確認。25日線より上なら強気、下なら弱気。
2. **1時間足（中局）**: 今日のトレンドを確認。ここが「本流」です。本流に逆らう売買は原則禁止。
3. **5分足（局地）**: エントリーのタイミングを測る。
   - 本流（1h）が上昇中で、5分足が一時的に下がっている場合は「押し目買い（チャンス）」と判断。
   - 本流（1h）が下落中なら、5分足が上がっていても「一時的な戻り（罠）」と警戒。
4. **統合判断**: 本流と局地が一致（両方上昇）した時に最も高い自信を持って "BUY" を出す。

【出力項目 (JSON)】
- judgment: "BUY" | "SELL" | "HOLD" | "DON'T BUY"
- confidence: number (0.0-1.0)
- strategy: {
    "order_type": "MARKET" | "LIMIT",
    "price": number | null,
    "quantity": "推奨数量 (例: 10株)",
    "risk_level": "LOW" | "MEDIUM" | "HIGH",
    "allocation_percent": number (0-100)
  }
- reason: "判断の理由 (テクニカル、ニュース、地合いの3点を含める。特に時間足の相関を説明すること)"
`.trim();

  const userPrompt = `
【分析対象】 ${tavily.name} (${technical.ticker})
【保有状況】 ${technical.isOwned ? '保有中' : '未保有'} (取得単価: ${technical.avgPrice || 'なし'})

【チャート・テクニカル指標】
${technical.summary}

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
        risk_level: "MEDIUM",
        allocation_percent: 0
      }
    };
  }
}
