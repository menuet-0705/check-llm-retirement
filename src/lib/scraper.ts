import * as cheerio from "cheerio";
import type { Provider } from "@/generated/prisma/enums";

// 各プロバイダーの公式 Deprecation(廃止予定)情報ページ。
// ページ構成が変わった場合はここの URL を更新する。
export const DEPRECATION_SOURCES: Record<Provider, string[]> = {
  OPENAI: ["https://developers.openai.com/api/docs/deprecations"],
  ANTHROPIC: [
    "https://platform.claude.com/docs/en/about-claude/model-deprecations",
  ],
  // changelog はリリース告知と廃止告知が混在していて誤検出のもとになるため、
  // 専用の deprecations ページのみを情報源にする。
  // hl=en は必須: 指定しないと他言語版が返ることがあり、日付が抽出できない
  GOOGLE: ["https://ai.google.dev/gemini-api/docs/deprecations?hl=en"],
};

export interface RetirementInfo {
  /** 検出した廃止(提供終了)日 */
  date: Date;
  /** 検出元ページの URL */
  sourceUrl: string;
  /** 検出した行のテキスト(通知メールに載せる根拠) */
  snippet: string;
}

export interface RetirementMatch extends RetirementInfo {
  /** 登録モデルそのものか、登録モデルの日付付きバージョンか */
  matchType: "EXACT" | "DATED_VARIANT";
  /** 公式ページに記載されていたモデルID */
  matchedModelName: string;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** 実在するUTC日付だけを生成する(Dateによる翌月への自動繰り上がりを防ぐ)。 */
function createUtcDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * テキスト中の日付("2025-10-27" / "2025‑10‑27" /
 * "October 27, 2025" / "Oct 27, 2025"形式)をすべて抽出する。
 */
export function extractDates(text: string): Date[] {
  const dates: Date[] = [];

  // ASCII以外に、公式ページで使われるnon-breaking hyphen等も区切りとして許可する。
  // 前後に数字が続く場合と、直前がハイフンの場合は除外
  // (例: "20250514" の一部や、モデルID "gpt-4o-2024-05-13" 内の日付を拾わない)
  const iso = text.matchAll(
    /(?<![\d\-\u2010-\u2015\u2212])(20\d{2})[\-\/\u2010-\u2015\u2212](\d{1,2})[\-\/\u2010-\u2015\u2212](\d{1,2})(?!\d)/g
  );
  for (const m of iso) {
    const date = createUtcDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (date) dates.push(date);
  }

  // 英語の完全月名と3文字略称に対応する。テーブルセルの連結で
  // "RetiredApril 14, 2026June 15, 2026" の
  // ように前後が単語と密着することがあるため、単語境界(\b)は使わない。
  const en = text.matchAll(
    /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})(?!\d)/gi
  );
  for (const m of en) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    const date = createUtcDate(Number(m[3]), month, Number(m[2]));
    if (date) dates.push(date);
  }

  return dates;
}

/**
 * 行テキストに対象モデルが載っているか、トークン単位の完全一致で判定する。
 * 部分一致にしないのは "gemini-2.5-flash" が "gemini-2.5-flash-lite" の行に
 * 誤マッチするのを防ぐため。日付付きスナップショット
 * (例: gpt-4o に対する gpt-4o-2024-11-20)も別モデルとして扱う。
 * スナップショットを監視したい場合はその名前をそのまま登録する。
 */
export function modelMatches(text: string, modelName: string): boolean {
  return findModelMatches(text, modelName).some(
    (match) => match.matchType === "EXACT"
  );
}

/**
 * 完全一致に加え、登録モデルへ日付だけを付加したスナップショットを検出する。
 * 例: gpt-4o -> gpt-4o-2024-11-20
 *     claude-opus-4-1 -> claude-opus-4-1-20250805
 *
 * gpt-4o-mini-2024-07-18 のように、モデル名と日付の間へ別の名前が
 * 挟まるものは gpt-4o の日付付き版とはみなさない。
 */
export function findModelMatches(
  text: string,
  modelName: string
): Pick<RetirementMatch, "matchType" | "matchedModelName">[] {
  // 末尾の句読点・ハイフンはユーザーの入力ミスとみなして無視する
  const q = modelName.trim().toLowerCase().replace(/[.-]+$/, "");
  const qNorm = q.replace(/[^a-z0-9.]/g, "");
  if (!qNorm) return [];

  const tokens = text.match(/[a-z0-9][a-z0-9.-]*/gi) ?? [];
  const matches = new Map<
    string,
    Pick<RetirementMatch, "matchType" | "matchedModelName">
  >();

  for (const raw of tokens) {
    const matchedModelName = raw.replace(/[.-]+$/, "");
    const tok = matchedModelName.toLowerCase();
    const tokNorm = tok.replace(/[^a-z0-9.]/g, "");

    if (tok === q || tokNorm === qNorm) {
      matches.set(`EXACT:${tok}`, { matchType: "EXACT", matchedModelName });
      continue;
    }

    // OpenAI 等の YYYY-MM-DD と Anthropic の YYYYMMDD に対応する。
    const dated = tok.match(/^(.*)-(20\d{2}-\d{2}-\d{2}|20\d{6})$/);
    if (!dated) continue;

    const baseNorm = dated[1].replace(/[^a-z0-9.]/g, "");
    if (baseNorm === qNorm) {
      matches.set(`DATED_VARIANT:${tok}`, {
        matchType: "DATED_VARIANT",
        matchedModelName,
      });
    }
  }

  return [...matches.values()];
}

// 外部サイトは信頼できない入力として扱う: 応答遅延や巨大レスポンスで
// Cron 実行全体が道連れにならないよう、タイムアウトとサイズ上限を設ける
const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 5 * 1024 * 1024;

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; llm-retirement-checker/1.0)",
        Accept: "text/html,application/xhtml+xml",
        // 日付抽出は英語表記前提のため、必ず英語版ページを要求する
        "Accept-Language": "en",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // Next.js の fetch キャッシュを無効化(Cron 実行時は常に最新を取得)
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[scraper] ${url} -> HTTP ${res.status}`);
      return null;
    }
    const contentLength = Number(res.headers.get("content-length") ?? 0);
    if (contentLength > MAX_HTML_BYTES) {
      console.warn(`[scraper] ${url} -> too large (${contentLength} bytes)`);
      return null;
    }
    const html = await res.text();
    if (html.length > MAX_HTML_BYTES) {
      console.warn(`[scraper] ${url} -> too large (${html.length} chars)`);
      return null;
    }
    return html;
  } catch (e) {
    console.warn(`[scraper] fetch failed: ${url}`, e);
    return null;
  }
}

/**
 * HTML からモデル名を含む行(テーブル行・リスト項目・段落)を探し、
 * その行に含まれる日付のうち最も遅いもの(= 提供終了日である可能性が高い)を返す。
 */
function findInHtml(html: string, modelName: string): RetirementMatch[] {
  const $ = cheerio.load(html);
  const candidates: RetirementMatch[] = [];

  const clean = (s: string) => s.replace(/\s+/g, " ").trim();

  $("tr, li, p").each((_, el) => {
    // テーブル行はセル毎にテキストを取り出して空白で連結する
    // (そのまま .text() するとセル間が密着して日付やモデル名が壊れるため)
    const cells = $(el).children("td, th");
    const cellTexts =
      cells.length > 0 ? cells.map((_, c) => clean($(c).text())).get() : [];
    const text =
      cellTexts.length > 0 ? cellTexts.join(" ") : clean($(el).text());

    if (!text || text.length > 1000) return;

    // 廃止テーブルの最終列は「推奨移行先」であることが多い
    // (例: OpenAI の "2025-06-06 | gpt-4-32k | 価格 | gpt-4o")。
    // 移行先として載っただけのモデルを廃止と誤検出しないよう、
    // 3列以上の行では最終列をモデル名の照合対象から外す。
    const matchTarget =
      cellTexts.length >= 3 ? cellTexts.slice(0, -1).join(" ") : text;
    const modelMatches = findModelMatches(matchTarget, modelName);
    if (modelMatches.length === 0) return;

    // Anthropic の "Not sooner than <date>" はアクティブなモデルの
    // 「最短でもこの日までは提供」という表記で、廃止日の公開ではない
    if (/not sooner than/i.test(text)) return;

    // Google の "No shutdown date announced" 等、廃止日が未発表の行は
    // 対象外(残っている日付はリリース日なので拾ってはいけない)
    if (/no shutdown date|not( yet)?( been)? announced|to be announced/i.test(text)) {
      return;
    }

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
    for (const match of modelMatches) {
      candidates.push({
        ...match,
        date: latest,
        sourceUrl: "",
        snippet: text.slice(0, 500),
      });
    }
  });

  // 同じモデルが散文とテーブルの両方に現れる場合は、最も遅い日付を採用する。
  const unique = new Map<string, RetirementMatch>();
  for (const candidate of candidates) {
    const key = `${candidate.matchType}:${candidate.matchedModelName.toLowerCase()}`;
    const previous = unique.get(key);
    if (!previous || candidate.date > previous.date) unique.set(key, candidate);
  }
  return [...unique.values()];
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
  const matches = await findRetirementMatches(provider, modelName, htmlCache);
  const exact = matches.filter((match) => match.matchType === "EXACT");
  if (exact.length === 0) return null;
  return exact.reduce((a, b) => (a.date > b.date ? a : b));
}

/** 登録モデルの完全一致と、日付付きバージョンの廃止情報をすべて返す。 */
export async function findRetirementMatches(
  provider: Provider,
  modelName: string,
  htmlCache?: Map<string, string | null>
): Promise<RetirementMatch[]> {
  const matches: RetirementMatch[] = [];
  for (const url of DEPRECATION_SOURCES[provider]) {
    let html: string | null | undefined = htmlCache?.get(url);
    if (html === undefined) {
      html = await fetchHtml(url);
      htmlCache?.set(url, html);
    }
    if (!html) continue;

    for (const found of findInHtml(html, modelName)) {
      matches.push({ ...found, sourceUrl: url });
    }
  }

  return matches;
}
