import assert from "node:assert/strict";
import test from "node:test";
import {
  DEPRECATION_SOURCES,
  findModelMatches,
  findRetirementInfo,
  findRetirementMatches,
  modelMatches,
} from "../src/lib/scraper.ts";

test("登録モデルそのものを完全一致として検出する", () => {
  assert.deepEqual(findModelMatches("Deprecated: GPT-4o", "gpt-4o"), [
    { matchType: "EXACT", matchedModelName: "GPT-4o" },
  ]);
  assert.equal(modelMatches("Deprecated: GPT-4o", "gpt-4o"), true);
});

test("YYYY-MM-DD付きのモデルを日付付きバージョンとして検出する", () => {
  assert.deepEqual(
    findModelMatches("gpt-4o-2024-11-20", "gpt-4o"),
    [
      {
        matchType: "DATED_VARIANT",
        matchedModelName: "gpt-4o-2024-11-20",
      },
    ]
  );
  assert.equal(modelMatches("gpt-4o-2024-11-20", "gpt-4o"), false);
});

test("YYYYMMDD付きのAnthropicモデルも検出する", () => {
  assert.deepEqual(
    findModelMatches(
      "claude-opus-4-1-20250805",
      "claude-opus-4-1"
    ),
    [
      {
        matchType: "DATED_VARIANT",
        matchedModelName: "claude-opus-4-1-20250805",
      },
    ]
  );
});

test("別の派生モデルや日付のない前方一致は検出しない", () => {
  assert.deepEqual(
    findModelMatches("gpt-4o-mini-2024-07-18", "gpt-4o"),
    []
  );
  assert.deepEqual(findModelMatches("gpt-4o-mini", "gpt-4o"), []);
});

test("スナップショット自体を登録した場合は完全一致になる", () => {
  assert.deepEqual(
    findModelMatches("gpt-4o-2024-11-20", "gpt-4o-2024-11-20"),
    [
      {
        matchType: "EXACT",
        matchedModelName: "gpt-4o-2024-11-20",
      },
    ]
  );
});

test("完全一致と日付付き版を別々の廃止情報として返す", async () => {
  const sourceUrl = DEPRECATION_SOURCES.OPENAI[0];
  const htmlCache = new Map([
    [
      sourceUrl,
      `<table>
        <tr><td>2026-06-01</td><td>gpt-4o</td><td>replacement</td></tr>
        <tr><td>2025-12-01</td><td>gpt-4o-2024-11-20</td><td>replacement</td></tr>
      </table>`,
    ],
  ]);

  const matches = await findRetirementMatches("OPENAI", "gpt-4o", htmlCache);
  assert.deepEqual(
    matches.map(({ matchType, matchedModelName, date }) => ({
      matchType,
      matchedModelName,
      date: date.toISOString(),
    })),
    [
      {
        matchType: "EXACT",
        matchedModelName: "gpt-4o",
        date: "2026-06-01T00:00:00.000Z",
      },
      {
        matchType: "DATED_VARIANT",
        matchedModelName: "gpt-4o-2024-11-20",
        date: "2025-12-01T00:00:00.000Z",
      },
    ]
  );

  const exact = await findRetirementInfo("OPENAI", "gpt-4o", htmlCache);
  assert.equal(exact?.date.toISOString(), "2026-06-01T00:00:00.000Z");
});
