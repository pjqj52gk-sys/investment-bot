import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { PredictionLog } from './logger';
import { fetchTechnicalData } from './fetchTechnical';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const logsDir = path.join(process.cwd(), 'logs');
const predictionsFile = path.join(logsDir, 'predictions.json');
const lessonsFile = path.join(logsDir, 'lessons.txt');

export async function runReflection(ticker: string): Promise<string | null> {
  if (!fs.existsSync(predictionsFile)) {
    return "予測ログがまだありません。";
  }

  const logsData = fs.readFileSync(predictionsFile, 'utf-8');
  let logs: PredictionLog[] = JSON.parse(logsData);

  // 指定された銘柄の最新の予測（ただし24時間以上前のもの）を探す
  const pastLogs = logs.filter(l => l.ticker.includes(ticker));
  if (pastLogs.length === 0) return "この銘柄の過去の予測ログがありません。";

  // 一番新しい過去のログを取得（簡略化のため直近のもの）
  const targetLog = pastLogs[pastLogs.length - 1];

  // 現在の株価を取得して答え合わせ
  const technical = await fetchTechnicalData(ticker);
  if (typeof technical === 'string') return "現在の株価の取得に失敗しました。";

  const currentPrice = technical.currentPrice;
  const oldPrice = targetLog.currentPrice;
  const priceChange = currentPrice - oldPrice;
  const percentChange = ((priceChange / oldPrice) * 100).toFixed(2);

  const prompt = `
あなたは世界トップクラスの投資家です。過去の自分の予測を振り返り、学習してください。

【過去の予測データ】
銘柄: ${ticker}
予測日時: ${targetLog.timestamp}
当時の株価: ${oldPrice}
当時の予測: ${targetLog.judgment}
当時の理由: ${targetLog.reason}

【現在の状況】
現在の株価: ${currentPrice}
変動: ${priceChange > 0 ? '+' : ''}${percentChange}%

【指示】
1. 当時の予測（BUY/SELL/HOLDなど）が現在の結果から見て正しかったか、間違っていたかを厳しく評価してください。
2. 間違っていた場合、または改善の余地がある場合、次回から同じミスを防ぐための「1〜2行の具体的なルール（教訓）」を作成してください。
3. 出力は以下のJSON形式で行ってください。

{
  "evaluation": "正しかった・間違っていたなどの評価コメント",
  "lesson": "新しい教訓やルール（学ぶことがない場合はnull）"
}
  `.trim();

  try {
    const response = await openai.chat.completions.create({
      model: "o1",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    if (!content) return "AIからの応答がありませんでした。";

    const result = JSON.parse(content);

    // 新しい教訓があれば lessons.txt に書き込む
    if (result.lesson) {
      const lessonText = `[${ticker}] ${result.lesson}\n`;
      fs.appendFileSync(lessonsFile, lessonText, 'utf-8');
    }

    return `【反省会結果: ${ticker}】\n当時の株価: ${oldPrice} -> 現在: ${currentPrice} (${percentChange}%)\n\n評価: ${result.evaluation}\n${result.lesson ? `\n🧠 新しい教訓を学習しました:\n${result.lesson}` : ''}`;

  } catch (error) {
    console.error("反省会エラー:", error);
    return "反省会の実行中にエラーが発生しました。";
  }
}
