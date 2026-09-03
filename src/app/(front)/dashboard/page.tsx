import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEPRECATION_SOURCES } from "@/lib/scraper";
import { addWatchedModel, deleteWatchedModel, logout } from "./actions";

const PROVIDER_LABELS: Record<string, string> = {
  OPENAI: "OpenAI (ChatGPT)",
  ANTHROPIC: "Anthropic (Claude)",
  GOOGLE: "Google (Gemini)",
};

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const models = await prisma.watchedModel.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">LLM Retirement Checker</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {session.user.email} でログイン中
          </p>
        </div>
        <form action={logout}>
          <button className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
            ログアウト
          </button>
        </form>
      </header>

      <section className="mb-8 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-base font-semibold">監視するモデルを追加</h2>
        <form action={addWatchedModel} className="flex flex-col gap-3 sm:flex-row">
          <select
            name="provider"
            required
            className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="OPENAI">OpenAI (ChatGPT)</option>
            <option value="ANTHROPIC">Anthropic (Claude)</option>
            <option value="GOOGLE">Google (Gemini)</option>
          </select>
          <input
            name="modelName"
            required
            placeholder="例: gpt-4o-2024-11-20, claude-opus-4-1-20250805, gemini-2.5-flash"
            className="flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            追加
          </button>
        </form>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          各社の公式 Deprecation ページを1日1回チェックし、提供終了日が公開されたらメールで通知します。
          完全一致したモデルは提供終了日を表示し、日付付き版(例: gpt-4o に対する
          gpt-4o-2024-11-20)が一致した場合はメールのみでお知らせします。
        </p>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="border-b border-zinc-200 px-6 py-4 text-base font-semibold dark:border-zinc-800">
          監視中のモデル({models.length})
        </h2>
        {models.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            まだモデルが登録されていません
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {models.map((m) => (
              <li key={m.id} className="flex items-center gap-4 px-6 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.modelName}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {PROVIDER_LABELS[m.provider] ?? m.provider}
                    {" ・ 最終チェック: "}
                    {formatDate(m.lastCheckedAt)}
                  </p>
                  <a
                    href={m.sourceUrl ?? DEPRECATION_SOURCES[m.provider][0]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    公式の根拠ページを確認
                  </a>
                  {m.snippet && (
                    <p className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {m.snippet}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  {m.retirementDate ? (
                    <span className="inline-block rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                      提供終了日 {formatDate(m.retirementDate)}
                    </span>
                  ) : (
                    <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      廃止日未公開
                    </span>
                  )}
                </div>
                <form action={deleteWatchedModel}>
                  <input type="hidden" name="id" value={m.id} />
                  <button
                    className="text-sm text-zinc-400 hover:text-red-600"
                    title="削除"
                  >
                    削除
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
