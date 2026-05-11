import { openai } from './openAiConfig';

export interface InvestmentDecision {
  judgment: 'BUY' | 'SELL' | 'HOLD';
  reason: string;
  target_price: number;
  stop_loss: number;
  confidence: number;
}

/**
 * 銘柄の投資判断を行う
 */
export async function analyzeInvestment(technical: any, tavily: any, totalCapital: number, marketContext: any, modelName: string = "gpt-4o"): Promise<any> {
  const systemPrompt = `
あなたは世界トップクラスの投資アドバイザーです。
テクニカル、ファンダメンタル、ニュース、SNSのセンチメントを統合して判断を下してください。
出力は必ずJSON形式で、以下のキーを含めてください:
{ "judgment": "BUY/SELL/HOLD", "reason": "理由", "target_price": 数値, "stop_loss": 数値, "confidence": 0-100 }
`;

  const userPrompt = `
【銘柄】 ${tavily.name} (${tavily.ticker})
【市場環境】 地合い: ${marketContext?.sentiment || '不明'}, VIX: ${marketContext?.vix || '不明'}
【テクニカル】 ${technical.summary}
【ニュース・センチメント】 ${tavily.summary}
【アナリスト・SNS】 ${JSON.stringify(technical.financials?.socialSentiment || {})}
`;

  try {
    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: "user", content: systemPrompt + "\n\n" + userPrompt }
      ],
      response_format: { type: "json_object" }
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
  // 安全な文字列化
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
      // 第一候補: gpt-5.5
      response = await openai.chat.completions.create({
        model: "gpt-5.5",
        messages: [{ role: "user", content: prompt }]
      });
    } catch (e) {
      console.warn("GPT-5.5 chat failed, falling back to GPT-4o");
      // 第二候補: gpt-4o
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
  // 簡易的な推薦ロジック
  return analyses.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
}
