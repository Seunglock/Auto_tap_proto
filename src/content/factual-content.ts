import type { ContentFact } from "@/shared/types";
import type { CoreContentResult } from "./core-content";

const RELATION_CUES =
  /(인기|유명|판매|구입|맛볼|즐길|추천|대표|특산|먹거리|쇼핑|입장료|운영\s*시간|위치|명물|볼거리|살\s*수|먹을\s*수|known for|popular|famous|sells?|offers?|located|specialt(?:y|ies)|attraction)/i;
const GENERIC_SUBJECT =
  /^(소개|개요|목차|본문|여행|관광|정보|관련|추천|더보기|overview|introduction|contents?|related|more)$/i;

export function extractFactualContent(
  core: CoreContentResult,
  pageTitle: string,
): ContentFact[] {
  const facts = [
    ...extractStructuredDataFacts(),
    ...extractCardFacts(),
    ...extractSectionFacts(core),
    ...extractFactsFromText(core.bodyText, pageTitle),
  ];
  return dedupeFacts(facts)
    .sort((left, right) => factScore(right, pageTitle) - factScore(left, pageTitle))
    .slice(0, 30);
}

export function summarizeFacts(facts: ContentFact[], maxChars = 1_800): string {
  let output = "";
  for (const fact of facts) {
    const line = `${fact.subject}: ${fact.detail}`;
    if (`${output}\n${line}`.length > maxChars) break;
    output += output ? `\n${line}` : line;
  }
  return output;
}

function extractStructuredDataFacts(): ContentFact[] {
  const facts: ContentFact[] = [];
  document
    .querySelectorAll('script[type="application/ld+json"]')
    .forEach((script) => {
      try {
        walkStructuredValue(JSON.parse(script.textContent ?? ""), facts);
      } catch {
        // Invalid JSON-LD is common and should not block DOM extraction.
      }
    });
  return facts;
}

function walkStructuredValue(value: unknown, facts: ContentFact[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => walkStructuredValue(item, facts));
    return;
  }
  if (!isRecord(value)) return;

  const graph = value["@graph"];
  if (graph) walkStructuredValue(graph, facts);
  const elements = value.itemListElement;
  if (elements) walkStructuredValue(elements, facts);
  if (isRecord(value.item)) walkStructuredValue(value.item, facts);

  const subject = firstString(value.name, value.headline, value.title);
  const schemaType = joinValue(value["@type"]);
  const details = [
    firstString(value.description, value.disambiguatingDescription),
    formatAddress(value.address),
    formatOffers(value.offers),
    formatRating(value.aggregateRating),
    joinValue(value.servesCuisine),
    joinValue(value.openingHours),
    joinValue(value.touristType),
  ].filter(Boolean);

  if (
    subject &&
    details.length > 0 &&
    !/(webpage|website|article|breadcrumblist|searchaction)/i.test(schemaType)
  ) {
    facts.push({
      subject: cleanText(subject).slice(0, 160),
      detail: cleanText(details.join(" | ")).slice(0, 900),
      kind: kindFromSchemaType(schemaType),
      source: "structured-data",
    });
  }
}

function extractCardFacts(): ContentFact[] {
  const facts: ContentFact[] = [];
  const selectors = [
    "article",
    "[class*='card']",
    "[class*='place']",
    "[class*='spot']",
    "[class*='attraction']",
    "[class*='product']",
    "[class*='item']",
    "main li",
    "[role='main'] li",
    "dl",
  ];

  Array.from(document.querySelectorAll(selectors.join(",")))
    .slice(0, 500)
    .forEach((node) => {
      if (node.closest("nav, header, footer, aside, form")) return;
      const subjectNode = node.querySelector("h2, h3, h4, dt, strong, b");
      const subject = cleanText(subjectNode?.textContent ?? "");
      const fullText = cleanText(node.textContent ?? "");
      const detail = cleanText(
        fullText.startsWith(subject) ? fullText.slice(subject.length) : fullText,
      );
      if (
        !isUsefulSubject(subject) ||
        detail.length < 20 ||
        detail.length > 1_200
      )
        return;
      if (getLinkDensity(node) > 0.65) return;
      facts.push({
        subject: subject.slice(0, 160),
        detail: detail.slice(0, 900),
        kind: inferKind(`${subject} ${detail}`),
        source: "content-card",
      });
    });
  return facts;
}

function extractSectionFacts(core: CoreContentResult): ContentFact[] {
  return core.sections
    .filter(
      (section) =>
        isUsefulSubject(section.heading ?? "") && section.text.length >= 30,
    )
    .map((section) => ({
      subject: cleanText(section.heading ?? "").slice(0, 160),
      detail: cleanText(section.text).slice(0, 900),
      kind: inferKind(`${section.heading} ${section.text}`),
      source: "section" as const,
    }));
}

export function extractFactsFromText(
  bodyText: string,
  pageTitle: string,
): ContentFact[] {
  const facts: ContentFact[] = [];
  const sentences = bodyText
    .split(/(?<=[.!?。！？])\s+|\n{2,}/)
    .map(cleanText)
    .filter((sentence) => sentence.length >= 30 && sentence.length <= 500);

  for (const sentence of sentences) {
    if (!RELATION_CUES.test(sentence)) continue;
    const subject =
      sentence.match(/^(.{2,50}?)(?:에서는|에서|에는|은|는|이|가)\s+/)?.[1] ??
      sentence.match(/^([^:：\-–—]{2,80})[:：\-–—]\s*/)?.[1] ??
      pageTitle;
    if (!isUsefulSubject(subject)) continue;
    facts.push({
      subject: cleanText(subject).slice(0, 160),
      detail: sentence.slice(0, 900),
      kind: inferKind(sentence),
      source: "sentence",
    });
  }
  return facts;
}

function formatAddress(value: unknown): string {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";
  return [
    value.addressCountry,
    value.addressRegion,
    value.addressLocality,
    value.streetAddress,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
}

function formatOffers(value: unknown): string {
  const offers = Array.isArray(value) ? value : [value];
  return offers
    .filter(isRecord)
    .map((offer) =>
      [
        firstString(offer.name),
        isRecord(offer.itemOffered)
          ? firstString(offer.itemOffered.name)
          : undefined,
        firstString(offer.price),
        firstString(offer.priceCurrency),
      ]
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean)
    .join(", ");
}

function formatRating(value: unknown): string {
  if (!isRecord(value)) return "";
  const rating = firstString(value.ratingValue);
  const count = firstString(value.ratingCount, value.reviewCount);
  return rating ? `rating ${rating}${count ? ` (${count})` : ""}` : "";
}

function kindFromSchemaType(value: unknown): ContentFact["kind"] {
  const type = joinValue(value).toLowerCase();
  if (/product|offer/.test(type)) return "product";
  if (/event/.test(type)) return "event";
  if (/organization/.test(type)) return "organization";
  if (/place|attraction|restaurant|localbusiness|landmarksorhistoricalbuildings/.test(type))
    return "place";
  return "fact";
}

function inferKind(text: string): ContentFact["kind"] {
  if (/(판매|구입|상품|메뉴|먹거리|특산|shop|store|sell|product|menu)/i.test(text))
    return "product";
  if (/(관광지|명소|공원|시장|신사|사찰|박물관|타워|해변|place|attraction|park|museum|market)/i.test(text))
    return "place";
  if (/(축제|행사|공연|event|festival)/i.test(text)) return "event";
  return "fact";
}

function getLinkDensity(node: Element): number {
  const textLength = cleanText(node.textContent ?? "").length;
  if (textLength === 0) return 0;
  const linkLength = Array.from(node.querySelectorAll("a")).reduce(
    (sum, anchor) => sum + cleanText(anchor.textContent ?? "").length,
    0,
  );
  return linkLength / textLength;
}

function isUsefulSubject(subject: string): boolean {
  const cleaned = cleanText(subject);
  return (
    cleaned.length >= 2 &&
    cleaned.length <= 160 &&
    !GENERIC_SUBJECT.test(cleaned)
  );
}

function dedupeFacts(facts: ContentFact[]): ContentFact[] {
  const seen = new Set<string>();
  const output: ContentFact[] = [];
  for (const fact of facts) {
    const subject = cleanText(fact.subject);
    const detail = cleanText(fact.detail);
    const key = `${subject.toLowerCase()}|${detail.toLowerCase().slice(0, 180)}`;
    if (!subject || detail.length < 20 || seen.has(key)) continue;
    seen.add(key);
    output.push({ ...fact, subject, detail });
  }
  return output;
}

function factScore(fact: ContentFact, pageTitle: string): number {
  let score = 0;
  if (fact.kind === "place" || fact.kind === "product" || fact.kind === "event")
    score += 6;
  if (fact.source === "structured-data") score += 5;
  if (fact.source === "content-card") score += 3;
  if (fact.detail.length >= 40 && fact.detail.length <= 600) score += 2;
  if (fact.detail.length > 850) score -= 2;
  if (cleanText(fact.subject).toLowerCase() === cleanText(pageTitle).toLowerCase())
    score -= 5;
  return score;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" || typeof value === "number")
      return String(value);
  }
  return "";
}

function joinValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(joinValue).filter(Boolean).join(", ");
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "";
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
