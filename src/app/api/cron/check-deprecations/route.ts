import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findRetirementInfo } from "@/lib/scraper";
import { sendRetirementNotice } from "@/lib/email";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 1日1回 Vercel Cron から呼ばれるエンドポイント。
 * 全ユーザーの監視対象モデルについて公式 Deprecation ページをチェックし、
 * 廃止日が新たに公開(または変更)されたものをメールで通知する。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
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
        await prisma.watchedModel.update({
          where: { id: model.id },
          data: { lastCheckedAt: now },
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
          ...(shouldNotify ? { notifiedAt: now } : {}),
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${model.provider}/${model.modelName}: ${msg}`);
      console.error(`[cron] check failed for ${model.modelName}`, e);
    }
  }

  return NextResponse.json({ checked, found, notified, errors });
}
