import { Client, GatewayIntentBits, TextChannel, EmbedBuilder } from 'discord.js';
import { fetchTavilyData } from './fetchTavily';
import { fetchTechnicalData } from './fetchTechnical';
import { analyzeInvestment } from './aiAnalyzer';
import cron from 'node-cron';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// 監視銘柄リスト
// isOwned: true にすると保有中として分析します
// avgPrice: 取得単価を設定すると損益計算を行います
const JP_WATCH_LIST = [
  { ticker: "1802", name: "大林組" },
  { ticker: "1671", name: "WTI原油ETF" },
  { ticker: "1605", name: "INPEX" },
  { ticker: "7011", name: "三菱重工業" },
  { ticker: "7013", name: "IHI" },
  { ticker: "6762", name: "TDK" },
  { ticker: "9984", name: "ソフトバンクグループ" },
  { ticker: "6954", name: "ファナック", isOwned: true, avgPrice: 6858.00 },
  { ticker: "6324", name: "ハーモニック・ドライブ" },
  { ticker: "278A", name: "TERRADA" },
];

const US_WATCH_LIST = [
  { ticker: "BE", name: "Bloom Energy" },
  { ticker: "SMR", name: "NuScale Power" },
  { ticker: "BLDP", name: "Ballard Power", isOwned: true, avgPrice: 4.5215 },
  { ticker: "TQQQ", name: "ProShares QQQ 3x" },
  { ticker: "SOXL", name: "Semi Bull 3x" },
  { ticker: "SOXS", name: "Semi Bear 3x" },
  { ticker: "TSM", name: "TSMC" },
  { ticker: "ARM", name: "ARM Holdings" },
  { ticker: "NVDA", name: "NVIDIA" },
  { ticker: "MU", name: "Micron" },
  { ticker: "RGTI", name: "Rigetti Computing" },
  { ticker: "VRT", name: "Vertiv" },
  { ticker: "TSLA", name: "Tesla" },
  { ticker: "MSFT", name: "Microsoft" },
  { ticker: "RDDT", name: "Reddit" },
];

async function getAnalysisEmbed(ticker: string, name: string, manualOwned: boolean = false, manualAvgPrice: number | null = null) {
  // テクニカルデータ取得
  const technical = await fetchTechnicalData(ticker);
  if (typeof technical === 'string') return null;

  // 手動設定がある場合は上書き
  if (manualOwned) {
    technical.isOwned = true;
    if (manualAvgPrice) technical.avgPrice = manualAvgPrice;
    
    // サマリー内の保有情報を再計算して更新
    const pnl = technical.currentPrice - (technical.avgPrice || 0);
    const pnlPercent = ((pnl / (technical.avgPrice || 1)) * 100).toFixed(2);
    const pnlInfo = `【保有状況】 取得単価: ${technical.avgPrice}, 損益: ${pnl.toFixed(2)} (${pnlPercent}%)`;
    
    // summaryを再構築（既存のsummaryから保有状況の行を差し替える）
    const lines = technical.summary.split('\n');
    const newLines = lines.map(line => line.includes('【保有状況】') ? pnlInfo : line);
    if (!lines.some(l => l.includes('【保有状況】'))) {
      newLines.splice(2, 0, pnlInfo);
    }
    technical.summary = newLines.join('\n');
  }

  // Tavilyから市場情報・ニュースを一括取得
  const tavilyData = await fetchTavilyData(ticker, name);
  if (typeof tavilyData === 'string') return null;

  // AI分析
  const analysis = await analyzeInvestment(technical, tavilyData);

  const strategyStr = analysis.judgment !== 'HOLD' && analysis.judgment !== 'DON\'T BUY' 
    ? `注文方法: ${analysis.strategy.order_type === 'LIMIT' ? '指値 (Limit)' : '成行 (Market)'}\n目標価格: ${analysis.strategy.price ? '$' + analysis.strategy.price : 'なし'}\n推奨数量: ${analysis.strategy.quantity}`
    : '様子見';

  const embed = new EmbedBuilder()
    .setTitle(`${name} (${ticker}) 分析結果`)
    .setColor(analysis.judgment === 'BUY' ? 0x00ff00 : analysis.judgment === 'SELL' ? 0xff0000 : 0xffff00)
    .addFields(
      { name: '判定', value: `**${analysis.judgment}**`, inline: true },
      { name: '戦略・注文方法', value: `\`\`\`\n${strategyStr}\n\`\`\``, inline: true },
      { name: '理由', value: analysis.reason },
      { name: 'テクニカル状況', value: `\`\`\`\n${technical.summary}\n\`\`\`` },
      { name: '取得情報サマリー', value: `\`\`\`\n${tavilyData.summary.substring(0, 1000)}...\n\`\`\`` }
    )
    .setTimestamp();

  return embed;
}

async function sendToChannel(channelId: string, embed: EmbedBuilder) {
  try {
    const channel = await client.channels.fetch(channelId) as TextChannel;
    if (channel) await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error(`[ERROR] Unknown Channel ${channelId}`);
  }
}

async function runBatchAnalysis() {
  const channelId = process.env.DISCORD_CHANNEL_ID || "";
  
  console.log("=== 日本株(定期) 一括分析開始 ===");
  for (const stock of JP_WATCH_LIST) {
    const embed = await getAnalysisEmbed(stock.ticker, stock.name, stock.isOwned, stock.avgPrice);
    if (embed) await sendToChannel(channelId, embed);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  console.log("=== 米国株(定期) 一括分析開始 ===");
  for (const stock of US_WATCH_LIST) {
    const embed = await getAnalysisEmbed(stock.ticker, stock.name);
    if (embed) await sendToChannel(channelId, embed);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user?.tag}!`);
  
  // 起動時に1回実行
  // runBatchAnalysis();

  // 定期実行スケジュール
  // 日本株: 平日 15:10
  cron.schedule('10 15 * * 1-5', () => {
    runBatchAnalysis();
  });
  
  // 米国株: 平日 06:00
  cron.schedule('0 6 * * 2-6', () => {
    runBatchAnalysis();
  });
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim().toUpperCase();
  
  // 銘柄名またはコードでの個別分析（大文字小文字を区別しない）
  const jpStock = JP_WATCH_LIST.find(s => s.ticker === content || s.name.toUpperCase() === content);
  const usStock = US_WATCH_LIST.find(s => s.ticker === content || s.name.toUpperCase() === content);
  const target = jpStock || usStock;

  if (target) {
    const embed = await getAnalysisEmbed(target.ticker, target.name, (target as any).isOwned, (target as any).avgPrice);
    if (embed) message.reply({ embeds: [embed] });
  } else if (/^[0-9A-Z.]+$/.test(content)) {
    // リスト外の銘柄コード（例: TSLA.T など）が直接打たれた場合
    const embed = await getAnalysisEmbed(content, content);
    if (embed) message.reply({ embeds: [embed] });
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
