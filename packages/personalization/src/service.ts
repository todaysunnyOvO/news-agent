import {
  FeedbackRepository,
  InferredPreferenceRepository,
  LibraryRepository,
  SubscriptionRepository,
  type NewsDatabase,
} from "@news-agent/db";
import type { NewsArticle, PersonalizationProfile } from "@news-agent/shared";

import { aggregateSignals, summarizeNegativeSignals, type PersonalizationSignal } from "./aggregator.js";
import { rankCandidates, type CandidateScore } from "./scorer.js";

export class PersonalizationService {
  private readonly feedback: FeedbackRepository;
  private readonly inferred: InferredPreferenceRepository;
  private readonly library: LibraryRepository;
  private readonly subscriptions: SubscriptionRepository;

  public constructor(private readonly db: NewsDatabase) {
    this.feedback = new FeedbackRepository(db);
    this.inferred = new InferredPreferenceRepository(db);
    this.library = new LibraryRepository(db);
    this.subscriptions = new SubscriptionRepository(db);
  }

  public refresh(userId: string, now = new Date()): PersonalizationProfile {
    const subscription = this.subscriptions.findByUserId(userId);
    if (!subscription) throw new Error("User subscription preferences were not found");
    const signals = this.collectSignals(userId);
    for (const suggestion of aggregateSignals(signals, now)) {
      this.inferred.upsertSuggestion(userId, suggestion);
    }
    return {
      enabled: subscription.personalizationEnabled,
      inferredPreferences: this.inferred.listByUserId(userId, now),
      recentNegativeSignals: summarizeNegativeSignals(signals, now),
      trackedTopics: this.library.listTrackedTopics(userId).filter((topic) => topic.status === "active"),
    };
  }

  public rank(userId: string, articles: NewsArticle[], now = new Date()): CandidateScore[] {
    const subscription = this.subscriptions.findByUserId(userId);
    if (!subscription) throw new Error("User subscription preferences were not found");
    const profile = this.refresh(userId, now);
    return rankCandidates(
      articles,
      subscription,
      profile.inferredPreferences.filter((preference) => preference.status === "accepted"),
      now,
    );
  }

  private collectSignals(userId: string): PersonalizationSignal[] {
    const feedbackSignals: PersonalizationSignal[] = this.feedback.listActiveSignals(userId).map((signal) => ({
      id: signal.id,
      source: "feedback",
      topic: signal.topic,
      sourceNames: signal.sourceNames,
      feedbackType: signal.feedbackType,
      occurredAt: signal.occurredAt,
    }));
    const savedSignals: PersonalizationSignal[] = this.library.listSavedItems(userId).map((item) => ({
      id: item.id,
      source: "saved",
      topic: item.topic,
      sourceNames: [],
      occurredAt: item.savedAt,
    }));
    const trackingSignals: PersonalizationSignal[] = this.library.listTrackedTopics(userId)
      .filter((topic) => topic.status === "active")
      .map((topic) => ({
        id: topic.id,
        source: "tracked",
        topic: topic.query.topic,
        sourceNames: [],
        occurredAt: topic.updatedAt,
      }));
    return [...feedbackSignals, ...savedSignals, ...trackingSignals];
  }
}
