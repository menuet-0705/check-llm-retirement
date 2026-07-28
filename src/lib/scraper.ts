import * as cheerio from "cheerio";
import type { Provider } from "@/generated/prisma/enums";

// 各プロバイダーの公式 Deprecation(廃止予定)情報ページ。
// ページ構成が変わった場合はここの URL を更新する。
export const DEPRECATION_SOURCES: Record<Provider, string[]> = {
  OPENAI: ["https://platform.openai.com/docs/deprecations"],
  ANTHROPIC: [
    "https://platform.claude.com/docs/en/about-claude/model-deprecations",
  ],
  GOOGLE: [
    "https://ai.google.dev/gemini-api/docs/deprecations",
    "https://ai.google.dev/gemini-api/docs/changelog",
  ],
};

export interface RetirementInfo {
  /** 検出した廃止(提供終了)日 */
  date: Date;
  /** 検出元ページの URL */
  sourceUrl: string;
  /** 検出した行のテキスト(通知メールに載せる根拠) */
  snippet: string;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** テキスト中の日付("2025-10-27" / "October 27, 2025" 形式)をすべて抽出する */
export function extractDates(text: string): Date[] {
  const dates: Date[] = [];

  // 前後に数字が続く場合は除外(例: "20250514" の一部を拾わない)
  const iso = text.matchAll(/(?<!\d)(20\d{2})[-/](\d{1,2})[-/](\d{1,2})(?!\d)/g);
  for (const m of iso) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (!isNaN(d.getTime())) dates.push(d);
  }

  // 英語表記。テーブルセルの連結で "RetiredApril 14, 2026June 15, 2026" の
  // ように前後が単語と密着することがあるため、単語境界(\b)は使わない。
  const en = text.matchAll(
    /(January|February|March|April|May|June|July|August|September|October|November|December)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})(?!\d)/gi
  );
  for (const m of en) {
    const month = MONTHS[m[1].toLowerCase()];
    const d = new Date(Date.UTC(Number(m[3]), month - 1, Number(m[2])));
    if (!isNaN(d.getTime())) dates.push(d);
  }

  return dates;
}

/** 日付スナップショット等のサフィックス(-20250514 / -001 / -2024-05-13)か */
const SNAPSHOT_SUFFIX = /^-(?:\d{8}|\d{3}|\d{4}-\d{2}-\d{2})$/;

/**
 * 行テキストに対象モデルが載っているか、トークン単位の完全一致で判定する。
 * 部分一致にしないのは "gemini-2.5-flash" が "gemini-2.5-flash-lite" の行に
 * 誤マッチするのを防ぐため。同一モデルの日付付きスナップショット
 * (例: claude-sonnet-4-5 と claude-sonnet-4-5-20250929)は一致とみなす。
 */
export function modelMatches(text: string, modelName: string): boolean {
  const q = modelName.trim().toLowerCase();
  const qNorm = q.replace(/[^a-z0-9.]/g, "");
  if (!qNorm) return false;

  const tokens = text.toLowerCase().match(/[a-z0-9][a-z0-9.-]*/g) ?? [];
  return tokens.some((raw) => {
    const tok = raw.replace(/[.-]+$/, "");
    if (tok === q) return true;
    // 表記ゆれ(GPT-4o と gpt-4o、区切り文字の違い)を吸収
    if (tok.replace(/[^a-z0-9.]/g, "") === qNorm) return true;
    if (tok.startsWith(q) && SNAPSHOT_SUFFIX.test(tok.slice(q.length))) {
      return true;
    }
    return false;
  });
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; llm-retirement-checker/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      // Next.js の fetch キャッシュを無効化(Cron 実行時は常に最新を取得)
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[scraper] ${url} -> HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    console.warn(`[scraper] fetch failed: ${url}`, e);
    return null;
  }
}

/**
 * HTML からモデル名を含む行(テーブル行・リスト項目・段落)を探し、
 * その行に含まれる日付のうち最も遅いもの(= 提供終了日である可能性が高い)を返す。
 */
function findInHtml(html: string, modelName: string): { date: Date; snippet: string } | null {
  const $ = cheerio.load(html);
  const candidates: { date: Date; snippet: string }[] = [];

  $("tr, li, p").each((_, el) => {
    // テーブル行はセル毎にテキストを取り出して空白で連結する
    // (そのまま .text() するとセル間が密着して日付やモデル名が壊れるため)
    const cells = $(el).children("td, th");
    const text = (
      cells.length > 0
        ? cells.map((_, c) => $(c).text()).get().join(" ")
        : $(el).text()
    )
      .replace(/\s+/g, " ")
      .trim();

    if (!text || text.length > 1000) return;
    if (!modelMatches(text, modelName)) return;

    // Anthropic の "Not sooner than <date>" はアクティブなモデルの
    // 「最短でもこの日までは提供」という表記で、廃止日の公開ではない
    if (/not sooner than/i.test(text)) return;

    // 散文(リスト・段落)はリリース告知等も含むため、廃止系の
    // キーワードを含む場合のみ採用する。専用ページのテーブル行は
    // 行内にキーワードが無いことが多い(日付とモデル名のみ)ので対象外。
    if (
      cells.length === 0 &&
      !/deprecat|shut\s?down|retire|discontinu|remov|sunset/i.test(text)
    ) {
      return;
    }

    const dates = extractDates(text);
    if (dates.length === 0) return;

    // 行内の最も遅い日付を採用(廃止予定日 → 提供終了日の順で並ぶことが多いため)
    const latest = dates.reduce((a, b) => (a > b ? a : b));
    candidates.push({ date: latest, snippet: text.slice(0, 500) });
  });

  if (candidates.length === 0) return null;
  // 複数行にマッチした場合も最も遅い日付を採用
  return candidates.reduce((a, b) => (a.date > b.date ? a : b));
}

/**
 * 指定プロバイダーの公式ページ群からモデルの提供終了日を探す。
 * 見つからなければ null(= まだ廃止日が公開されていない)。
 *
 * htmlCache を渡すと同一 Cron 実行内でページ取得を使い回せる。
 */
export async function findRetirementInfo(
  provider: Provider,
  modelName: string,
  htmlCache?: Map<string, string | null>
): Promise<RetirementInfo | null> {
  for (const url of DEPRECATION_SOURCES[provider]) {
    let html: string | null | undefined = htmlCache?.get(url);
    if (html === undefined) {
      html = await fetchHtml(url);
      htmlCache?.set(url, html);
    }
    if (!html) continue;

    const found = findInHtml(html, modelName);
    if (found) {
      return { ...found, sourceUrl: url };
    }
  }
  return null;
}
