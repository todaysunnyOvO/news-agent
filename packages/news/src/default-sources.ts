import type { RssSource } from "./providers/rss-provider.js";

export const defaultRssSources: RssSource[] = [
  {
    id: "openai-news",
    name: "OpenAI News",
    url: "https://openai.com/news/rss.xml",
    language: "en",
  },
  {
    id: "google-ai",
    name: "Google AI",
    url: "https://blog.google/technology/ai/rss/",
    language: "en",
  },
  {
    id: "techcrunch-ai",
    name: "TechCrunch AI",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
    language: "en",
  },
];

