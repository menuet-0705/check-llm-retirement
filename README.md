# LLM Retirement Checker

ChatGPT (OpenAI) / Claude (Anthropic) / Gemini (Google) のモデルについて、各社の公式 Deprecation(廃止予定)ページを **1日1回自動チェック**し、登録したモデルの提供終了日が公開されたら**メールで通知**する Web アプリです。

## 技術スタック

| 項目 | 使用技術 |
|---|---|
| フロントエンド / バックエンド | Next.js 16 (App Router) + TypeScript |
| ORM | Prisma 7(`prisma-client` ジェネレーター + `@prisma/adapter-pg`) |
| データベース | Supabase (PostgreSQL) |
| 認証 | NextAuth v5 (Auth.js) — メールアドレス + パスワード |
| メール送信 | Resend |
| 定期実行 | Vercel Cron(毎日 0:00 UTC = 日本時間 9:00) |
| スクレイピング | cheerio |

## 仕組み

1. ユーザーがアカウント登録し、監視したいモデル(例: `gpt-4o`)をプロバイダーと共に登録する
2. Vercel Cron が毎日 `/api/cron/check-deprecations` を呼び出す
3. 各社の公式 Deprecation ページを取得し、登録モデルの提供終了日を探す
   - OpenAI: <https://platform.openai.com/docs/deprecations>
   - Anthropic: <https://platform.claude.com/docs/en/about-claude/model-deprecations>
   - Google: <https://ai.google.dev/gemini-api/docs/deprecations>(+ changelog)
4. 提供終了日が新たに公開(または変更)されていたら、Resend でユーザーにメール通知

補足:

- モデル名は**トークン単位の完全一致**で照合します(`gemini-2.5-flash` が `gemini-2.5-flash-lite` の行に誤マッチしない)。日付付きスナップショット(`claude-opus-4-1` ↔ `claude-opus-4-1-20250805`)は同一モデルとして扱います。
- Anthropic の「Not sooner than ...」(アクティブモデルの最短提供保証日)は廃止日として扱いません。
- スクレイピングは公式ページの構成変更で動かなくなる可能性があります。その場合は [src/lib/scraper.ts](src/lib/scraper.ts) の `DEPRECATION_SOURCES` と抽出ロジックを調整してください。

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.example` をコピーして `.env` を作成し、値を設定します。

```bash
cp .env.example .env
```

| 変数 | 説明 |
|---|---|
| `DATABASE_URL` | Supabase の **Transaction pooler** 接続文字列(ポート 6543、`?pgbouncer=true` 付き)。アプリ実行時に使用 |
| `DIRECT_URL` | Supabase の **Direct connection** 接続文字列(ポート 5432)。`prisma migrate` / `db push` 時に使用 |
| `AUTH_SECRET` | `openssl rand -base64 32` で生成 |
| `AUTH_URL` | ローカルは `http://localhost:3000`、本番はデプロイ先 URL |
| `RESEND_API_KEY` | [Resend](https://resend.com/api-keys) の API キー |
| `EMAIL_FROM` | 送信元アドレス(Resend にドメイン未登録なら `onboarding@resend.dev` のまま) |
| `CRON_SECRET` | `openssl rand -hex 32` で生成。Cron エンドポイントの認証に使用 |

接続文字列は Supabase ダッシュボードの **Connect > ORMs (Prisma)** からコピーできます。

### 3. データベースにスキーマを反映

```bash
npx prisma migrate dev --name init
# または(マイグレーション履歴を作らない場合)
npx prisma db push
```

### 4. 開発サーバーの起動

```bash
npm run dev
```

<http://localhost:3000> を開き、アカウント登録 → モデル登録ができます。

### 5. Cron の手動テスト(ローカル)

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/check-deprecations
```

レスポンス例: `{"checked":2,"found":1,"notified":1,"errors":[]}`

## Vercel へのデプロイ

1. リポジトリを Vercel にインポート
2. 上記の環境変数をすべて Vercel の **Environment Variables** に設定
   - `CRON_SECRET` を設定すると、Vercel Cron の呼び出しに自動で `Authorization: Bearer <CRON_SECRET>` ヘッダーが付与されます
3. デプロイすると [vercel.json](vercel.json) の設定により、毎日 0:00 UTC に自動チェックが実行されます

## 主要ファイル

| パス | 内容 |
|---|---|
| [prisma/schema.prisma](prisma/schema.prisma) | DB スキーマ(User / WatchedModel) |
| [src/lib/scraper.ts](src/lib/scraper.ts) | 公式ページのスクレイピングと廃止日抽出 |
| [src/lib/email.ts](src/lib/email.ts) | Resend による通知メール送信 |
| [src/lib/auth.ts](src/lib/auth.ts) | NextAuth (Auth.js) 設定 |
| [src/app/api/cron/check-deprecations/route.ts](src/app/api/cron/check-deprecations/route.ts) | 1日1回の定期チェック本体 |
| [src/app/dashboard/page.tsx](src/app/dashboard/page.tsx) | 監視モデルの登録・一覧画面 |
