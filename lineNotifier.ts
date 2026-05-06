import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export async function sendLineNotification(message: string): Promise<boolean> {
  const token = process.env.LINE_NOTIFY_TOKEN;
  
  if (!token || token === 'your_line_notify_token_here') {
    console.log("LINE Notifyのトークンが設定されていないため、通知をスキップします。");
    return false;
  }

  const url = 'https://notify-api.line.me/api/notify';
  const params = new URLSearchParams();
  params.append('message', message);

  try {
    await axios.post(url, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${token}`
      }
    });
    console.log("LINE通知を送信しました。");
    return true;
  } catch (error) {
    console.error("LINE通知送信エラー:", error);
    return false;
  }
}
