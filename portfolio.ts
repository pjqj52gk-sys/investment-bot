import fs from 'fs';
import path from 'path';

const PORTFOLIO_FILE = path.join(process.cwd(), 'logs', 'portfolio.json');

export interface Position {
  ticker: string;
  name: string;
  buyPrice: number;
  buyDate: string;
  takeProfit: number | null;
  stopLoss: number | null;
  quantity: string;
}

/**
 * ポートフォリオの読み込み
 */
export function loadPortfolio(): Position[] {
  try {
    if (fs.existsSync(PORTFOLIO_FILE)) {
      const data = fs.readFileSync(PORTFOLIO_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("[ERROR] Failed to load portfolio:", error);
  }
  return [];
}

/**
 * ポートフォリオの保存
 */
export function savePortfolio(portfolio: Position[]) {
  try {
    const dir = path.dirname(PORTFOLIO_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(portfolio, null, 2), 'utf-8');
  } catch (error) {
    console.error("[ERROR] Failed to save portfolio:", error);
  }
}

/**
 * 新規ポジションの追加
 */
export function addPosition(pos: Position) {
  const portfolio = loadPortfolio();
  // 重複チェック（簡易版）
  if (!portfolio.some(p => p.ticker === pos.ticker)) {
    portfolio.push(pos);
    savePortfolio(portfolio);
  }
}

/**
 * ポジションの決済（削除）
 */
export function closePosition(ticker: string) {
  let portfolio = loadPortfolio();
  portfolio = portfolio.filter(p => p.ticker !== ticker);
  savePortfolio(portfolio);
}

/**
 * ポートフォリオのサマリー取得
 */
export function getPortfolioSummary() {
  const portfolio = loadPortfolio();
  if (portfolio.length === 0) return "現在保有中の仮想ポジションはありません。";
  
  return portfolio.map(p => 
    `- **${p.name} (${p.ticker})**: 購入 $${p.buyPrice} (TP: ${p.takeProfit || 'なし'}, SL: ${p.stopLoss || 'なし'})`
  ).join('\n');
}
