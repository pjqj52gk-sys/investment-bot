import fs from 'fs';
import path from 'path';
import { InvestmentDecision } from './aiAnalyzer';

// ログファイルのパス設定
const logsDir = path.join(process.cwd(), 'logs');
const predictionsFile = path.join(logsDir, 'predictions.json');

// 予測結果を保存するインターフェース
export interface PredictionLog {
  timestamp: string;
  ticker: string;
  currentPrice: number;
  judgment: string;
  reason: string;
  strategy: {
    order_type: string;
    price: number | null;
    quantity: string;
  };
}

export function savePrediction(ticker: string, currentPrice: number, analysis: InvestmentDecision) {
  try {
    // フォルダが存在しない場合は作成
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    let logs: PredictionLog[] = [];

    // 既存のログファイルがあれば読み込む
    if (fs.existsSync(predictionsFile)) {
      const data = fs.readFileSync(predictionsFile, 'utf-8');
      if (data) {
        logs = JSON.parse(data);
      }
    }

    // 新しいログデータを作成
    const newLog: PredictionLog = {
      timestamp: new Date().toISOString(),
      ticker,
      currentPrice,
      judgment: analysis.judgment,
      reason: analysis.reason,
      strategy: analysis.strategy
    };

    // ログを追加
    logs.push(newLog);

    // ファイルに書き込む（見やすくインデントをつける）
    fs.writeFileSync(predictionsFile, JSON.stringify(logs, null, 2), 'utf-8');
    console.log(`[LOG] Saved prediction for ${ticker}`);

  } catch (error) {
    console.error("[ERROR] Failed to save prediction log:", error);
  }
}
