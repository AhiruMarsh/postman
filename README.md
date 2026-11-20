# postman

## 概要

[Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/) で受信したメールを、宛先アドレスごとに設定した Discord Webhook へ Embed 形式で転送する Cloudflare Worker です。

## 仕組み

```
送信元メールサーバー
  └─ Cloudflare Email Routing (独自ドメイン宛のメールを受信)
       └─ Worker: postman (email handler / src/index.ts)
            ├─ postal-mime でメールを解析 (件名・本文)
            ├─ Workers KV から「宛先アドレス」をキーに Discord Webhook URL を取得
            │    ├─ 登録あり → Discord へ Embed を POST
            │    └─ 登録なし → メールを拒否 (Address not allowed)
            └─ Discord
```

挙動の補足は以下のとおりです。

| 項目 | 内容 |
|------|------|
| 件名 | 空の場合は `(No Subject)` |
| 本文 | プレーンテキストを優先し、無ければ HTML をそのまま使用。空の場合は `(No Body)` |
| 本文の長さ | 2040 文字を超えた分は切り捨て（末尾に ` ...` を付与） |
| 未登録の宛先 | `Address not allowed` として受信を拒否 |
| 通知先の識別 | Embed の author に送信元アドレス、Webhook の表示名に宛先アドレスを使用 |

## 開発言語・フレームワーク

| 種別 | 技術 |
|------|------|
| 言語 | TypeScript |
| 実行環境 | Cloudflare Workers (Email Workers) |
| パッケージマネージャ | Yarn (v4) |

## 使用ミドルウェア・主要ライブラリ

| 名称 | 用途 |
|------|------|
| [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/) | メールの受信、Worker への引き渡し |
| [Cloudflare Workers KV](https://developers.cloudflare.com/kv/) | 宛先アドレスと Discord Webhook URL の対応表 |
| [Discord Webhook](https://discord.com/developers/docs/resources/webhook) | 通知先 |
| [postal-mime](https://github.com/postalsys/postal-mime) | メールの MIME 解析 |
| [Wrangler](https://developers.cloudflare.com/workers/wrangler/) | Cloudflare へのデプロイ、ローカル実行 |

## ディレクトリ構成

```
.
├── src/
│   └── index.ts                    # Worker 本体 (email handler)
├── wrangler.jsonc                  # Worker / KV の設定 (dev / prd)
├── package.json
├── .devcontainer/                  # Dev Container 設定
└── .github/
    ├── dependabot.yml
    └── workflows/
```

## 環境

`wrangler.jsonc` で dev / prd の 2 環境を定義しています。

| 環境 | Worker 名 | KV バインディング | デプロイコマンド |
|------|-----------|-------------------|------------------|
| dev | `postman-dev-server-worker01` | `kv_deliveryMaster` | `yarn deploy` |
| prd | `postman-prd-server-worker01` | `kv_deliveryMaster` | `yarn deploy:prd` |

> prd 環境へのデプロイには `yarn deploy:prd`（内部では `wrangler deploy --env prd`）を使います。`yarn deploy` は dev 環境にデプロイされます。

`wrangler.jsonc` には、環境ごとに次の設定も含まれます。

| 設定 | dev | prd | 備考 |
|------|-----|-----|------|
| `vars.POSTMAN_ENV` | `dev` | `prd` | 環境名を示す変数。現時点で `src/index.ts` からは参照されていません |
| `send_email`（`EMAIL`） | 定義あり | 定義なし | 現時点で `src/index.ts` からは参照されていません |

この Worker は HTTP リクエストを受け付けません（`fetch` ハンドラなし）。`workers.dev` / プレビュー URL も無効です。

## 設定値

デプロイ時に設定が必要な環境変数・シークレットはありません。通知先の設定は Workers KV のみで管理します（`vars.POSTMAN_ENV` は環境名を示すだけの値で、変更不要です）。

| 項目 | 内容 |
|------|------|
| バインディング名 | `kv_deliveryMaster` |
| キー | 受信対象の宛先メールアドレス（例: `alert@example.com`）。受信メールの宛先と完全一致する必要があります |
| 値 | 通知先の Discord Webhook URL |

宛先アドレスを追加するたびに、KV へキーを登録する必要があります。Worker の再デプロイは不要です。

## 前提条件

- Cloudflare アカウント
- Email Routing を有効化済みの、Cloudflare で管理している独自ドメイン
- 通知先の Discord Webhook URL（Discord のチャンネル設定「連携サービス」→「ウェブフック」から作成）
- Node.js 22 以上（Wrangler の要件）
- Yarn 4（`corepack enable` で有効化できます）

## デプロイ手順

初めてデプロイする場合は、以下を上から順に実施してください。

### 1. リポジトリの取得と依存パッケージのインストール

```bash
git clone https://github.com/AhiruMarsh/postman
cd postman
yarn install
```

### 2. Cloudflare へのログイン

```bash
npx wrangler login
```

### 3. KV namespace の作成

dev / prd それぞれで作成します。名前は任意です。

```bash
npx wrangler kv namespace create postman-dev-deliveryMaster-kv01
npx wrangler kv namespace create postman-prd-deliveryMaster-kv01
```

> `--env` を付けると namespace 名の先頭に環境名が付きます。名前を揃えたい場合は付けずに、上記のように名前を直接指定してください。

実行結果に表示される `id` を控えてください。

### 4. wrangler.jsonc の書き換え

[wrangler.jsonc](wrangler.jsonc) の `kv_namespaces[].id` を、手順 3 で控えた ID に書き換えます。

```jsonc
{
  "kv_namespaces": [
    {
      "binding": "kv_deliveryMaster",
      "id": "<dev 用 KV namespace ID>"
    }
  ],
  "env": {
    "prd": {
      "kv_namespaces": [
        {
          "binding": "kv_deliveryMaster",
          "id": "<prd 用 KV namespace ID>"
        }
      ]
    }
  }
}
```

> **必ず書き換えてください。**
> リポジトリにコミットされている ID はリポジトリ作成者の Cloudflare アカウントのものです。そのままではデプロイに失敗します。
>
> Worker 名（`name`）も、同一アカウント内で重複しない名前に変更できます。変更した場合は、手順 7 で指定する Worker 名も合わせてください。
>
> `binding` の値は `src/index.ts` が参照しているため、変更しないでください。

### 5. Worker のデプロイ

```bash
# dev 環境
yarn deploy

# prd 環境
yarn deploy:prd
```

> KV への登録（手順 6）より先にデプロイしても構いません。登録前は、すべてのメールが拒否されます。

### 6. 宛先アドレスと Webhook URL の登録

`--remote` を必ず付けてください。付けない場合はローカルの KV に書き込まれ、デプロイした Worker からは参照できません。

```bash
# dev 環境
npx wrangler kv key put --binding=kv_deliveryMaster --remote \
  "alert@example.com" "https://discord.com/api/webhooks/xxxx/yyyy"

# prd 環境
npx wrangler kv key put --binding=kv_deliveryMaster --env prd --remote \
  "alert@example.com" "https://discord.com/api/webhooks/xxxx/yyyy"
```

登録内容の確認は次のコマンドで行えます。

```bash
npx wrangler kv key list --binding=kv_deliveryMaster --remote
# prd の場合は --env prd を追加
```

> Webhook URL は秘密情報です。リポジトリにコミットしないでください。

### 7. Email Routing の設定

Cloudflare ダッシュボードで、対象ドメインの **Email** → **Email Routing** → **Routing rules** を開きます。

1. Custom address（または Catch-all address）に、手順 6 で登録した宛先アドレスを設定
2. Action を **Send to a Worker** にし、デプロイした Worker（`postman-dev-server-worker01` など）を選択

画面の項目名や操作は変更される場合があります。最新の手順は公式ドキュメントを参照してください。

- [Email Routing](https://developers.cloudflare.com/email-routing/)
- [Email Workers](https://developers.cloudflare.com/email-routing/email-workers/)

### 8. 動作確認

設定した宛先アドレスにメールを送信し、Discord に通知が届くことを確認します。

届かない場合は、後述の「トラブルシューティング」を参照してください。

## ローカル開発

### Dev Container

Dev Container を使用した開発環境の構築を推奨します。

1. VS Code に [Dev Containers 拡張機能](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) をインストール
2. VS Code でリポジトリを開き、「Reopen in Container」を選択
3. コンテナ起動後、依存パッケージは自動インストールされます

> Dev Container を使用しない場合は、Node.js 22 以上をインストールし `yarn install` を実行してください。

### ローカルでの動作確認

Wrangler のローカルサーバーを起動します。

```bash
yarn dev
```

別のターミナルから、メール受信を擬似的に発生させます。`to` には、ローカル KV に登録したアドレスを指定します。

```bash
# ローカル KV にアドレスを登録 (--remote なし = ローカル)
npx wrangler kv key put --binding=kv_deliveryMaster \
  "alert@example.com" "https://discord.com/api/webhooks/xxxx/yyyy"

# サンプルメールを作成
cat > sample.eml <<'EOF'
From: sender@example.com
To: alert@example.com
Subject: テスト通知
Content-Type: text/plain; charset=UTF-8

これはテスト本文です。
EOF

# メール受信を擬似的に発生させる
curl -X POST \
  "http://localhost:8787/cdn-cgi/handler/email?from=sender@example.com&to=alert@example.com" \
  --data-binary @sample.eml
```

実際の Discord に通知したくない場合は、動作確認用のチャンネルで作成した Webhook URL を使用してください。

### 型定義の生成

`worker-configuration.d.ts`（`Env` の型定義）はリポジトリに含まれません。エディタ上の型エラーを解消したい場合や、`wrangler.jsonc` のバインディングを変更した場合は、次のコマンドで生成・再生成します。

```bash
yarn cf-typegen
```

## トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| 送信元に `Address not allowed` のエラーが返る | 宛先アドレスが KV に未登録、またはキーが一致していない | `kv key list --remote` で登録内容を確認。環境（dev / prd）の取り違えにも注意 |
| メールが拒否されないが Discord に届かない | Webhook URL が無効（削除された、誤っている） | ログに `Discord API responded with status ...` が出ていないか確認し、URL を登録し直す |
| デプロイ時に KV namespace のエラーが出る | `wrangler.jsonc` の ID が作成者のままになっている | 手順 4 を実施 |
| KV に登録したのに参照されない | `--remote` を付けずに登録した（ローカル KV に書き込まれた） | `--remote` を付けて登録し直す |
| prd に反映されない | dev 用の `yarn deploy` を実行した | `yarn deploy:prd` で再デプロイ |
| 長いメールの末尾が欠ける | 本文は 2040 文字で切り捨てる仕様 | 仕様です |

Worker のログは次のコマンドで確認できます。

```bash
npx wrangler tail
# prd の場合
npx wrangler tail --env prd
```

`wrangler.jsonc` で `observability` を有効にしているため、Cloudflare ダッシュボードの Workers & Pages → 対象 Worker → Observability からも確認できます。

## CI / CD

GitHub Actions を使用しています。

| イベント | ワークフロー | 内容 |
|---|---|---|
| `push` → main | `Release` | 共通ワークフロー [AhiruMarsh/actions](https://github.com/AhiruMarsh/actions) の `release.yaml` を呼び出し |
| Issue / PR へのコメント等 | `Claude` | 共通ワークフローの `claude.yaml` を呼び出し（Claude Code による支援） |

Cloudflare へのデプロイは CI では行いません。手動で実施してください。

ブランチは `develop` → `main` の流れで運用しています。

## 依存関係の自動更新

Dependabot により以下が週次で自動更新されます（対象ブランチは `develop`）。

- npm パッケージ
- GitHub Actions
- Dev Container
