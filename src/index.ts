import PostalMine from "postal-mime";

interface Postman {
  readonly source_address: string;
  readonly dest_address: string;
  readonly subject: string;
  detail: string;
}

const MAX_DETAIL_LENGTH = 2040;

async function streamToArrayBuffer(
  stream: ReadableStream<Uint8Array<ArrayBufferLike>>,
  streamSize: number,
): Promise<Uint8Array> {
  let result = new Uint8Array(streamSize);
  let bytesRead = 0;
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      // ストリームサイズを超えるデータが来た場合のエラーハンドリング
      if (bytesRead + value.length > streamSize) {
        // サイズ超過のエラーとして処理を中断し、エラーを伝播させる
        throw new Error(
          `Stream exceeded expected size. Expected: ${streamSize}, Received at least: ${
            bytesRead + value.length
          }`,
        );
      }

      result.set(value, bytesRead);
      bytesRead += value.length;
    }

    // 実際に読み込んだサイズが期待サイズと異なる場合のチェック
    if (bytesRead !== streamSize) {
      console.warn(
        `Stream size mismatch. Expected: ${streamSize}, Actual: ${bytesRead}`,
      );
    }
  } catch (error) {
    console.error("Error reading stream:", error);
    throw error;
  } finally {
    // ストリームリーダーのロックを解放
    if (!reader.closed) {
      reader.releaseLock();
    }
  }
  return result;
}

// 一定の文字数が存在する際に切り捨てるための関数
function truncateString(detail: string | null | undefined): string {
  if (detail === null || detail === undefined) {
    return "";
  }

  if (detail.length > MAX_DETAIL_LENGTH) {
    console.warn("Detail length exceeds maximum length. Truncating.");
    return `${detail.slice(0, MAX_DETAIL_LENGTH)} ...`;
  } else {
    return detail;
  }
}

// DiscordにEmbedで通知するための関数
async function sendDiscordEmbedNotification(
  sendto: string,
  webhookURL: string,
  embed: object,
) {
  const payload = {
    username: sendto,
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

    // 成功/失敗に関わらず、レスポンスステータスを確認し、必要に応じてエラーをスロー
    if (!response.ok) {
      const errorText = await response.text(); // エラーレスポンスのボディを取得
      const errorMessage = `Discord API responded with status ${response.status}: ${errorText}`;
      console.error(errorMessage);

      throw new Error(errorMessage);
    }
  } catch (error) {
    // fetch自体のエラー（ネットワークエラー、タイムアウトなど）を捕捉
    console.error("Error during fetch to Discord API:", error);
    throw error;
  }
}

export default {
  async email(message, env, ctx): Promise<void> {
    let rawEmail: Uint8Array;
    try {
      rawEmail = await streamToArrayBuffer(message.raw, message.rawSize);
    } catch (error) {
      console.error("Failed to read raw email stream:", error);
      return;
    }

    let parsedEmail;
    try {
      const parser = new PostalMine();
      parsedEmail = await parser.parse(rawEmail);
    } catch (error) {
      console.error("Failed to parse email:", error);
      return;
    }

    // 受信メールの前処理
    const postman: Postman = {
      source_address: message.from,
      dest_address: message.to,
      subject: parsedEmail.subject || "(No Subject)",
      detail: parsedEmail.text || parsedEmail.html || "(No Body)",
    };

    // メッセージ内容を規定の長さで切り捨てる
    postman.detail = truncateString(postman.detail);

    // Webhook URL 取得
    let webhookURL: string | null;
    try {
      // KVストアから送信先アドレスに一致するDiscord Webhook URLを取得
      // KV.getは値が存在しない場合にnullを返す
      webhookURL = await env.kv_deliveryMaster.get(postman.dest_address);
    } catch (error) {
      console.error(
        `Failed to get webhook URL from KV for ${postman.dest_address}`,
        error,
      );
      return;
    }

    // Webhook 送信処理
    if (webhookURL) {
      // DiscordにEmbed形式で通知を送信
      const embed: object = {
        title: postman.subject,
        description: postman.detail,
        fields: [],
        author: {
          name: postman.source_address,
        },
        footer: {
          text: "postman",
        },
        timestamp: new Date().toISOString(),
      };

      try {
        await sendDiscordEmbedNotification(
          postman.dest_address,
          webhookURL,
          embed,
        );
      } catch (error) {
        const errorMessage = `Failed to send Discord notification for ${error}`;
        console.error(errorMessage);

        throw new Error(errorMessage);
      }
    } else {
      const errorMessage = `Webhook URL not found for ${postman.dest_address}`;
      console.error(errorMessage);

      message.setReject("Address not allowed");
    }
  },
} satisfies ExportedHandler<Env>;
