import { Client, GatewayIntentBits, TextChannel, EmbedBuilder } from 'discord.js';
import { fetchTavilyData } from './fetchTavily';
import { fetchTechnicalData, fetchMarketContext } from './fetchTechnical';
import { analyzeInvestment } from './aiAnalyzer';
import { runReflection, consolidateRulebook } from './reflection';
import { savePrediction } from './logger';
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
  { ticker: "1605", name: "INPEX" },
  { ticker: "7011", name: "三菱重工業" },
  { ticker: "7013", name: "IHI" },
  { ticker: "6762", name: "TDK" },
  { ticker: "9984", name: "ソフトバンクグループ" },
  { ticker: "6954", name: "ファナック", isOwned: true, avgPrice: 6858.00 },
  { ticker: "6324", name: "ハーモニック・ドライブ" },
];

const US_WATCH_LIST = [
  { ticker: "BE", name: "Bloom Energy" },
  { ticker: "SMR", name: "NuScale Power" },
  { ticker: "BLDP", name: "Ballard Power", isOwned: true, avgPrice: 4.5215 },
  { ticker: "TQQQ", name: "ProShares QQQ 3x" },
  { ticker: "SOXL", name: "Semi Bull 3x" },
  { ticker: "NVDA", name: "NVIDIA" },
  { ticker: "RGTI", name: "Rigetti Computing" },
  { ticker: "RDDT", name: "Reddit" },
];

async function getAnalysisEmbed(ticker: string, name: string, manualOwned: boolean = false, manualAvgPrice: number | null = null) {
  // 市場全体の地合いを取得
  const marketContext = await fetchMarketContext();
  const totalCapital = Number(process.env.TOTAL_CAPITAL) || 0;

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
  const analysis = await analyzeInvestment(technical, tavilyData, totalCapital, marketContext);

  // 予測結果をログに保存 (自己学習用)
  savePrediction(ticker, technical.currentPrice, analysis);

  const strategyStr = analysis.judgment !== 'HOLD' && analysis.judgment !== 'DON\'T BUY' 
    ? `注文方法: ${analysis.strategy.order_type === 'LIMIT' ? '指値 (Limit)' : '成行 (Market)'}\n目標価格: ${analysis.strategy.price || 'なし'}\n推奨数量: ${analysis.strategy.quantity}\nリスク: ${analysis.strategy.risk_level}\n配分: ${analysis.strategy.allocation_percent}%`
    : '様子見';

  const embed = new EmbedBuilder()
    .setTitle(`${name} (${ticker}) 分析結果`)
    .setColor(analysis.judgment === 'BUY' ? 0x00ff00 : analysis.judgment === 'SELL' ? 0xff0000 : 0xffff00)
    .setFooter({ text: `データ取得日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}` })
    .setTimestamp()
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

async function runBatchAnalysis(list: any[], type: string) {
  const channelId = process.env.DISCORD_CHANNEL_ID || "";
  console.log(`=== ${type} 一括分析開始 ===`);
  
  for (const stock of list) {
    const embed = await getAnalysisEmbed(stock.ticker, stock.name, stock.isOwned, stock.avgPrice);
    if (embed) await sendToChannel(channelId, embed);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

async function runBatchReflection(list: any[], type: string) {
  const channelId = process.env.DISCORD_CHANNEL_ID || "";
  console.log(`=== ${type} 自動反省会開始 ===`);
  
  let memoCount = 0;
  for (const stock of list) {
    const result = await runReflection(stock.ticker);
    if (typeof result !== 'string') {
      memoCount++;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  if (memoCount > 0) {
    const embed = new EmbedBuilder()
      .setTitle(`🔔 ${type} 自動反省会完了`)
      .setDescription(`${memoCount} 件の新しい気づき（メモ）をデータ蓄積しました。週末にまとめて学習します。`)
      .setColor(0x3498db)
      .setTimestamp();
    await sendToChannel(channelId, embed);
  }
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user?.tag}!`);
  
  // 起動時に1回実行
  // runBatchAnalysis();

  // 【日本株サイクル】
  // 平日 08:40 予測
  cron.schedule('40 8 * * 1-5', () => {
    runBatchAnalysis(JP_WATCH_LIST, "日本株(前場前)");
  });
  // 平日 15:30 反省
  cron.schedule('30 15 * * 1-5', () => {
    runBatchReflection(JP_WATCH_LIST, "日本株(大引け後)");
  });
  
  // 【米国株サイクル】
  // 平日 22:00 予測
  cron.schedule('0 22 * * 1-5', () => {
    runBatchAnalysis(US_WATCH_LIST, "米国株(オープン前)");
  });
  // 平日 06:30 反省
  cron.schedule('30 6 * * 2-6', () => {
    runBatchReflection(US_WATCH_LIST, "米国株(クローズ後)");
  });

  // 【週末：統計学習・ルールブック更新】
  // 毎週土曜日 10:00
  cron.schedule('0 10 * * 6', async () => {
    const channelId = process.env.DISCORD_CHANNEL_ID || "";
    const report = await consolidateRulebook();
    const embed = new EmbedBuilder()
      .setTitle("🧠 週末・自己学習アップデート完了")
      .setDescription(report)
      .setColor(0x9b59b6)
      .setTimestamp();
    await sendToChannel(channelId, embed);
  });
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim().toUpperCase();

  // 反省コマンド（例: 「反省 TSLA」）
  if (content.startsWith('反省')) {
    const ticker = content.replace('反省', '').trim();
    if (!ticker) {
      message.reply("銘柄コードを指定してください。（例: `反省 TSLA`）");
      return;
    }
    
    const replyMessage = await message.reply(`🧠 ${ticker} の過去の予測結果を振り返り、学習しています...`);
    const result = await runReflection(ticker);
    
    if (typeof result === 'string') {
      await replyMessage.edit(result);
    } else {
      const embed = new EmbedBuilder()
        .setTitle(`🧠 反省会結果: ${ticker}`)
        .setDescription(`評価: ${result.evaluation}\n\n価格変動: ${result.priceChange}`)
        .addFields({ name: '今回の教訓(メモ)', value: result.lesson })
        .setColor(0x3498db)
        .setTimestamp();
      await replyMessage.edit({ content: '', embeds: [embed] });
    }
    return;
  }

  // ルール確認コマンド
  if (content === 'ルール') {
    const lessonsFile = './logs/lessons.txt';
    const lessons = fs.existsSync(lessonsFile) ? fs.readFileSync(lessonsFile, 'utf-8') : "まだ学習したルールはありません。";
    message.reply(`📜 **現在の公式ルールブック**\n\`\`\`\n${lessons}\n\`\`\``);
    return;
  }

  // 手動での統計分析（管理者用）
  if (content === '学習実行') {
    const reply = await message.reply("📊 1週間の集計を開始します...");
    const report = await consolidateRulebook();
    message.reply(report);
    return;
  }

  // 一括分析コマンド
  if (content === '一括分析' || content === '分析 日本') {
    message.reply("🇯🇵 日本株の一括分析を開始します（数分かかります）...");
    runBatchAnalysis(JP_WATCH_LIST, "日本株(手動実行)");
    if (content === '分析 日本') return;
  }
  
  if (content === '一括分析' || content === '分析 米国') {
    message.reply("🇺🇸 米国株の一括分析を開始します（数分かかります）...");
    runBatchAnalysis(US_WATCH_LIST, "米国株(手動実行)");
    return;
  }
  
  // 銘柄名またはコードでの個別分析（大文字小文字を区別しない）
  const jpStock = JP_WATCH_LIST.find(s => s.ticker === content || s.name.toUpperCase() === content);
  const usStock = US_WATCH_LIST.find(s => s.ticker === content || s.name.toUpperCase() === content);
  const target = jpStock || usStock;

  if (target || /^[0-9A-Z.]+$/.test(content)) {
    const ticker = target ? target.ticker : content;
    const name = target ? target.name : content;
    const isOwned = target ? (target as any).isOwned : false;
    const avgPrice = target ? (target as any).avgPrice : null;

    const statusMsg = await message.reply(`🔍 **${name} (${ticker})** を分析中です。最新のニュースとチャートを読み込んでいます...`);
    
    // 「入力中...」を表示
    await message.channel.sendTyping();

    const embed = await getAnalysisEmbed(ticker, name, isOwned, avgPrice);
    if (embed) {
      await statusMsg.edit({ content: `✅ **${name} (${ticker})** の分析が完了しました！`, embeds: [embed] });
    } else {
      await statusMsg.edit(`❌ **${name} (${ticker})** の分析中にエラーが発生しました。コードが正しいか確認してください。`);
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
