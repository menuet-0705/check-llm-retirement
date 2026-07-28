import { Resend } from "resend";
import type { RetirementInfo } from "@/lib/scraper";

const PROVIDER_LABELS: Record<string, string> = {
  OPENAI: "OpenAI (ChatGPT)",
  ANTHROPIC: "Anthropic (Claude)",
  GOOGLE: "Google (Gemini)",
};

function formatDate(d: Date): string {
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

export async function sendRetirementNotice(params: {
  to: string;
  userName: string | null;
  provider: string;
  modelName: string;
  info: RetirementInfo;
}) {
  const { to, userName, provider, modelName, info } = params;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.EMAIL_FROM ?? "onboarding@resend.dev";
  const providerLabel = PROVIDER_LABELS[provider] ?? provider;

  await resend.emails.send({
    from,
    to,
    subject: `【提供終了予定】${modelName} の廃止日が公開されました`,
    text: [
      `${userName ?? ""}様`,
      ``,
      `監視中のモデルについて、提供元の公式ページで廃止(提供終了)日が公開されました。`,
      ``,
      `プロバイダー: ${providerLabel}`,
      `モデル: ${modelName}`,
      `提供終了日: ${formatDate(info.date)}`,
      ``,
      `検出元ページ: ${info.sourceUrl}`,
      `検出内容: ${info.snippet}`,
      ``,
      `※ このメールは LLM Retirement Checker により自動送信されています。`,
      `※ 正確な情報は必ず検出元の公式ページでご確認ください。`,
    ].join("\n"),
  });
}
