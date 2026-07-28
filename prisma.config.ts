import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // CLI (migrate / db push) は直接接続を使う。
    // Supabase の場合、DIRECT_URL にはポート 5432 の直接接続文字列を設定する。
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"]!,
  },
});
