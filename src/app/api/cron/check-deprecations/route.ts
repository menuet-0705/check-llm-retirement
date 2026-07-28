import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEPRECATION_SOURCES, findRetirementInfo } from "@/lib/scraper";
import { sendRetirementNotice } from "@/lib/email";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * 1日1回、外部スケジューラ(GitHub Actions)から呼ばれるエンドポイント。
 * 全ユーザーの監視対象モデルについて公式 Deprecation ページをチェックし、
 * 廃止日が新たに公開(または変更)されたものをメールで通知する。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const models = await prisma.watchedModel.findMany({
    include: { user: { select: { email: true, name: true } } },
  });

  // 同一 Cron 実行内でのページ取得キャッシュ(同じページを何度も叩かない)
  const htmlCache = new Map<string, string | null>();
  const now = new Date();
  let checked = 0;
  let found = 0;
  let notified = 0;
  const errors: string[] = [];

  for (const model of models) {
    checked++;
    try {
      const info = await findRetirementInfo(
        model.provider,
        model.modelName,
        htmlCache
      );

      if (!info) {
        // ページ自体は取得できたのに見つからなくなった場合、過去に検出した
        // 廃止日は古い情報としてクリアする。ただしページの一時的な不調
        // (200 だが中身が壊れている等)で消してしまうと復旧時に同じ通知が
        // 再送されるため、3回連続で見つからなかった場合のみクリアする。
        // 取得失敗時(htmlCache が null)はカウントも進めず保持する。
        const pageFetched = DEPRECATION_SOURCES[model.provider].some((url) =>
          htmlCache.get(url)
        );
        const missCount = pageFetched ? model.missCount + 1 : model.missCount;
        const shouldClear =
          pageFetched && model.retirementDate !== null && missCount >= 3;
        await prisma.watchedModel.update({
          where: { id: model.id },
          data: {
            lastCheckedAt: now,
            missCount,
            ...(shouldClear
              ? {
                  retirementDate: null,
                  sourceUrl: null,
                  snippet: null,
                  notifiedAt: null,
                  missCount: 0,
                }
              : {}),
          },
        });
        continue;
      }

      found++;
      const dateChanged =
        !model.retirementDate ||
        model.retirementDate.getTime() !== info.date.getTime();
      const shouldNotify = !model.notifiedAt || dateChanged;

      if (shouldNotify) {
        await sendRetirementNotice({
          to: model.user.email,
          userName: model.user.name,
          provider: model.provider,
          modelName: model.modelName,
          info,
        });
        notified++;
      }

      await prisma.watchedModel.update({
        where: { id: model.id },
        data: {
          retirementDate: info.date,
          sourceUrl: info.sourceUrl,
          snippet: info.snippet,
          lastCheckedAt: now,
          missCount: 0,
          ...(shouldNotify ? { notifiedAt: now } : {}),
        },
      });
    } catch (e) {
      // 内部エラーの詳細(DB接続情報等が混ざりうる)はログのみに出し、
      // レスポンスには失敗したモデルの識別情報だけを返す
      errors.push(`${model.provider}/${model.modelName}: check failed`);
      console.error(`[cron] check failed for ${model.modelName}`, e);
    }
  }

  return NextResponse.json({ checked, found, notified, errors });
}
