import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

import { normalizeText } from "../normalize.js";

export interface ExtractedArticle {
  title?: string;
  byline?: string;
  excerpt?: string;
  content: string;
  truncated: boolean;
}

const MAX_STORED_CHARACTERS = 100_000;

export function extractArticle(html: string, url: string): ExtractedArticle {
  const dom = new JSDOM(html, { url });
  const parsed = new Readability(dom.window.document.cloneNode(true) as Document).parse();
  const fallback = dom.window.document.body?.textContent ?? "";
  const fullContent = normalizeText(parsed?.textContent || fallback);
  if (!fullContent) throw new Error("Article body could not be extracted");
  const truncated = fullContent.length > MAX_STORED_CHARACTERS;

  return {
    ...(parsed?.title ? { title: normalizeText(parsed.title) } : {}),
    ...(parsed?.byline ? { byline: normalizeText(parsed.byline) } : {}),
    ...(parsed?.excerpt ? { excerpt: normalizeText(parsed.excerpt) } : {}),
    content: truncated ? fullContent.slice(0, MAX_STORED_CHARACTERS) : fullContent,
    truncated,
  };
}

