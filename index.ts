import { Client, GatewayIntentBits, TextChannel, EmbedBuilder } from 'discord.js';
import { fetchTavilyData } from './fetchTavily';
import { fetchTechnicalData, fetchMarketContext } from './fetchTechnical';
import { analyzeInvestment, getBestRecommendation, askGeneralQuestion } from './aiAnalyzer';
import { runReflection, consolidateRulebook } from './reflection';
import { savePrediction } from './logger';
import { loadPortfolio, addPosition, closePosition, getPortfolioSummary, Position } from './portfolio';
import cron from 'node-cron';
import dotenv from 'dotenv';
import fs from 'fs';

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
  { ticker: "1605.T", name: "INPEX" },
  { ticker: "7011.T", name: "三菱重工業" },
  { ticker: "7013.T", name: "IHI" },
  { ticker: "6762.T", name: "TDK" },
  { ticker: "9984.T", name: "ソフトバンクグループ" },
  { ticker: "6954.T", name: "ファナック" },
  { ticker: "6324.T", name: "ハーモニック・ドライブ" },
  { ticker: "6857.T", name: "アドバンテスト" },
];

const US_WATCH_LIST = [
  { ticker: "BE", name: "Bloom Energy" },
  { ticker: "SMR", name: "NuScale Power" },
  { ticker: "BLDP", name: "Ballard Power" },
  { ticker: "TQQQ", name: "ProShares QQQ 3x", isOwned: true, avgPrice: 75.76 },
  { ticker: "SOXL", name: "Semi Bull 3x", isOwned: true, avgPrice: 160.685 },
  { ticker: "NVDA", name: "NVIDIA" },
  { ticker: "RGTI", name: "Rigetti Computing", isOwned: true, avgPrice: 18.78 },
  { ticker: "RDDT", name: "Reddit" },
  { ticker: "ARM", name: "Arm Holdings", isOwned: true, avgPrice: 218.06 },
  { ticker: "IONQ", name: "IonQ" },
];

async function getAnalysisEmbed(ticker: string, name: string, manualOwned: boolean = false, manualAvgPrice: number | null = null, modelName: string = "gpt-4o") {
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
  const analysis = await analyzeInvestment(technical, tavilyData, totalCapital, marketContext, modelName);

  // 予測結果をログに保存 (自己学習用)
  savePrediction(ticker, technical.currentPrice, analysis);

  const strategyStr = analysis.judgment !== 'HOLD' && analysis.judgment !== 'DON\'T BUY'
    ? `注文方法: ${analysis.strategy.order_type === 'LIMIT' ? '指値 (Limit)' : '成行 (Market)'}\n目標価格: ${analysis.strategy.price || 'なし'}\n利確目安: ${analysis.strategy.take_profit || 'なし'}\n損切目安: ${analysis.strategy.stop_loss || 'なし'}\n推奨数量: ${analysis.strategy.quantity}\nリスク: ${analysis.strategy.risk_level}\n配分: ${analysis.strategy.allocation_percent}%`
    : '様子見';

  const embed = new EmbedBuilder()
    .setTitle(`${name} (${ticker}) 分析結果`)
    .setColor(analysis.judgment === 'BUY' ? 0x00ff00 : analysis.judgment === 'SELL' ? 0xff0000 : 0xffff00)
    .setFooter({ text: `データ取得日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} • 分析モデル: ${modelName}` })
    .setTimestamp()
    .addFields(
      { name: '判定', value: `**${analysis.judgment}**`, inline: true },
      { name: '戦略・注文方法', value: `\`\`\`\n${strategyStr}\n\`\`\``, inline: true },
      { name: '理由', value: analysis.reason },
      { name: 'テクニカル状況', value: `\`\`\`\n${technical.summary}\n\`\`\`` },
      { name: '取得情報サマリー', value: `\`\`\`\n${tavilyData.summary.substring(0, 1000)}...\n\`\`\`` }
    )
    .setTimestamp();

  // AIがBUY判定かつ未保有の場合、仮想ポートフォリオに追加
  if (analysis.judgment === 'BUY' && !manualOwned) {
    addPosition({
      ticker: ticker,
      name: name,
      buyPrice: technical.currentPrice,
      buyDate: new Date().toISOString(),
      takeProfit: analysis.strategy.take_profit,
      stopLoss: analysis.strategy.stop_loss,
      quantity: analysis.strategy.quantity
    });
  }

  return { embed, decision: analysis };
}

async function sendToChannel(channelId: string, embedOrContent: EmbedBuilder | string) {
  try {
    const channel = await client.channels.fetch(channelId) as TextChannel;
    if (channel) {
      if (typeof embedOrContent === 'string') {
        await channel.send(embedOrContent);
      } else {
        await channel.send({ embeds: [embedOrContent] });
      }
    } else {
      console.error(`[ERROR] Channel not found: ${channelId}`);
    }
  } catch (error: any) {
    console.error(`[ERROR] Failed to send to channel ${channelId}:`, error.message);
  }
}

async function runBatchAnalysis(list: any[], type: string) {
  const channelId = process.env.DISCORD_CHANNEL_ID || "";
  console.log(`=== ${type} 一括分析開始 ===`);

  await sendToChannel(channelId, `🚀 **${type}** の定期一括分析を開始します...`);

  const results: { ticker: string, decision: any }[] = [];

  for (const stock of list) {
    const res = await getAnalysisEmbed(stock.ticker, stock.name, stock.isOwned, stock.avgPrice);
    if (res && typeof res !== 'string') {
      await sendToChannel(channelId, res.embed);
      results.push({ ticker: stock.ticker, decision: res.decision });
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // 全銘柄の分析が終わったら、AIに「今日のおすすめ」を決めさせる
  if (results.length > 0) {
    const bestRes = await getBestRecommendation(results);
    const bestEmbed = new EmbedBuilder()
      .setTitle("✨ 本日の最強おすすめ銘柄 ✨")
      .setColor(0xd4af37) // ゴールド
      .setDescription(`**${bestRes.best_ticker}**\n\n${bestRes.reason}`)
      .addFields({ name: "戦略サマリー", value: bestRes.summary })
      .setTimestamp();

    await sendToChannel(channelId, bestEmbed);
  }
}

/**
 * ポートフォリオのアラートチェック
 */
async function checkPortfolioAlerts() {
  const channelId = process.env.DISCORD_CHANNEL_ID || "";
  const portfolio = loadPortfolio();
  if (portfolio.length === 0) return;

  console.log("=== ポートフォリオ・アラートチェック開始 ===");

  for (const pos of portfolio) {
    try {
      const technical = await fetchTechnicalData(pos.ticker);
      if (typeof technical === 'string') continue;

      const currentPrice = technical.currentPrice;
      let alertMsg = "";
      let isClosed = false;

      if (pos.takeProfit && currentPrice >= pos.takeProfit) {
        alertMsg = `💰 **利確アラート: ${pos.name} (${pos.ticker})**\n目標価格 $${pos.takeProfit} に到達しました！現在の価格: $${currentPrice}`;
        isClosed = true;
      } else if (pos.stopLoss && currentPrice <= pos.stopLoss) {
        alertMsg = `⚠️ **損切アラート: ${pos.name} (${pos.ticker})**\n損切価格 $${pos.stopLoss} を下回りました。現在の価格: $${currentPrice}`;
        isClosed = true;
      }

      if (alertMsg) {
        const embed = new EmbedBuilder()
          .setTitle("🚀 仮想ポートフォリオ・アラート")
          .setDescription(alertMsg)
          .setColor(isClosed ? 0xffa500 : 0x00ff00)
          .setTimestamp();

        await sendToChannel(channelId, embed);
        if (isClosed) {
          closePosition(pos.ticker);
          await sendToChannel(channelId, `✅ ${pos.ticker} をポートフォリオから削除しました。`);
        }
      }
    } catch (e) {
      console.error(`Alert check failed for ${pos.ticker}:`, e);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
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
  // 平日 22:00 予測（オープン前）
  cron.schedule('0 22 * * 1-5', () => {
    runBatchAnalysis(US_WATCH_LIST, "米国株(オープン前)");
  });
  // 平日 22:40 分析（オープン直後）
  cron.schedule('40 22 * * 1-5', () => {
    runBatchAnalysis(US_WATCH_LIST, "米国株(オープン直後)");
  });
  // 平日 06:30 反省
  cron.schedule('30 6 * * 2-6', () => {
    runBatchReflection(US_WATCH_LIST, "米国株(クローズ後)");
  });

  // 1時間おきにポートフォリオのアラートチェック
  cron.schedule('0 * * * *', () => {
    checkPortfolioAlerts();
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

  // ポートフォリオ確認コマンド
  if (content === 'ポートフォリオ' || content === 'P' || content === 'STATUS') {
    const summary = getPortfolioSummary();
    const embed = new EmbedBuilder()
      .setTitle("📊 現在の仮想ポートフォリオ状況")
      .setDescription(summary)
      .setColor(0x2ecc71)
      .setTimestamp();
    message.reply({ embeds: [embed] });
    return;
  }

  // チャンネルID確認コマンド
  if (content === 'ID') {
    message.reply(`このチャンネルのIDは: \`${message.channel.id}\` です。\n設定されているIDは: \`${process.env.DISCORD_CHANNEL_ID}\` です。\n一致していない場合は .env を修正してください。`);
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

  // 個別分析用に大文字化していない生の内容も取得しておく
  const rawContent = message.content.trim();

  // 銘柄名またはコードでの個別分析（大文字小文字を区別しない）
  const jpStock = JP_WATCH_LIST.find(s => s.ticker.toUpperCase() === content || s.name === rawContent);
  const usStock = US_WATCH_LIST.find(s => s.ticker.toUpperCase() === content || s.name === rawContent);
  const target = jpStock || usStock;

  // 監視リストにあるか、あるいは 1234 や NVDA のような形式か判定
  if (target || /^[0-9A-Z.]+$/.test(content) || (rawContent.length >= 2 && !rawContent.includes(' '))) {
    const ticker = target ? target.ticker : content;
    const name = target ? target.name : rawContent;
    const isOwned = target ? (target as any).isOwned : false;
    const avgPrice = target ? (target as any).avgPrice : null;

    const statusMsg = await message.reply(`🔍 **${name} (${ticker})** を分析中です。最新のニュースとチャートを読み込んでいます...`);

    // 「入力中...」を表示
    await message.channel.sendTyping();

    // 個別分析は最新・最強の推論モデル(gpt-5.5)を使用
    const res = await getAnalysisEmbed(ticker, name, isOwned, avgPrice, "gpt-5.5");
    if (res && res.embed) {
      await statusMsg.edit({ content: `✅ **${name} (${ticker})** の分析が完了しました！`, embeds: [res.embed] });
    } else {
      await statusMsg.edit(`❌ **${name} (${ticker})** の分析中にエラーが発生しました。入力が正しいか確認してください。`);
    }
  } else if (rawContent.length >= 5 && (rawContent.includes('？') || rawContent.includes('?') || rawContent.length > 10)) {
    // どのコマンドや銘柄にも該当しない場合は、一般質問としてAIに聞く
    const typingMsg = await message.reply("🤔 投資アドバイザーに相談しています...");
    try {
      await message.channel.sendTyping();
      const marketContext = await fetchMarketContext();
      const portfolio = loadPortfolio();
      const answer = await askGeneralQuestion(rawContent, marketContext, portfolio);
      await typingMsg.edit(answer);
    } catch (err) {
      console.error("[ERROR] Chat error:", err);
      await typingMsg.edit("⚠️ 申し訳ありません、相談中にエラーが発生しました。");
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
