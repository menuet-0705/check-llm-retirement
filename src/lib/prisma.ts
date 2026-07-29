import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL が設定されていません (.env を確認してサーバーを再起動してください)"
    );
  }
  // 接続文字列の ?schema= は Prisma 独自パラメータで、Prisma 7 のランタイム
  // (pg ドライバー)はそのままでは解釈しない。ここで取り出してアダプターの
  // schema オプションとして渡すことで、CLI と同じスキーマを参照させる。
  // URL 形式でない接続文字列は schema なしとして扱い、pg 側の判断に委ねる
  // (new URL の例外は接続文字列全体=認証情報をエラーに含むため投げさせない)。
  const schema = URL.canParse(url)
    ? new URL(url).searchParams.get("schema") ?? undefined
    : undefined;
  const adapter = new PrismaPg(
    { connectionString: url },
    schema ? { schema } : undefined
  );
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
