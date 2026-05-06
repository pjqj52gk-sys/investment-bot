import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export async function sendDiscordNotification(message: string): Promise<boolean> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  
  if (!webhookUrl || webhookUrl === 'your_discord_webhook_url_here') {
    console.log("Discord WebhookのURLが設定されていないため、通知をスキップします。");
    return false;
  }

  try {
    const response = await axios.post(webhookUrl, {
      content: message
    });
    console.log(`Discord通知を送信しました。 (Status: ${response.status})`);
    return true;
  } catch (error: any) {
    if (error.response) {
      console.error(`Discord通知送信エラー (Status: ${error.response.status}):`, error.response.data);
    } else {
      console.error("Discord通知送信エラー:", error.message);
    }
    return false;
  }
}
