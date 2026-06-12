import type {
  ConversationInsight,
  ConversationTurn,
} from "@/shared/types";

const CONCLUSION_CUE =
  /(결론|핵심|요약|즉,|따라서|그러므로|중요한|정리하면|원인|해결|권장|recommend|conclusion|summary|therefore|because|root cause|solution)/i;
const ACTION_CUE =
  /(해야|하세요|십시오|추가|수정|변경|확인|실행|적용|설치|사용|구현|삭제|저장|검증|다음 단계|todo|should|need to|must|implement|add|remove|update|verify|run|use)/i;
const NOISE_LINE =
  /^(좋은 질문|물론|네[,!.]?|알겠습니다|도움이 되었|참고하세요|추가 질문|더 궁금|let me know|hope this helps|sure[,!.]?)/i;

export function extractConversationInsights(
  turns: ConversationTurn[],
): ConversationInsight[] {
  const pairs = pairConversationTurns(turns);
  return pairs
    .map(({ question, answer }) => buildInsight(question, answer))
    .filter((insight) => insight.answerSummary.length >= 20)
    .slice(-6);
}

export function summarizeConversationInsights(
  insights: ConversationInsight[],
  maxChars = 2_000,
): string {
  const parts: string[] = [];
  for (const insight of insights) {
    const block = [
      `질문: ${insight.question}`,
      `핵심 답변: ${insight.answerSummary}`,
      insight.actionItems?.length
        ? `실행 항목: ${insight.actionItems.join(" / ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (`${parts.join("\n\n")}\n\n${block}`.length > maxChars) break;
    parts.push(block);
  }
  return parts.join("\n\n");
}

function pairConversationTurns(
  turns: ConversationTurn[],
): Array<{ question: string; answer: string }> {
  const pairs: Array<{ question: string; answer: string }> = [];
  let question = "";
  let answers: string[] = [];
  const flush = () => {
    const answer = answers.join("\n").trim();
    if (question && answer) pairs.push({ question, answer });
    answers = [];
  };

  for (const turn of turns) {
    if (turn.role === "user") {
      flush();
      question = cleanText(turn.text);
    } else if (question) {
      answers.push(turn.text);
    }
  }
  flush();
  return pairs;
}

function buildInsight(question: string, answer: string): ConversationInsight {
  const units = splitMeaningfulUnits(answer);
  if (units.length === 0 && cleanText(answer).length >= 20) {
    units.push(excerpt(answer, 500));
  }
  const questionTerms = new Set(
    question
      .toLowerCase()
      .split(/[\s\p{P}\p{S}]+/u)
      .filter((word) => word.length >= 2),
  );
  const scored = units
    .map((text, index) => ({
      text,
      score: scoreUnit(text, index, questionTerms),
    }))
    .sort((left, right) => right.score - left.score);
  const keyPoints = dedupeSimilar(scored.map((item) => item.text)).slice(0, 5);
  const actionItems = dedupeSimilar(
    units.filter((unit) => ACTION_CUE.test(unit)),
  ).slice(0, 4);
  const answerSummary = keyPoints.slice(0, 3).join(" ").slice(0, 900);

  return {
    question: excerpt(question, 300),
    answerSummary,
    keyPoints,
    actionItems: actionItems.length > 0 ? actionItems : undefined,
  };
}

function splitMeaningfulUnits(answer: string): string[] {
  return answer
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\n+|(?<=[.!?。！？])\s+/)
    .map((line) =>
      cleanText(line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")),
    )
    .flatMap(chunkLongUnit)
    .filter(
      (line) =>
        line.length >= 20 &&
        !NOISE_LINE.test(line) &&
        !/^(user|assistant|you|ai)\s*:/i.test(line),
    );
}

function chunkLongUnit(value: string): string[] {
  if (value.length <= 500) return [value];
  const chunks: string[] = [];
  for (let start = 0; start < value.length; start += 420) {
    chunks.push(value.slice(start, start + 500).trim());
  }
  return chunks;
}

function scoreUnit(
  text: string,
  index: number,
  questionTerms: Set<string>,
): number {
  let score = Math.max(0, 3 - index * 0.25);
  if (CONCLUSION_CUE.test(text)) score += 6;
  if (ACTION_CUE.test(text)) score += 3;
  if (text.length >= 40 && text.length <= 260) score += 2;
  const lower = text.toLowerCase();
  score += [...questionTerms].filter((word) => lower.includes(word)).length * 1.5;
  return score;
}

function dedupeSimilar(values: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "").slice(0, 160);
    if (!key || seen.has(key)) continue;
    if (output.some((item) => item.includes(value) || value.includes(item)))
      continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function excerpt(value: string, maxChars: number): string {
  const cleaned = cleanText(value);
  return cleaned.length <= maxChars ? cleaned : `${cleaned.slice(0, maxChars)}…`;
}

function cleanText(value: string): string {
  return value.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
