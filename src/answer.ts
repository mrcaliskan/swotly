/* Forgiving answer matching:
   - case/punctuation/whitespace insensitive
   - contractions expanded both ways (I'd == I would)
   - tiny typo tolerance (edit distance 1 on longer answers) */

const CONTRACTIONS: [RegExp, string][] = [
  [/\bi'm\b/g, "i am"], [/\bcan't\b/g, "cannot"], [/\bwon't\b/g, "will not"],
  [/\bshan't\b/g, "shall not"], [/\bn't\b/g, " not"],
  [/\b(\w+)'re\b/g, "$1 are"], [/\b(\w+)'ve\b/g, "$1 have"],
  [/\b(\w+)'ll\b/g, "$1 will"], [/\b(\w+)'d\b/g, "$1 would"],
  [/\bit's\b/g, "it is"], [/\bthat's\b/g, "that is"], [/\bwhat's\b/g, "what is"],
  [/\bthere's\b/g, "there is"], [/\bhe's\b/g, "he is"], [/\bshe's\b/g, "she is"],
  [/\blet's\b/g, "let us"],
];

export function normalise(s: string): string {
  let t = s.toLowerCase().trim()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"');
  for (const [re, sub] of CONTRACTIONS) t = t.replace(re, sub);
  return t
    .replace(/[.,!?;:'"()\-—–]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
  return dp[a.length][b.length];
}

export type Verdict = "correct" | "close" | "wrong";

export function checkAnswer(given: string, expected: string): Verdict {
  const g = normalise(given), e = normalise(expected);
  if (!g) return "wrong";
  if (g === e) return "correct";
  if (e.length >= 5 && editDistance(g, e) === 1) return "close";
  return "wrong";
}

/* "fix" exercises ask for just the corrected word(s), but generation
   sometimes pads the stored answer with one unchanged word from either
   side of the sentence (e.g. "have been able" when the actual fix is only
   "have been") — accept the learner's answer if it's exactly one word
   short of the stored one at either end, so a grammatically complete
   correction isn't marked wrong over a generation quirk. */
export function checkFixAnswer(given: string, expected: string): Verdict {
  const base = checkAnswer(given, expected);
  if (base === "correct") return base;
  const g = normalise(given), e = normalise(expected);
  if (!g) return base;
  const ew = e.split(" ");
  if (ew.length - g.split(" ").length === 1) {
    if (ew.slice(0, -1).join(" ") === g || ew.slice(1).join(" ") === g) return "correct";
  }
  return base;
}
