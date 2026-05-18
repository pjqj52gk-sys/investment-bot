import { openai } from './openAiConfig';
import fs from 'fs';
import path from 'path';

export interface InvestmentDecision {
  judgment: 'BUY' | 'SELL' | 'HOLD';
  reason: string;
  target_price: number;
  stop_loss: number;
  confidence: number;
  risk_reward_ratio: string;
}

const lessonsFile = path.join(process.cwd(), 'logs', 'lessons.txt');

/**
 * 銘柄の投資判断を行う
 */
export async function analyzeInvestment(technical: any, tavily: any, totalCapital: number, marketContext: any, modelName: string = "gpt-4o"): Promise<any> {
  // 学習済みのルールブックを読み込む
  const learnedLessons = fs.existsSync(lessonsFile) ? fs.readFileSync(lessonsFile, 'utf-8') : "まだ蓄積された教訓はありません。";

  const systemPrompt = `
あなたは世界トップクラスの投資アドバイザーおよびヘッジファンドマネージャーです。
テクニカル、ファンダメンタル、最新ニュース、SNSのセンチメント、およびマクロ環境を統合して、プロフェッショナルな投資判断を下してください。

【判断の指針】
1. **機会損失を避ける**: 常にリスクは考慮すべきですが、過度に慎重になりすぎて「買い」のチャンスを逃さないでください。
2. **テクニカルの活用**: 下落トレンドでも「底打ちの兆し」や「オーバーシュート（売られすぎ）」が見られる場合は、逆張りや打診買いの検討を含めてください。
3. **リスク・リワード**: 損切りラインを明確にし、期待リターンがリスクを上回る場合は積極的に「BUY」を検討してください。
4. **過去の教訓**: 以下の「蓄積されたルール」を最優先で遵守してください。

【蓄積されたルール（自己学習結果）】
${learnedLessons}

出力は必ずJSON形式で、以下のキーを含めてください:
{ 
  "judgment": "BUY/SELL/HOLD", 
  "reason": "詳細な理由（なぜ今なのか、何がトリガーか）", 
  "target_price": 目標株価, 
  "stop_loss": 損切り株価, 
  "confidence": 0-100の確信度,
  "strategy": {
    "order_type": "LIMIT/MARKET",
    "price": 指値価格またはnull,
    "quantity": 推奨購入数量,
    "risk_level": "LOW/MEDIUM/HIGH",
    "allocation_percent": 資金配分率(%),
    "take_profit": 利確目安
  }
}
`;

  const userPrompt = `
【銘柄】 ${tavily.name} (${tavily.ticker})
【市場環境】 地合い: ${marketContext?.sentiment || '不明'}, VIX: ${marketContext?.vix || '不明'}, ドル円: ${marketContext?.macro?.usdJpy || '不明'}
【テクニカル状況】
${technical.summary}

【ニュース・外部情報サマリー】
${tavily.summary}

【アナリスト・SNSセンチメント】
${JSON.stringify(technical.financials?.socialSentiment || {})}
アナリスト評価: ${JSON.stringify(technical.financials?.analystRatings || "なし")}

【資産状況】
運用可能総資産: ${totalCapital} 円
`;

  try {
    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7 // 少し柔軟な発想を許可
    });

    return JSON.parse(response.choices[0].message.content || "{}");
  } catch (error) {
    console.error("Analysis error:", error);
    return null;
  }
}

/**
 * 投資に関する一般的な質問に答える
 */
export async function askGeneralQuestion(question: string, marketContext: any, portfolio: any[]): Promise<string> {
  const portfolioStr = portfolio && Array.isArray(portfolio) ? portfolio.map(p => `- ${p.name} (${p.ticker})`).join('\n') : "なし";
  const marketStr = marketContext ? `地合い: ${marketContext.sentiment || '不明'}, VIX: ${marketContext.vix || '不明'}` : "不明";

  const prompt = `
あなたは世界トップクラスの投資アドバイザーです。
以下の情報を踏まえて、ユーザーの質問に答えてください。

【市場環境】
${marketStr}

【現在の保有銘柄】
${portfolioStr}

【ユーザーからの質問】
"${question}"

回答の指針：
- 専門的かつ論理的に、しかし親しみやすい口調でアドバイスしてください。
- リスクとリターンのバランスを常に意識させてください。
`;

  try {
    let response;
    try {
      response = await openai.chat.completions.create({
        model: "gpt-5.5",
        messages: [{ role: "user", content: prompt }]
      });
    } catch (e) {
      console.warn("GPT-5.5 chat failed, falling back to GPT-4o");
      response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }]
      });
    }

    return response.choices[0].message.content || "回答を生成できませんでした。";
  } catch (error) {
    console.error("Chat error:", error);
    return "すみません、少し考え込んでしまいました。時間を置いてもう一度聞いてください。";
  }
}

export async function getBestRecommendation(analyses: any[]): Promise<any> {
  // BUY判定かつ確信度が高いものを優先
  const buys = analyses.filter(a => a.decision.judgment === 'BUY');
  if (buys.length > 0) {
    return buys.sort((a, b) => (b.decision.confidence || 0) - (a.decision.confidence || 0))[0].decision;
  }
  return analyses.sort((a, b) => (b.decision.confidence || 0) - (a.decision.confidence || 0))[0].decision;
}
