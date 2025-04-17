export default {
  async email(message, env, ctx): Promise<void> {
    try {
      // 受信メールの送信元アドレス
      const sender: string = message.from;

      // 受信メールの送信先アドレス
      const sendto: string = message.to;

      // 受信メールのタイトル
      const subject: string = `${message.headers.get("subject")}`;

      // 受信メールの詳細
      //const detail = await truncateString(message.html);

      // KVストアから送信先アドレスに一致するDiscord Webhook URLを取得
      const webhookURL: string = `${await env.kv_deliveryMaster.get(sendto)}`;

      if (webhookURL != "") {
        // DiscordにEmbed形式で通知を送信
        const embed: object = {
          title: subject,
          //description: detail,
          fields: [],
          author: {
            name: sender,
          },
          footer: {
            text: sendto,
          },
          timestamp: new Date().toISOString(),
        };

        await sendDiscordEmbedNotification(webhookURL, embed);
      } else {
        console.log(`Webhook URL not found for ${sender}`);
      }
    } catch (error) {
      console.error("Error processing email:", error);
    }
  },
} satisfies ExportedHandler<Env>;

// 一定の文字数が存在する際に切り捨てるための関数
function truncateString(detail: string): string {
  const maxLength = 6000;

  if (detail.length > maxLength) {
    return `${detail.slice(0, maxLength)} ...`;
  } else {
    return `${detail}`;
  }
}

// DiscordにEmbedで通知するための関数
async function sendDiscordEmbedNotification(webhookURL: string, embed: object) {
  const payload = {
    username: "postman-dev",
    embeds: [embed],
  };

  try {
    const response = await fetch(webhookURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    console.log(payload);
    if (!response.ok) {
      console.error(
        `Failed to send Discord notification. Status: ${response.status}`
      );
    }
  } catch (error) {
    console.error("Error sending Discord notification:", error);
  }
}
