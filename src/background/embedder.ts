import { pipeline, env } from "@huggingface/transformers";
import { E5_PASSAGE_PREFIX, MAX_INPUT_CHARS } from "@/shared/constants";
import { isSearchEngineHost } from "@/shared/site-detection";

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = "Xenova/multilingual-e5-small";

type Extractor = (
  text: string,
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array }>;

let extractorPromise: Promise<Extractor> | null = null;

function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL_ID, {
      dtype: "fp32",
    }) as unknown as Promise<Extractor>;
  }
  return extractorPromise;
}

export async function warmupEmbedder(): Promise<void> {
  await getExtractor();
}

export function buildPassageText(
  title: string,
  url: string,
  contentSnippet: string,
): string {
  const domain = safeDomain(url);
  const cleanTitle = (title ?? "").replace(/\s+/g, " ").trim();
  const cleanSnippet = (contentSnippet ?? "").replace(/\s+/g, " ").trim();
  const titleWeighted = cleanTitle ? `${cleanTitle}. ${cleanTitle}.` : "";
  const includeDomain = domain.length > 0 && !isSearchEngineHost(domain);
  const combined = [titleWeighted, includeDomain ? domain : "", cleanSnippet]
    .filter((s) => s.length > 0)
    .join(" | ")
    .trim();
  const trimmed = combined.slice(0, MAX_INPUT_CHARS);
  return E5_PASSAGE_PREFIX + trimmed;
}

export async function embedText(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

export function l2Normalize(vec: number[]): number[] {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum);
  if (norm === 0) return vec.slice();
  return vec.map((v) => v / norm);
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
