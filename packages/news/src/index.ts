export { defaultRssSources } from "./default-sources.js";
export {
  deduplicateArticles,
  findRelatedArticles,
  titleSimilarity,
} from "./deduplicate.js";
export { extractArticle, type ExtractedArticle } from "./extractors/article-extractor.js";
export { clusterNewsEvents, semanticSimilarity, type NewsEventCluster } from "./event-clustering.js";
export { NewsService } from "./news-service.js";
export { fetchSafeText } from "./network/safe-fetch.js";
export {
  canonicalizeUrl,
  createArticleId,
  hashContent,
  normalizeArticle,
  normalizeText,
  normalizeTitle,
} from "./normalize.js";
export { MockNewsProvider, type MockProviderFixture } from "./providers/mock-provider.js";
export type { NewsProvider } from "./providers/provider.js";
export { RssNewsProvider, type FetchText, type RssSource } from "./providers/rss-provider.js";
export { TavilyNewsProvider, type TavilyFetch } from "./providers/tavily-provider.js";
