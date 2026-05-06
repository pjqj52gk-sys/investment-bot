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
const memosFile = path.join(logsDir, 'memos.json');
const lessonsFile = path.join(logsDir, 'lessons.txt');

export interface MemoEntry {
  timestamp: string;
  ticker: string;
  evaluation: string;
  lesson: string;
  priceChange: string;
}

export async function runReflection(ticker: string): Promise<{ evaluation: string, lesson: string, priceChange: string } | string> {
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
      model: "gpt-4o",
      messages: [
        { role: "system", content: "あなたは世界トップクラスの投資家です。過去の予測を厳しく評価し、教訓を抽出してください。" },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    if (!content) return "AIからの応答がありませんでした。";

    const result = JSON.parse(content);

    // デイリーメモとして保存（直接ルールブックは更新しない）
    let memos: MemoEntry[] = [];
    if (fs.existsSync(memosFile)) {
      memos = JSON.parse(fs.readFileSync(memosFile, 'utf-8'));
    }
    
    const newMemo: MemoEntry = {
      timestamp: new Date().toISOString(),
      ticker,
      evaluation: result.evaluation,
      lesson: result.lesson || "特になし",
      priceChange: `${priceChange > 0 ? '+' : ''}${percentChange}%`
    };
    memos.push(newMemo);
    fs.writeFileSync(memosFile, JSON.stringify(memos, null, 2), 'utf-8');

    return {
      evaluation: result.evaluation,
      lesson: result.lesson || "特になし",
      priceChange: `${priceChange > 0 ? '+' : ''}${percentChange}%`
    };

  } catch (error) {
    console.error("反省会エラー:", error);
    return "反省会の実行中にエラーが発生しました。";
  }
}

/**
 * 溜まったメモを統計的に分析し、公式ルールブック(lessons.txt)をアップデートする
 */
export async function consolidateRulebook(): Promise<string> {
  if (!fs.existsSync(memosFile)) return "分析するメモがありません。";

  const memos: MemoEntry[] = JSON.parse(fs.readFileSync(memosFile, 'utf-8'));
  if (memos.length === 0) return "分析するメモがありません。";

  const currentLessons = fs.existsSync(lessonsFile) ? fs.readFileSync(lessonsFile, 'utf-8') : "まだルールはありません。";

  const prompt = `
あなたは凄腕のトレーダー兼データサイエンティストです。
この1週間の「AIの予測と結果のメモ」を分析し、現在の「公式ルールブック(lessons.txt)」をアップデートしてください。

【現在の公式ルールブック】
${currentLessons}

【今週の反省メモ一覧】
${JSON.stringify(memos, null, 2)}

【指示】
1. メモから読み取れる「統計的な失敗パターン」や「成功パターン」を抽出してください。
2. 既存のルールが有効であれば残し、矛盾がある場合は最新のデータを優先して修正してください。
3. 今後のトレードの勝率を上げるための「具体的かつ簡潔な教訓リスト（5〜10個程度）」として出力してください。
4. 出力は「箇条書きのテキストのみ」にしてください。
`.trim();

  try {
    const response = await openai.chat.completions.create({
      model: "o1",
      messages: [{ role: "user", content: prompt }]
    });

    const newLessons = response.choices[0].message.content;
    if (!newLessons) return "AIからの応答が空でした。";

    // ルールブックを更新
    fs.writeFileSync(lessonsFile, newLessons.trim(), 'utf-8');

    // 読み終わったメモをアーカイブまたは削除（今回は簡単のためクリア）
    fs.writeFileSync(memosFile, "[]", 'utf-8');

    return `📊 週次統計分析が完了しました！\n\n【更新された新ルールブック】\n${newLessons}`;

  } catch (error) {
    console.error("ルールブック統合エラー:", error);
    return "ルールブックの統合中にエラーが発生しました。";
  }
}
