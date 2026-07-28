import Link from "next/link";

export const metadata = {
  title: "利用規約 | LLM Retirement Checker",
};

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="mb-6 text-xl font-semibold">利用規約</h1>
        <ol className="list-decimal space-y-4 pl-5 text-sm leading-relaxed">
          <li>本サービスは無料で登録・利用できます。</li>
          <li>
            本サービスが提供する情報は、各社公式ページの自動収集によるものであり、
            正確性・完全性・即時性は保証されません。誤検出・通知漏れなど、
            意図しない結果が生じる可能性があることを前提にご利用ください。
          </li>
          <li>
            本サービスの利用または利用不能により利用者に不利益・損害が生じた場合でも、
            開発者は一切の責任を負いません。
          </li>
          <li>
            本サービスは、予告なく内容の変更・一時停止・終了を行うことがあります。
            これに対する異議申し立てや補償の請求はできません。
          </li>
          <li>
            その他、本サービスに関して、開発者はいかなる責任も負わないものとします。
          </li>
        </ol>
        <p className="mt-6 text-xs text-zinc-500 dark:text-zinc-400">
          登録されたメールアドレスは、本サービスの通知の送信にのみ使用します。
        </p>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          制定日: 2026年7月29日
        </p>
        <p className="mt-6 text-sm">
          <Link href="/register" className="font-medium underline">
            アカウント登録に戻る
          </Link>
        </p>
      </div>
    </main>
  );
}
