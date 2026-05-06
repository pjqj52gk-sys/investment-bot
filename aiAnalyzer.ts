import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { TechnicalData } from './fetchTechnical';
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
  technical: TechnicalData,
  tavily: TavilyResult
): Promise<InvestmentDecision> {
  
  const model = "o1";

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

【出力項目 (JSON)】
- judgment: "BUY", "SELL", "HOLD", "DON'T BUY" のいずれか
- confidence: 0.0-1.0
- strategy: 注文方法や目標価格などの戦略（order_type: "MARKET" or "LIMIT", price: number, quantity: string）
- reason: 判断の理由。**必ず以下の2点を含めて論理的に説明してください**：
    1. テクニカル指標（MACD、移動平均線、トレンド）から読み取れる売買サイン。
    2. Tavilyで取得した最新ニュースや業績予想（ファンダメンタルズ）から読み取れるポジティブ・ネガティブ要素。
    ※チャートだけ、あるいはニュースだけに偏らず、両方を統合したプロの視点で書いてください。

【思考プロセス】
1. テクニカル分析で「エントリー/エグジットのタイミング」を測る。
2. ニュース分析で「その銘柄を今持つべき根拠（ファンダメンタルズの裏付け）」を確認する。
3. 両者が合致する場合にのみ強い判断を下す。矛盾する場合は慎重な判断(HOLD/DON'T BUY)を下す。
`.trim();

  const userPrompt = `
【分析対象】 ${tavily.name} (${technical.ticker})
【保有状況】 ${technical.isOwned ? '保有中' : '未保有'} (取得単価: ${technical.avgPrice || 'なし'})

【チャート・テクニカル指標】
${technical.summary}

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
