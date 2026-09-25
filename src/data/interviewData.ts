export interface RequirementItem {
  id: string;
  text: string;
  category: "functional" | "non-functional";
  importance: "critical" | "important" | "nice-to-have";
}

export interface FollowUpQuestion {
  id: string;
  question: string;
  category: "failure" | "scale" | "consistency" | "security" | "optimization";
  hint: string;
  answer: string;
}

export interface ReferenceAPI {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  description: string;
  requestBody?: string;
  response?: string;
}

export interface DataModelEntity {
  name: string;
  type: "sql" | "nosql" | "cache" | "search";
  fields: { name: string; type: string; note?: string }[];
  indexes?: string[];
  partitionKey?: string;
}

export interface ProblemInterviewData {
  problemId: string;
  requirements: RequirementItem[];
  followUpQuestions: FollowUpQuestion[];
  referenceAPIs: ReferenceAPI[];
  dataModel: DataModelEntity[];
  estimationHints: {
    dailyActiveUsers: string;
    readWriteRatio: string;
    storagePerItem: string;
    peakMultiplier: string;
  };
}

export const INTERVIEW_DATA: ProblemInterviewData[] = [
  // ─────────────────────────────────────────────────────────────────────────────
  // 1. URL SHORTENER
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "url-shortener",
    requirements: [
      {
        id: "r1",
        text: "Create short URL from long URL",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Redirect short URL to original URL",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Custom alias support (user-chosen slugs)",
        category: "functional",
        importance: "nice-to-have",
      },
      {
        id: "r4",
        text: "URL expiration with configurable TTL",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Click analytics (count, geo, referrer, device)",
        category: "functional",
        importance: "nice-to-have",
      },
      {
        id: "r6",
        text: "100:1 read-to-write ratio",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r7",
        text: "< 100ms redirect latency at p99",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "99.99% availability (52 min downtime/year)",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Short URLs should be 7-8 characters (base62)",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "What happens if your cache goes down?",
        category: "failure",
        hint: "Think about cache-aside pattern",
        answer:
          "With cache-aside, requests fall through to the database. Latency increases but the system remains functional. We can use Redis Cluster with replicas for cache HA.",
      },
      {
        id: "q2",
        question: "How do you handle hash collisions when generating short URLs?",
        category: "consistency",
        hint: "Consider pre-generated keys or collision detection",
        answer:
          "Use a Key Generation Service (KGS) that pre-generates unique keys and stores them in a 'unused keys' table. On URL creation, atomically move a key from unused to used, eliminating collisions entirely.",
      },
      {
        id: "q3",
        question: "How would you scale to 10x the current traffic?",
        category: "scale",
        hint: "Think about database sharding and cache layers",
        answer:
          "Add more cache replicas (Redis Cluster), shard the database by short URL hash across multiple nodes, and use a CDN for 301 redirects on popular URLs to bypass the app layer entirely.",
      },
      {
        id: "q4",
        question: "How do you prevent abuse (spam URLs, phishing)?",
        category: "security",
        hint: "Rate limiting + URL scanning",
        answer:
          "Apply per-API-key rate limits (e.g., 100 creates/min). Scan destination URLs against phishing/malware databases (Google Safe Browsing API) before creating the short URL. Flag suspicious patterns for manual review.",
      },
      {
        id: "q5",
        question: "Should redirects be 301 or 302?",
        category: "optimization",
        hint: "Think about caching implications",
        answer:
          "Use 302 (temporary) if you need analytics on every click, since browsers won't cache it. Use 301 (permanent) if you want browsers and CDNs to cache the redirect, reducing server load but losing per-click analytics.",
      },
      {
        id: "q6",
        question: "How do you handle expired URLs?",
        category: "consistency",
        hint: "Lazy deletion vs background cleanup",
        answer:
          "Use lazy deletion: check TTL on read and return 404 if expired. Run a background job to purge expired entries from the database periodically to reclaim storage and free up short codes for reuse.",
      },
    ],
    referenceAPIs: [
      {
        method: "POST",
        path: "/api/v1/urls",
        description: "Create a new short URL",
        requestBody: "{ longUrl: string, customAlias?: string, expiresAt?: ISO8601 }",
        response: "{ shortUrl: string, shortCode: string, expiresAt: string }",
      },
      {
        method: "GET",
        path: "/{shortCode}",
        description: "Redirect to original URL (302/301)",
        response: "HTTP 302 redirect with Location header",
      },
      {
        method: "GET",
        path: "/api/v1/urls/{shortCode}",
        description: "Get URL metadata and analytics",
        response: "{ shortCode, longUrl, createdAt, expiresAt, clickCount }",
      },
      {
        method: "DELETE",
        path: "/api/v1/urls/{shortCode}",
        description: "Delete/deactivate a short URL",
        response: "{ success: boolean }",
      },
    ],
    dataModel: [
      {
        name: "urls",
        type: "nosql",
        fields: [
          { name: "short_code", type: "string", note: "Primary key, 7-char base62" },
          { name: "long_url", type: "string", note: "Original destination URL" },
          { name: "user_id", type: "string", note: "Creator's user ID" },
          { name: "created_at", type: "datetime" },
          { name: "expires_at", type: "datetime", note: "TTL for auto-expiration" },
          { name: "click_count", type: "int", note: "Atomic counter" },
        ],
        partitionKey: "short_code",
      },
      {
        name: "analytics_events",
        type: "nosql",
        fields: [
          { name: "short_code", type: "string" },
          { name: "timestamp", type: "datetime" },
          { name: "ip", type: "string" },
          { name: "country", type: "string" },
          { name: "referrer", type: "string" },
          { name: "user_agent", type: "string" },
        ],
        partitionKey: "short_code",
      },
      {
        name: "url_cache",
        type: "cache",
        fields: [
          { name: "short_code", type: "string", note: "Cache key" },
          { name: "long_url", type: "string", note: "Cached destination" },
        ],
      },
    ],
    estimationHints: {
      dailyActiveUsers: "100M DAU, each triggering ~1 redirect/day = 100M reads/day",
      readWriteRatio: "100:1 reads:writes — ~1K writes/sec, ~100K reads/sec at peak (with caching)",
      storagePerItem:
        "~500 bytes per URL record; 1K new URLs/sec = 86M/day = ~43 GB/day ≈ 15.7 TB/year ≈ 75 TB over 5 years",
      peakMultiplier: "3x average during business hours (US + EU overlap)",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. TWITTER / NEWS FEED
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "twitter-feed",
    requirements: [
      {
        id: "r1",
        text: "Post tweets (text up to 280 chars, images, video)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "View personalized home timeline",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Follow/unfollow other users",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Like, retweet, quote-tweet, and reply",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Full-text search across all public tweets",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Trending topics and hashtag aggregation",
        category: "functional",
        importance: "nice-to-have",
      },
      {
        id: "r7",
        text: "Timeline eventually consistent within 5 seconds",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Feed load latency < 200ms at p99",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Handle celebrity accounts with 50M+ followers",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r10",
        text: "Graceful degradation: serve stale timelines during overload",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How do you handle fan-out for a user with 50 million followers?",
        category: "scale",
        hint: "Think hybrid: fan-out-on-write vs fan-out-on-read",
        answer:
          "Use a hybrid approach. For normal users (< 10K followers), fan-out-on-write: push the tweet to each follower's cached timeline. For celebrities, fan-out-on-read: merge their tweets into the timeline at read time. This prevents write amplification storms.",
      },
      {
        id: "q2",
        question: "What happens if a timeline cache node goes down?",
        category: "failure",
        hint: "Consider cache rebuilding strategies",
        answer:
          "Each user's timeline cache has a replica. On primary failure, promote the replica. If both fail, rebuild the timeline from the database by querying tweets from followed users, sorted by time. Serve a stale CDN-cached version while rebuilding.",
      },
      {
        id: "q3",
        question: "How do you rank tweets in the timeline?",
        category: "optimization",
        hint: "Think about ML ranking signals",
        answer:
          "Score each candidate tweet using signals: recency, engagement velocity (likes/retweets in first hour), relationship strength (interaction history with author), content-type preference, and explicit user feedback. A lightweight ML model scores and re-ranks the top 1000 candidates.",
      },
      {
        id: "q4",
        question: "How do you prevent fake accounts from manipulating trending topics?",
        category: "security",
        hint: "Bot detection and weighted signals",
        answer:
          "Weight trending topic signals by account age, verification status, and behavioral patterns. Use velocity-based anomaly detection: if a hashtag spikes from accounts created within 24 hours, flag it. Apply CAPTCHA challenges on suspicious engagement patterns.",
      },
      {
        id: "q5",
        question: "How would you implement real-time notifications for mentions?",
        category: "scale",
        hint: "Think about push vs pull",
        answer:
          "When a tweet is posted, a mentions extractor parses @handles and pushes notification events to a message queue. A notification service consumes these events and delivers them via WebSocket to online users or stores them for offline users.",
      },
      {
        id: "q6",
        question: "How do you handle tweet deletion across all fan-out copies?",
        category: "consistency",
        hint: "Tombstones vs eventual cleanup",
        answer:
          "Mark the tweet as deleted in the primary store (soft delete). For fan-out-on-write timelines, either send a delete event through the same pipeline to remove from caches, or let it be filtered at read time. Eventual consistency is acceptable here.",
      },
    ],
    referenceAPIs: [
      {
        method: "POST",
        path: "/api/v1/tweets",
        description: "Create a new tweet",
        requestBody: "{ text: string, mediaIds?: string[], replyToId?: string }",
        response: "{ tweetId, text, createdAt, author }",
      },
      {
        method: "GET",
        path: "/api/v1/timeline",
        description: "Get authenticated user's home timeline",
        response: "{ tweets: Tweet[], nextCursor: string }",
      },
      {
        method: "GET",
        path: "/api/v1/users/{userId}/tweets",
        description: "Get a user's profile tweets",
        response: "{ tweets: Tweet[], nextCursor: string }",
      },
      {
        method: "POST",
        path: "/api/v1/users/{userId}/follow",
        description: "Follow a user",
        response: "{ success: boolean }",
      },
      {
        method: "GET",
        path: "/api/v1/search?q={query}",
        description: "Search tweets",
        response: "{ tweets: Tweet[], nextCursor: string }",
      },
    ],
    dataModel: [
      {
        name: "tweets",
        type: "nosql",
        fields: [
          { name: "tweet_id", type: "snowflake_id", note: "Time-sortable unique ID" },
          { name: "user_id", type: "string" },
          { name: "text", type: "string", note: "Max 280 chars" },
          { name: "media_urls", type: "string[]" },
          { name: "reply_to_id", type: "string", note: "Null if top-level tweet" },
          { name: "retweet_of_id", type: "string" },
          { name: "like_count", type: "int" },
          { name: "retweet_count", type: "int" },
          { name: "created_at", type: "datetime" },
        ],
        partitionKey: "user_id",
        indexes: ["tweet_id", "created_at"],
      },
      {
        name: "user_timeline_cache",
        type: "cache",
        fields: [
          { name: "user_id", type: "string", note: "Cache key" },
          { name: "tweet_ids", type: "string[]", note: "Ordered list of tweet IDs, max 800" },
        ],
      },
      {
        name: "followers",
        type: "nosql",
        fields: [
          { name: "user_id", type: "string" },
          { name: "follower_id", type: "string" },
          { name: "followed_at", type: "datetime" },
        ],
        partitionKey: "user_id",
      },
      {
        name: "tweets_search",
        type: "search",
        fields: [
          { name: "tweet_id", type: "string" },
          { name: "text", type: "text", note: "Full-text indexed" },
          { name: "user_id", type: "keyword" },
          { name: "hashtags", type: "keyword[]" },
          { name: "created_at", type: "date" },
        ],
      },
    ],
    estimationHints: {
      dailyActiveUsers:
        "250M DAU, average user reads ~200 tweets/day = 50B tweet reads/day (~600K reads/sec)",
      readWriteRatio:
        "100:1 reads:writes — 500M tweets/day ≈ 6K writes/sec vs ~600K timeline reads/sec",
      storagePerItem: "~1 KB per tweet (text + metadata); 500M tweets/day = 500 GB/day raw",
      peakMultiplier: "5x during major events (elections, Super Bowl, breaking news)",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. CHAT SYSTEM
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "chat-system",
    requirements: [
      {
        id: "r1",
        text: "Send and receive 1:1 messages in real time",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Group chats with up to 1000 members",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Offline message delivery (store-and-forward)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Read receipts (delivered, read indicators)",
        category: "functional",
        importance: "important",
      },
      { id: "r5", text: "Typing indicators", category: "functional", importance: "nice-to-have" },
      {
        id: "r6",
        text: "Online/offline presence status",
        category: "functional",
        importance: "important",
      },
      {
        id: "r7",
        text: "Message delivery latency < 50ms for online users",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Guaranteed message ordering within a conversation",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Multi-device sync across all logged-in devices",
        category: "non-functional",
        importance: "important",
      },
      {
        id: "r10",
        text: "End-to-end encryption for 1:1 chats",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How do you guarantee message ordering in a group chat?",
        category: "consistency",
        hint: "Think about per-conversation sequence numbers",
        answer:
          "Assign a monotonically increasing sequence number per conversation. The server assigns sequence numbers atomically using a Redis INCR or database sequence. Clients use sequence numbers to detect gaps and request missing messages.",
      },
      {
        id: "q2",
        question: "How do you handle a WebSocket gateway server going down?",
        category: "failure",
        hint: "Connection-to-server mapping + reconnect",
        answer:
          "Store connection-to-gateway mapping in Redis. When a gateway dies, clients detect the broken connection and reconnect to another gateway via the load balancer. Undelivered messages are stored in the database and synced on reconnect using the client's last-seen sequence number.",
      },
      {
        id: "q3",
        question: "How does the system handle a group with 1000 members?",
        category: "scale",
        hint: "Fan-out strategy for large groups",
        answer:
          "For large groups, fan-out through a message queue. The message is written once to the conversation store, then a fan-out worker sends it to each online member's WebSocket gateway. Offline members receive it on next sync. This avoids 1000 synchronous writes.",
      },
      {
        id: "q4",
        question: "How do you implement end-to-end encryption?",
        category: "security",
        hint: "Signal Protocol / Double Ratchet",
        answer:
          "Use the Signal Protocol (Double Ratchet algorithm). Clients exchange public keys during initial setup. Each message is encrypted client-side before sending; the server only sees ciphertext. Key rotation happens with each message exchange for forward secrecy.",
      },
      {
        id: "q5",
        question: "How do you avoid overwhelming the server with typing indicators?",
        category: "optimization",
        hint: "Ephemeral events, throttling",
        answer:
          "Typing indicators are ephemeral: send via WebSocket only (no database writes). Throttle to one event per 3 seconds per user per conversation. Auto-expire after 5 seconds of no typing. For large groups, only send to the most recent N active participants.",
      },
      {
        id: "q6",
        question: "How do you implement presence (online/offline)?",
        category: "scale",
        hint: "Heartbeats + TTL keys",
        answer:
          "Each connected client sends a heartbeat every 30 seconds. The WebSocket gateway updates a Redis key with TTL of 60 seconds. If the key expires, the user is considered offline. Presence changes are broadcast to the user's contact list via pub/sub, with fan-out limited to contacts currently online.",
      },
    ],
    referenceAPIs: [
      {
        method: "POST",
        path: "/api/v1/messages",
        description: "Send a message to a conversation",
        requestBody: "{ conversationId: string, content: string, type: 'text'|'image'|'file' }",
        response: "{ messageId, sequenceNumber, timestamp }",
      },
      {
        method: "GET",
        path: "/api/v1/conversations/{conversationId}/messages",
        description: "Fetch message history (paginated)",
        response: "{ messages: Message[], hasMore: boolean }",
      },
      {
        method: "POST",
        path: "/api/v1/conversations",
        description: "Create a new conversation (1:1 or group)",
        requestBody: "{ participantIds: string[], name?: string, type: '1:1'|'group' }",
        response: "{ conversationId, participants, createdAt }",
      },
      {
        method: "PUT",
        path: "/api/v1/messages/{messageId}/read",
        description: "Mark message as read",
        response: "{ success: boolean }",
      },
      {
        method: "GET",
        path: "/api/v1/conversations",
        description: "List user's conversations",
        response: "{ conversations: Conversation[], nextCursor: string }",
      },
    ],
    dataModel: [
      {
        name: "messages",
        type: "nosql",
        fields: [
          { name: "conversation_id", type: "string" },
          { name: "sequence_number", type: "bigint", note: "Per-conversation monotonic counter" },
          { name: "sender_id", type: "string" },
          { name: "content", type: "string", note: "Encrypted ciphertext for E2E chats" },
          { name: "type", type: "enum", note: "text, image, file, system" },
          { name: "created_at", type: "datetime" },
        ],
        partitionKey: "conversation_id",
        indexes: ["sequence_number"],
      },
      {
        name: "conversations",
        type: "nosql",
        fields: [
          { name: "conversation_id", type: "string" },
          { name: "type", type: "enum", note: "1:1 or group" },
          { name: "participant_ids", type: "string[]" },
          { name: "name", type: "string", note: "Group name, null for 1:1" },
          { name: "last_message_at", type: "datetime" },
          { name: "last_message_preview", type: "string" },
        ],
        partitionKey: "conversation_id",
      },
      {
        name: "presence_cache",
        type: "cache",
        fields: [
          { name: "user_id", type: "string", note: "Key with TTL of 60s" },
          { name: "status", type: "enum", note: "online, away, offline" },
          { name: "last_active_at", type: "datetime" },
          {
            name: "gateway_server_id",
            type: "string",
            note: "Which WS gateway holds this connection",
          },
        ],
      },
    ],
    estimationHints: {
      dailyActiveUsers: "200M DAU, average 40 messages sent/day per user = 8B messages/day",
      readWriteRatio:
        "≈2:1 reads:writes — every sent message is read at least once, and group fan-out plus multi-device sync push reads above writes",
      storagePerItem: "~200 bytes per message; 8B messages/day = 1.6 TB/day",
      peakMultiplier: "2x average during evening hours (6-10 PM local time)",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. RIDE SHARING
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "ride-sharing",
    requirements: [
      {
        id: "r1",
        text: "Request a ride from current location to destination",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Match riders with nearby available drivers",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Real-time location tracking during trip",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "ETA calculation using real-time traffic data",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Dynamic surge pricing based on supply/demand",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Trip history and receipts",
        category: "functional",
        importance: "important",
      },
      {
        id: "r7",
        text: "Driver matching within 5 seconds",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Handle 1M+ concurrent driver location updates (every 4 seconds)",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Payment processing with idempotent charges",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r10",
        text: "Graceful handling of disconnections mid-trip",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How do you efficiently find nearby drivers?",
        category: "optimization",
        hint: "Think about geospatial indexing (geohash, S2 cells)",
        answer:
          "Use geohashing to convert lat/lng to a string prefix. Store driver locations in Redis using GEOADD. Find nearby drivers with GEOSEARCH (the modern replacement for the deprecated GEORADIUS) in O(log N + M) time where M is results returned. Partition by geohash prefix so each shard covers a geographic region.",
      },
      {
        id: "q2",
        question: "What happens if a driver's app crashes mid-trip?",
        category: "failure",
        hint: "Heartbeats and trip state persistence",
        answer:
          "The server detects missing heartbeats after 30 seconds and marks the driver as disconnected. Trip state is persisted in the database so it survives app crashes. When the driver reconnects, the app resumes the trip from the last known state. If the driver doesn't reconnect within 5 minutes, reassign the rider.",
      },
      {
        id: "q3",
        question: "How do you prevent double-charging riders?",
        category: "consistency",
        hint: "Idempotency keys",
        answer:
          "Every charge request includes an idempotency key (trip_id). The payment service checks if a charge with that key already exists before processing. If it does, return the existing result. Store idempotency keys with outcomes for at least 24 hours.",
      },
      {
        id: "q4",
        question: "How do you handle surge pricing fairly?",
        category: "scale",
        hint: "Think about geo-zone based pricing",
        answer:
          "Divide the city into hexagonal geo-zones. Compute supply/demand ratio per zone every 30 seconds using streaming data. Lock the surge multiplier at the time of ride request so it doesn't change during the booking flow. Display the fare estimate before the rider confirms.",
      },
      {
        id: "q5",
        question: "How do you handle the thundering herd when a popular event ends?",
        category: "scale",
        hint: "Virtual queue + graduated dispatch",
        answer:
          "When a geo-zone sees a sudden spike in requests (e.g., concert ending), activate a virtual queue. Process ride requests in batches, prioritizing by wait time. Dynamically expand the search radius for available drivers. Send push notifications to nearby off-duty drivers to incentivize coming online.",
      },
      {
        id: "q6",
        question: "How do you ensure rider safety?",
        category: "security",
        hint: "Identity verification, trip sharing, emergency features",
        answer:
          "Verify driver identity via background checks and periodic selfie verification. Share live trip details with trusted contacts. Implement an SOS button that records audio and shares live location with safety team. Log all driver locations for audit purposes.",
      },
    ],
    referenceAPIs: [
      {
        method: "POST",
        path: "/api/v1/rides",
        description: "Request a new ride",
        requestBody: "{ pickupLat, pickupLng, destLat, destLng, rideType: 'standard'|'premium' }",
        response: "{ rideId, estimatedFare, surgeMultiplier, estimatedPickupETA }",
      },
      {
        method: "PUT",
        path: "/api/v1/drivers/{driverId}/location",
        description: "Update driver location (called every 4s)",
        requestBody: "{ lat: number, lng: number, heading: number, speed: number }",
        response: "{ success: boolean }",
      },
      {
        method: "GET",
        path: "/api/v1/rides/{rideId}",
        description: "Get ride details and live tracking",
        response: "{ rideId, status, driverLocation, eta, fare }",
      },
      {
        method: "POST",
        path: "/api/v1/rides/{rideId}/complete",
        description: "Complete the ride and trigger payment",
        response: "{ finalFare, paymentStatus, receiptUrl }",
      },
      {
        method: "GET",
        path: "/api/v1/rides/estimate",
        description: "Get fare estimate before requesting",
        response: "{ estimatedFare, surgeMultiplier, estimatedPickupTime }",
      },
    ],
    dataModel: [
      {
        name: "rides",
        type: "sql",
        fields: [
          { name: "ride_id", type: "uuid" },
          { name: "rider_id", type: "string" },
          { name: "driver_id", type: "string" },
          {
            name: "status",
            type: "enum",
            note: "requested, matched, in_progress, completed, cancelled",
          },
          { name: "pickup_lat", type: "decimal" },
          { name: "pickup_lng", type: "decimal" },
          { name: "dest_lat", type: "decimal" },
          { name: "dest_lng", type: "decimal" },
          { name: "fare", type: "decimal" },
          { name: "surge_multiplier", type: "decimal" },
          { name: "started_at", type: "datetime" },
          { name: "completed_at", type: "datetime" },
        ],
        indexes: ["rider_id", "driver_id", "status", "created_at"],
      },
      {
        name: "driver_locations",
        type: "cache",
        fields: [
          { name: "driver_id", type: "string" },
          { name: "lat", type: "decimal" },
          { name: "lng", type: "decimal" },
          { name: "geohash", type: "string", note: "For GEOSEARCH queries" },
          { name: "status", type: "enum", note: "available, on_trip, offline" },
          { name: "updated_at", type: "datetime" },
        ],
      },
      {
        name: "trip_location_log",
        type: "nosql",
        fields: [
          { name: "ride_id", type: "string" },
          { name: "timestamp", type: "datetime" },
          { name: "lat", type: "decimal" },
          { name: "lng", type: "decimal" },
          { name: "speed", type: "decimal" },
        ],
        partitionKey: "ride_id",
      },
    ],
    estimationHints: {
      dailyActiveUsers: "50M DAU (riders + drivers), ~20M rides/day",
      readWriteRatio:
        "1:3 reads:writes (write-heavy) — location updates dominate (1M drivers × every 4s = 250K writes/sec)",
      storagePerItem:
        "~500 bytes per ride record; location log ~100 bytes per point, ~600 points per 30-min ride",
      peakMultiplier: "4x during rush hours (8-9 AM, 5-7 PM) and event endings",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. VIDEO STREAMING
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "video-streaming",
    requirements: [
      {
        id: "r1",
        text: "Upload videos with resumable upload support",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Transcode videos into multiple resolutions and codecs",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Adaptive bitrate streaming (HLS/DASH)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Video search by title, description, tags",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Personalized recommendations",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Comments, likes, and subscriptions",
        category: "functional",
        importance: "important",
      },
      {
        id: "r7",
        text: "< 1s video start time at p95",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Global delivery via CDN with edge caching",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Support live streaming with < 5s glass-to-glass latency",
        category: "non-functional",
        importance: "nice-to-have",
      },
      {
        id: "r10",
        text: "Copyright detection before video goes live",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How do you handle a viral video that suddenly gets millions of views?",
        category: "scale",
        hint: "CDN cache warming and origin shielding",
        answer:
          "CDN edge nodes cache the video segments on first access. For viral content, proactively push the video to edge nodes in high-traffic regions (cache warming). Use origin shielding — a mid-tier CDN cache between edge and origin — to prevent thundering herd on the origin storage.",
      },
      {
        id: "q2",
        question: "What happens if transcoding fails halfway through?",
        category: "failure",
        hint: "Checkpointing and retry",
        answer:
          "Implement checkpoint-based transcoding: save progress after each segment is transcoded. On failure, retry from the last checkpoint rather than restarting. Use a dead letter queue for videos that fail repeatedly, flagging them for manual investigation.",
      },
      {
        id: "q3",
        question: "How do you minimize storage costs for billions of videos?",
        category: "optimization",
        hint: "Tiered storage based on access patterns",
        answer:
          "Use tiered storage: hot (SSD + CDN) for videos < 30 days old or frequently accessed, warm (standard S3) for moderate access, cold (S3 Glacier) for rarely accessed old videos. Automatic tiering based on view count and recency saves 60-70% on storage costs.",
      },
      {
        id: "q4",
        question: "How does adaptive bitrate streaming work?",
        category: "optimization",
        hint: "Manifest files + segment-based delivery",
        answer:
          "The video is transcoded into segments (2-10 seconds each) at multiple quality levels. A manifest file (M3U8 for HLS) lists all available qualities and segment URLs. The client player monitors bandwidth and buffer levels, dynamically switching quality levels between segments for smooth playback.",
      },
      {
        id: "q5",
        question: "How do you prevent unauthorized content downloads?",
        category: "security",
        hint: "Signed URLs and DRM",
        answer:
          "Use signed URLs with short TTLs for CDN access, so URLs expire after a few hours. For premium content, implement DRM (Widevine/FairPlay) which encrypts video segments and requires a license server handshake before playback. Token-based authentication prevents URL sharing.",
      },
      {
        id: "q6",
        question: "How do you handle the upload of a 100GB video over unreliable networks?",
        category: "failure",
        hint: "Chunked resumable uploads",
        answer:
          "Split the upload into chunks (5-10 MB each). Track uploaded chunks server-side. On network failure, the client queries which chunks are complete and resumes from the last incomplete chunk. Use content hashing per chunk to verify integrity. Google's resumable upload protocol is the industry standard.",
      },
    ],
    referenceAPIs: [
      {
        method: "POST",
        path: "/api/v1/videos/upload",
        description: "Initiate a resumable video upload",
        requestBody: "{ title, description, tags, fileSize, mimeType }",
        response: "{ uploadId, uploadUrl, chunkSize }",
      },
      {
        method: "PUT",
        path: "/api/v1/videos/upload/{uploadId}",
        description: "Upload a chunk of the video",
        requestBody: "Binary chunk data with Content-Range header",
        response: "{ bytesReceived, complete: boolean }",
      },
      {
        method: "GET",
        path: "/api/v1/videos/{videoId}",
        description: "Get video metadata and playback URLs",
        response: "{ videoId, title, manifestUrl, thumbnailUrl, viewCount }",
      },
      {
        method: "GET",
        path: "/api/v1/feed",
        description: "Get personalized video recommendations",
        response: "{ videos: Video[], nextPageToken: string }",
      },
      {
        method: "GET",
        path: "/api/v1/search?q={query}",
        description: "Search videos",
        response: "{ videos: Video[], totalResults: number }",
      },
    ],
    dataModel: [
      {
        name: "videos",
        type: "sql",
        fields: [
          { name: "video_id", type: "uuid" },
          { name: "uploader_id", type: "string" },
          { name: "title", type: "string" },
          { name: "description", type: "text" },
          { name: "status", type: "enum", note: "uploading, transcoding, published, removed" },
          { name: "duration_seconds", type: "int" },
          { name: "view_count", type: "bigint" },
          { name: "like_count", type: "int" },
          { name: "manifest_url", type: "string", note: "HLS/DASH manifest location" },
          { name: "created_at", type: "datetime" },
        ],
        indexes: ["uploader_id", "status", "created_at"],
      },
      {
        name: "video_segments",
        type: "nosql",
        fields: [
          { name: "video_id", type: "string" },
          { name: "quality", type: "string", note: "360p, 720p, 1080p, 4K" },
          { name: "segment_index", type: "int" },
          { name: "storage_url", type: "string", note: "S3 path to segment file" },
          { name: "duration_ms", type: "int" },
          { name: "byte_size", type: "int" },
        ],
        partitionKey: "video_id",
      },
      {
        name: "video_search",
        type: "search",
        fields: [
          { name: "video_id", type: "string" },
          { name: "title", type: "text" },
          { name: "description", type: "text" },
          { name: "tags", type: "keyword[]" },
          { name: "category", type: "keyword" },
          { name: "upload_date", type: "date" },
          { name: "view_count", type: "long", note: "For popularity boosting in search ranking" },
        ],
      },
    ],
    estimationHints: {
      dailyActiveUsers: "1B DAU, ~5 videos watched per session = 5B views/day",
      readWriteRatio: "1000:1 reads:writes — 5B views/day vs ~5M uploads/day",
      storagePerItem:
        "Average video: 300 MB original, ~1.5 GB across all quality levels; 5M uploads/day = 7.5 PB/day",
      peakMultiplier: "3x average during evening hours globally (staggered by timezone)",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. RATE LIMITER
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "rate-limiter",
    requirements: [
      {
        id: "r1",
        text: "Limit requests per client/IP/API key within a time window",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Support multiple algorithms (token bucket, sliding window, fixed window)",
        category: "functional",
        importance: "important",
      },
      {
        id: "r3",
        text: "Return HTTP 429 with Retry-After header when limit exceeded",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Return remaining quota in response headers (X-RateLimit-*)",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Configurable rules per endpoint, per client tier",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Support burst allowance above sustained rate",
        category: "functional",
        importance: "nice-to-have",
      },
      {
        id: "r7",
        text: "Sub-millisecond decision latency",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Distributed counting consistent across all instances",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Configurable fail-open vs fail-closed when Redis is unavailable",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "What happens when your Redis rate-limit store goes down?",
        category: "failure",
        hint: "Fail-open vs fail-closed tradeoff",
        answer:
          "Configurable per rule. For most APIs, fail-open (allow traffic through) to maintain availability. For sensitive endpoints (login, payments), fail-closed or fall back to local in-memory rate limiting with higher thresholds. Use Redis Cluster with replicas for HA.",
      },
      {
        id: "q2",
        question: "How do you handle rate limiting across multiple data centers?",
        category: "scale",
        hint: "Local + global counters",
        answer:
          "Use a two-tier approach: local rate limits enforced per data center for low latency, plus a global limit synced via async replication between data center Redis instances. Accept slight over-counting (e.g., allow 105% of the limit globally) in exchange for eliminating cross-DC latency from the request path.",
      },
      {
        id: "q3",
        question: "What's the tradeoff between fixed window and sliding window?",
        category: "optimization",
        hint: "Accuracy vs memory/compute cost",
        answer:
          "Fixed window is simplest (single counter per window) but allows 2x burst at window boundaries. Sliding window log is most accurate but uses O(N) memory per key. Sliding window counter is the sweet spot: uses two fixed window counters with weighted overlap, giving near-accurate results with O(1) memory.",
      },
      {
        id: "q4",
        question: "How do you prevent a sophisticated attacker from bypassing rate limits?",
        category: "security",
        hint: "Multiple layers of identification",
        answer:
          "Layer multiple identifiers: IP address, API key, user ID, device fingerprint, and session token. Apply limits at each layer independently. Use behavioral analysis to detect distributed attacks from botnets that rotate IPs. Implement CAPTCHA challenges for suspicious traffic patterns.",
      },
      {
        id: "q5",
        question: "How do you handle rate limiting for WebSocket connections?",
        category: "optimization",
        hint: "Message rate vs connection rate",
        answer:
          "Limit both connection establishment rate (per IP) and message rate per connection. Use a token bucket per WebSocket connection that refills at the allowed message rate. Disconnect clients that exceed limits. This prevents a single connection from flooding the server with messages.",
      },
    ],
    referenceAPIs: [
      {
        method: "POST",
        path: "/api/v1/rate-limit/check",
        description: "Check if a request should be allowed",
        requestBody: "{ clientId: string, endpoint: string, weight?: number }",
        response: "{ allowed: boolean, remaining: number, retryAfterMs?: number }",
      },
      {
        method: "GET",
        path: "/api/v1/rate-limit/rules",
        description: "Get all configured rate limit rules",
        response: "{ rules: Rule[] }",
      },
      {
        method: "PUT",
        path: "/api/v1/rate-limit/rules/{ruleId}",
        description: "Update a rate limit rule",
        requestBody: "{ maxRequests: number, windowSizeMs: number, algorithm: string }",
        response: "{ rule: Rule }",
      },
    ],
    dataModel: [
      {
        name: "rate_limit_counters",
        type: "cache",
        fields: [
          { name: "key", type: "string", note: "Format: {clientId}:{endpoint}:{window}" },
          { name: "count", type: "int", note: "Atomic counter via INCR" },
          { name: "ttl", type: "int", note: "Auto-expire with window size" },
        ],
      },
      {
        name: "rate_limit_rules",
        type: "sql",
        fields: [
          { name: "rule_id", type: "uuid" },
          { name: "endpoint_pattern", type: "string", note: "Glob or regex for endpoint matching" },
          { name: "client_tier", type: "string", note: "free, pro, enterprise" },
          { name: "max_requests", type: "int" },
          { name: "window_size_ms", type: "int" },
          { name: "algorithm", type: "enum", note: "token_bucket, sliding_window, fixed_window" },
          { name: "burst_allowance", type: "int", note: "Extra tokens above sustained rate" },
          { name: "fail_strategy", type: "enum", note: "open or closed" },
        ],
        indexes: ["endpoint_pattern", "client_tier"],
      },
    ],
    estimationHints: {
      dailyActiveUsers:
        "50M DAU generating API requests; rate limiter itself handles 50K+ checks/sec",
      readWriteRatio:
        "1:1 reads:writes — every check is both a read (check counter) and write (increment counter)",
      storagePerItem: "~100 bytes per counter key in Redis; 10M active keys = ~1 GB",
      peakMultiplier: "10x during traffic spikes or DDoS attempts",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. NOTIFICATION SYSTEM
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "notification-system",
    requirements: [
      {
        id: "r1",
        text: "Send push notifications (iOS/Android/Web)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Send email notifications",
        category: "functional",
        importance: "critical",
      },
      { id: "r3", text: "Send SMS notifications", category: "functional", importance: "important" },
      {
        id: "r4",
        text: "Template engine with variable substitution and localization",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Priority-based routing (critical > marketing)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r6",
        text: "Per-user notification preferences and opt-out",
        category: "functional",
        importance: "important",
      },
      {
        id: "r7",
        text: "Delivery tracking with status (sent, delivered, read, bounced)",
        category: "functional",
        importance: "important",
      },
      {
        id: "r8",
        text: "At-least-once delivery with deduplication",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Rate limiting per provider to avoid throttling by APNS/FCM/email gateways",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r10",
        text: "Process 100K+ notifications per second",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How do you prevent duplicate notifications to the same user?",
        category: "consistency",
        hint: "Deduplication keys",
        answer:
          "Generate a deduplication key per notification (hash of user_id + event_type + event_id). Store recent dedup keys in Redis with a TTL (e.g., 24 hours). Before sending, check if the key exists. This prevents retries or duplicate events from sending the same notification twice.",
      },
      {
        id: "q2",
        question: "How do you handle a downstream provider (e.g., APNS) being down?",
        category: "failure",
        hint: "Circuit breaker + retry with backoff",
        answer:
          "Implement a circuit breaker per provider. When failure rate exceeds a threshold, open the circuit and queue messages for retry. Use exponential backoff with jitter for retries. Optionally fall back to an alternative channel (e.g., if push fails, try email) based on notification criticality.",
      },
      {
        id: "q3",
        question: "How do you handle sending a notification to 10 million users at once?",
        category: "scale",
        hint: "Segmented fan-out with backpressure",
        answer:
          "Don't fan out all 10M at once. Segment users into batches (e.g., 10K per batch). Push batches to the message queue with rate limiting. Workers process batches, respecting per-provider rate limits (APNS allows ~10K/sec per connection). Use multiple connections and throttle to stay within provider limits.",
      },
      {
        id: "q4",
        question: "How do you ensure critical alerts aren't delayed by marketing notifications?",
        category: "optimization",
        hint: "Priority queues or separate lanes",
        answer:
          "Use separate message queues (or priority lanes within a queue) for different priority levels: critical (security alerts, payment confirmations), standard (social notifications), and marketing (promotions). Critical queue workers always run at capacity; marketing workers are throttled and can be paused during system stress.",
      },
      {
        id: "q5",
        question: "How do you handle unsubscribes and compliance (GDPR, CAN-SPAM)?",
        category: "security",
        hint: "Preference service as a central gate",
        answer:
          "Every notification must pass through a Preference Service that checks: user opt-in status per channel and category, legal unsubscribes, quiet hours, and frequency caps. Store preferences in a cache for fast lookup. Provide one-click unsubscribe links in every email (legally required). Log all consent changes for audit.",
      },
      {
        id: "q6",
        question: "How do you handle device token invalidation?",
        category: "failure",
        hint: "Feedback from push providers",
        answer:
          "APNS and FCM return feedback on invalid tokens (device uninstalled app, token expired). Process this feedback asynchronously: remove invalid tokens from the device registry, and update user preference to prevent future delivery attempts to dead endpoints. Run periodic token validation sweeps.",
      },
    ],
    referenceAPIs: [
      {
        method: "POST",
        path: "/api/v1/notifications",
        description: "Send a notification",
        requestBody:
          "{ userId: string, templateId: string, variables: object, channels: string[], priority: 'critical'|'standard'|'marketing' }",
        response: "{ notificationId, status }",
      },
      {
        method: "POST",
        path: "/api/v1/notifications/bulk",
        description: "Send notification to a segment of users",
        requestBody:
          "{ segmentQuery: object, templateId: string, variables: object, channels: string[] }",
        response: "{ batchId, estimatedRecipients: number }",
      },
      {
        method: "GET",
        path: "/api/v1/notifications/{notificationId}/status",
        description: "Get delivery status of a notification",
        response: "{ notificationId, channel, status, deliveredAt, readAt }",
      },
      {
        method: "PUT",
        path: "/api/v1/users/{userId}/preferences",
        description: "Update notification preferences",
        requestBody: "{ email: boolean, push: boolean, sms: boolean, categories: object }",
        response: "{ preferences: Preferences }",
      },
    ],
    dataModel: [
      {
        name: "notifications",
        type: "nosql",
        fields: [
          { name: "notification_id", type: "uuid" },
          { name: "user_id", type: "string" },
          { name: "template_id", type: "string" },
          { name: "channel", type: "enum", note: "push, email, sms" },
          { name: "priority", type: "enum", note: "critical, standard, marketing" },
          { name: "status", type: "enum", note: "pending, sent, delivered, read, failed, bounced" },
          { name: "rendered_content", type: "string" },
          { name: "created_at", type: "datetime" },
          { name: "sent_at", type: "datetime" },
        ],
        partitionKey: "user_id",
        indexes: ["status", "created_at"],
      },
      {
        name: "templates",
        type: "sql",
        fields: [
          { name: "template_id", type: "string" },
          { name: "name", type: "string" },
          { name: "channel", type: "enum" },
          { name: "locale", type: "string", note: "e.g., en-US, ja-JP" },
          { name: "subject", type: "string", note: "For email" },
          { name: "body_template", type: "text", note: "Handlebars/Mustache template" },
          { name: "version", type: "int" },
        ],
        indexes: ["name", "channel", "locale"],
      },
      {
        name: "user_preferences",
        type: "cache",
        fields: [
          { name: "user_id", type: "string" },
          { name: "email_enabled", type: "boolean" },
          { name: "push_enabled", type: "boolean" },
          { name: "sms_enabled", type: "boolean" },
          { name: "category_preferences", type: "json", note: "Per-category opt-in/out" },
          { name: "quiet_hours", type: "json", note: "Timezone-aware quiet hours" },
        ],
      },
      {
        name: "device_tokens",
        type: "nosql",
        fields: [
          { name: "user_id", type: "string" },
          { name: "device_id", type: "string" },
          { name: "platform", type: "enum", note: "ios, android, web" },
          { name: "token", type: "string", note: "APNS/FCM token" },
          { name: "is_active", type: "boolean" },
          { name: "last_validated_at", type: "datetime" },
        ],
        partitionKey: "user_id",
      },
    ],
    estimationHints: {
      dailyActiveUsers: "500M DAU, average 5 notifications/day per user = 2.5B notifications/day",
      readWriteRatio:
        "1:10 reads:writes (write-heavy) — mostly writes (sending) with some reads (status checks)",
      storagePerItem: "~500 bytes per notification record; 2.5B/day = ~1.25 TB/day",
      peakMultiplier: "10x during marketing campaigns or breaking news alerts",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. TYPEAHEAD / AUTOCOMPLETE
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "typeahead-autocomplete",
    requirements: [
      {
        id: "r1",
        text: "Return top 5-10 suggestions as user types each character",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Rank suggestions by popularity, recency, and personalization",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Support prefix matching (starts-with queries)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Fuzzy matching to handle typos (edit distance <= 2)",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Real-time trend updates (breaking news within minutes)",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Filter offensive/inappropriate suggestions",
        category: "functional",
        importance: "important",
      },
      {
        id: "r7",
        text: "Response time < 50ms at p99",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Multi-language support with Unicode and transliteration",
        category: "non-functional",
        importance: "nice-to-have",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How do you keep suggestions fresh as trends change?",
        category: "optimization",
        hint: "Offline pipeline + real-time overlay",
        answer:
          "Run an offline pipeline every 15 minutes that aggregates search logs, computes new frequency rankings, and rebuilds the trie. For real-time trends (breaking news), maintain a separate hot-trends overlay in Redis that is updated in real-time from a streaming pipeline. Merge results from both at query time.",
      },
      {
        id: "q2",
        question: "How do you handle the load of every keystroke triggering a request?",
        category: "scale",
        hint: "Client-side debouncing + CDN caching",
        answer:
          "Client-side: debounce requests (wait 100-200ms after last keystroke before sending). Cache short prefixes (1-2 chars) aggressively at the CDN since they're common and stable. Server-side: cache popular prefix results in Redis. The top 10K prefixes account for the vast majority of queries.",
      },
      {
        id: "q3",
        question: "What data structure do you use for prefix matching?",
        category: "optimization",
        hint: "Trie with top-K at each node",
        answer:
          "Use a trie (prefix tree) where each node stores the top-K (e.g., 10) suggestions for that prefix, pre-computed by the offline pipeline. This allows O(L) lookup where L is the prefix length, and avoids traversing the entire subtree at query time. Serialize the trie for fast loading into memory.",
      },
      {
        id: "q4",
        question: "How do you implement personalized suggestions?",
        category: "optimization",
        hint: "Per-user history + blending",
        answer:
          "Store each user's recent search history (last 100 queries) in a user-specific cache. At query time, blend generic top-K results with the user's matching history. Weight recent personal searches higher. This can be done client-side by merging two result sets to avoid personalizing at the server for every request.",
      },
      {
        id: "q5",
        question: "How do you prevent showing offensive autocomplete suggestions?",
        category: "security",
        hint: "Blocklist + ML classifier",
        answer:
          "Maintain a blocklist of offensive terms and patterns. Run new suggestion candidates through an ML classifier before adding them to the trie. Additionally, filter at query time against the blocklist. Implement a feedback loop where users can report offensive suggestions for removal.",
      },
      {
        id: "q6",
        question: "What if a trie node becomes a hot key in your cache?",
        category: "scale",
        hint: "Replicate hot prefixes",
        answer:
          "Short prefixes (1-2 chars) are naturally hot. Replicate them across all app server instances in local memory. For mid-length prefixes that become hot (trending topics), detect via sampling and replicate to multiple Redis shards with random suffix in the key, then load-balance reads across replicas.",
      },
    ],
    referenceAPIs: [
      {
        method: "GET",
        path: "/api/v1/suggestions?q={prefix}&limit={n}",
        description: "Get autocomplete suggestions for a prefix",
        response:
          "{ suggestions: [{ text: string, score: number, type: 'trending'|'personal'|'popular' }] }",
      },
      {
        method: "POST",
        path: "/api/v1/search/log",
        description: "Log a completed search (for ranking updates)",
        requestBody: "{ query: string, userId?: string, resultClicked?: string }",
        response: "{ success: boolean }",
      },
      {
        method: "GET",
        path: "/api/v1/trending",
        description: "Get current trending searches",
        response: "{ trending: [{ query: string, volume: number, trend: 'rising'|'stable' }] }",
      },
    ],
    dataModel: [
      {
        name: "trie_nodes",
        type: "cache",
        fields: [
          { name: "prefix", type: "string", note: "Trie node key" },
          {
            name: "top_suggestions",
            type: "json",
            note: "Pre-computed top-K suggestions with scores",
          },
          { name: "updated_at", type: "datetime" },
        ],
      },
      {
        name: "search_logs",
        type: "nosql",
        fields: [
          { name: "query", type: "string" },
          { name: "user_id", type: "string" },
          { name: "timestamp", type: "datetime" },
          { name: "result_clicked", type: "string" },
          { name: "session_id", type: "string" },
        ],
        partitionKey: "query",
      },
      {
        name: "suggestion_index",
        type: "search",
        fields: [
          { name: "phrase", type: "text", note: "Completion text, indexed as edge-ngrams" },
          { name: "frequency", type: "long" },
          { name: "category", type: "keyword" },
          { name: "language", type: "keyword" },
          { name: "last_searched", type: "date" },
        ],
      },
    ],
    estimationHints: {
      dailyActiveUsers:
        "~8.5B searches/day (~100K avg search QPS); ~4 keystrokes per search = ~400K suggestion QPS",
      readWriteRatio:
        "1000:1 reads:writes — overwhelmingly reads (suggestions) vs writes (search logs)",
      storagePerItem: "~200 bytes per suggestion entry; 100M unique suggestions = ~20 GB trie data",
      peakMultiplier: "5x during breaking news events",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. WEB CRAWLER
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "web-crawler",
    requirements: [
      {
        id: "r1",
        text: "Crawl web pages starting from seed URLs",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Extract links and add new URLs to the frontier",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Respect robots.txt and per-domain crawl delays",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Deduplicate URLs and near-duplicate content",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Store crawled page content for indexing",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Priority-based URL frontier (important pages first)",
        category: "functional",
        importance: "important",
      },
      {
        id: "r7",
        text: "Crawl rate of 1000+ pages per second across the cluster",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Incremental re-crawling based on page change frequency",
        category: "non-functional",
        importance: "important",
      },
      {
        id: "r9",
        text: "Handle spider traps, redirect loops, and soft 404s",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How do you avoid overwhelming a single website?",
        category: "optimization",
        hint: "Per-domain rate limiting + politeness delay",
        answer:
          "Implement per-domain rate limits in Redis. Before fetching a URL, check the domain's last crawl timestamp. Enforce a minimum delay between requests to the same domain (typically 1-5 seconds, or as specified in robots.txt Crawl-delay). Partition URLs by domain in the back queue to enable per-domain throttling.",
      },
      {
        id: "q2",
        question: "How do you detect and avoid spider traps?",
        category: "failure",
        hint: "URL depth limits, pattern detection",
        answer:
          "Set a maximum URL depth (e.g., 15 levels from the seed). Detect repeating URL patterns (e.g., calendar pages generating infinite date URLs). Limit the number of pages crawled per domain per cycle. Use URL normalization to collapse equivalent URLs. Set a per-page crawl timeout to avoid hanging on slow-loading traps.",
      },
      {
        id: "q3",
        question: "How do you deduplicate content efficiently?",
        category: "optimization",
        hint: "SimHash for near-duplicate detection",
        answer:
          "For exact URL dedup, use a Bloom filter (space-efficient, allows false positives but not false negatives). For content dedup, compute SimHash of page content — two pages with SimHash Hamming distance < 3 are near-duplicates. Store SimHash fingerprints in a lookup table for O(1) comparison.",
      },
      {
        id: "q4",
        question: "How do you prioritize which URLs to crawl first?",
        category: "scale",
        hint: "Multi-signal scoring",
        answer:
          "Score URLs by: PageRank (link authority), freshness (time since last crawl), change frequency (how often the page has historically changed), and depth from seed (shallower = higher priority). Use a priority queue with these scores. Re-crawl news sites hourly, blogs weekly, and static pages monthly.",
      },
      {
        id: "q5",
        question: "How do you coordinate multiple crawler workers?",
        category: "scale",
        hint: "Domain-partitioned queues",
        answer:
          "Use a URL frontier with two layers: front queues (priority-based) feed into back queues (one per domain). Workers pull from back queues to ensure per-domain politeness. Use consistent hashing to assign domains to workers, so each worker is responsible for a set of domains. This prevents multiple workers from hammering the same site.",
      },
      {
        id: "q6",
        question: "How do you handle pages that require JavaScript rendering?",
        category: "optimization",
        hint: "Headless browser rendering pipeline",
        answer:
          "Use a two-pass approach: first crawl with a fast HTTP client for static HTML pages (90%+ of the web). For JavaScript-heavy pages, queue them for a headless browser pool (Puppeteer/Playwright). The browser pool is expensive, so limit it to domains known to require JS rendering and cache the rendered HTML.",
      },
    ],
    referenceAPIs: [
      {
        method: "POST",
        path: "/api/v1/crawl/seed",
        description: "Add seed URLs to the frontier",
        requestBody: "{ urls: string[], priority: number }",
        response: "{ accepted: number, duplicates: number }",
      },
      {
        method: "GET",
        path: "/api/v1/crawl/status",
        description: "Get crawler status and statistics",
        response: "{ pagesPerSec, totalCrawled, frontierSize, activeWorkers }",
      },
      {
        method: "GET",
        path: "/api/v1/pages/{urlHash}",
        description: "Get crawled page content and metadata",
        response: "{ url, htmlContent, statusCode, crawledAt, contentHash }",
      },
      {
        method: "PUT",
        path: "/api/v1/crawl/config",
        description: "Update crawl configuration",
        requestBody: "{ maxDepth, defaultDelay, maxPagesPerDomain, allowedDomains? }",
        response: "{ config: Config }",
      },
    ],
    dataModel: [
      {
        name: "crawl_frontier",
        type: "nosql",
        fields: [
          { name: "url_hash", type: "string", note: "SHA-256 of normalized URL" },
          { name: "url", type: "string" },
          { name: "domain", type: "string" },
          { name: "priority", type: "float" },
          { name: "depth", type: "int" },
          { name: "last_crawled_at", type: "datetime" },
          { name: "next_crawl_after", type: "datetime" },
          { name: "status", type: "enum", note: "pending, in_progress, completed, failed" },
        ],
        partitionKey: "domain",
        indexes: ["priority", "next_crawl_after"],
      },
      {
        name: "crawled_pages",
        type: "nosql",
        fields: [
          { name: "url_hash", type: "string" },
          { name: "url", type: "string" },
          { name: "status_code", type: "int" },
          { name: "content_hash", type: "string", note: "SimHash for near-duplicate detection" },
          { name: "content_storage_path", type: "string", note: "S3 path to raw HTML" },
          { name: "extracted_links", type: "int" },
          { name: "crawled_at", type: "datetime" },
        ],
        partitionKey: "url_hash",
      },
      {
        name: "robots_txt_cache",
        type: "cache",
        fields: [
          { name: "domain", type: "string" },
          { name: "rules", type: "json", note: "Parsed robots.txt directives" },
          { name: "crawl_delay", type: "int", note: "Seconds between requests" },
          { name: "fetched_at", type: "datetime" },
          { name: "ttl", type: "int", note: "Typically 24 hours" },
        ],
      },
    ],
    estimationHints: {
      dailyActiveUsers: "N/A — internal system; target: 1B pages crawled/month",
      readWriteRatio:
        "1:1 reads:writes — each crawl involves reading the frontier and writing crawl results",
      storagePerItem: "~100 KB average per page (HTML); 1B pages/month = 100 TB/month raw content",
      peakMultiplier: "Steady-state — crawler operates at a constant rate, not user-driven",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. DISTRIBUTED CACHE
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "distributed-cache",
    requirements: [
      {
        id: "r1",
        text: "Key-value get/set with sub-millisecond latency",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "TTL-based expiration per key",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Multiple eviction policies (LRU, LFU, random)",
        category: "functional",
        importance: "important",
      },
      {
        id: "r4",
        text: "Support for data structures: lists, sets, sorted sets, hash maps",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Consistent hashing for data distribution across nodes",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r6",
        text: "Primary-replica replication for fault tolerance",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r7",
        text: "1M+ operations per second per node",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Hot key detection and mitigation",
        category: "non-functional",
        importance: "important",
      },
      {
        id: "r9",
        text: "Automatic failover when a primary node goes down",
        category: "non-functional",
        importance: "critical",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How does consistent hashing work, and why use virtual nodes?",
        category: "scale",
        hint: "Hash ring with virtual nodes for even distribution",
        answer:
          "Consistent hashing maps both keys and servers onto a ring (0 to 2^32). A key is assigned to the first server clockwise from its position. With only physical nodes, distribution can be uneven. Virtual nodes (e.g., 150 per physical node) spread each server's responsibility across the ring, giving much more uniform distribution and smoother rebalancing when nodes join/leave.",
      },
      {
        id: "q2",
        question: "What happens when a cache node goes down?",
        category: "failure",
        hint: "Failover to replica + consistent hashing minimizes data loss",
        answer:
          "The sentinel/coordinator detects the failure via heartbeats. It promotes the replica to primary and updates the cluster topology. Clients are notified of the new topology. With consistent hashing, only the keys belonging to the failed node are affected — other nodes continue serving their keys normally. The new primary starts accepting writes immediately.",
      },
      {
        id: "q3",
        question: "How do you handle a hot key that gets 100K requests per second?",
        category: "scale",
        hint: "Replicate hot keys across nodes",
        answer:
          "Detect hot keys by sampling (e.g., 1% of requests). When a key exceeds a threshold (e.g., 1000 QPS), replicate it to all nodes with a random suffix in the routing key. Client-side load balancing distributes reads across all replicas. Alternatively, use a local in-memory L1 cache on app servers with short TTL for known hot keys.",
      },
      {
        id: "q4",
        question: "How do you choose between LRU and LFU eviction?",
        category: "optimization",
        hint: "Access pattern dependent",
        answer:
          "LRU is best for recency-biased workloads (most recent = most likely to be accessed again). LFU is better for frequency-biased workloads (some items are consistently popular). LFU handles scan resistance better — a full-table scan won't evict frequently-used keys. Redis uses approximated LRU/LFU (sampling 5 random keys) for O(1) eviction.",
      },
      {
        id: "q5",
        question: "How do you prevent thundering herd when a popular cache entry expires?",
        category: "scale",
        hint: "Locking + stale-while-revalidate",
        answer:
          "Use a distributed lock: when a key expires, the first requester acquires a lock and rebuilds the cache while other requesters either wait briefly or are served stale data (stale-while-revalidate pattern). Alternatively, use probabilistic early expiration: randomly refresh the key before it expires, with probability increasing as TTL approaches zero.",
      },
      {
        id: "q6",
        question: "How do you handle cache coherence when the database is updated?",
        category: "consistency",
        hint: "Cache invalidation strategies",
        answer:
          "Three common patterns: (1) Cache-aside: application manages cache reads and invalidation on writes. (2) Write-through: writes go to cache and database synchronously. (3) Write-behind: writes go to cache immediately and database asynchronously. Cache-aside is most common because it's simple and handles failure gracefully — stale data self-corrects on TTL expiry.",
      },
    ],
    referenceAPIs: [
      {
        method: "GET",
        path: "/cache/{key}",
        description: "Get value by key",
        response: "{ value: any, ttl: number } or 404",
      },
      {
        method: "PUT",
        path: "/cache/{key}",
        description: "Set a key-value pair",
        requestBody: "{ value: any, ttlMs?: number, evictionPolicy?: string }",
        response: "{ success: boolean }",
      },
      {
        method: "DELETE",
        path: "/cache/{key}",
        description: "Delete a key",
        response: "{ success: boolean, existed: boolean }",
      },
      {
        method: "GET",
        path: "/cluster/status",
        description: "Get cluster topology and health",
        response: "{ nodes: Node[], totalKeys: number, hitRate: number }",
      },
    ],
    dataModel: [
      {
        name: "cache_entry",
        type: "cache",
        fields: [
          { name: "key", type: "string" },
          { name: "value", type: "bytes", note: "Serialized value (string, list, set, etc.)" },
          { name: "ttl", type: "int", note: "Time-to-live in milliseconds" },
          { name: "created_at", type: "datetime" },
          { name: "last_accessed_at", type: "datetime", note: "For LRU eviction" },
          { name: "access_count", type: "int", note: "For LFU eviction" },
        ],
      },
      {
        name: "cluster_topology",
        type: "sql",
        fields: [
          { name: "node_id", type: "string" },
          { name: "host", type: "string" },
          { name: "port", type: "int" },
          { name: "role", type: "enum", note: "primary or replica" },
          { name: "primary_id", type: "string", note: "For replicas, the primary they replicate" },
          { name: "hash_slots", type: "int[]", note: "Assigned hash slot ranges" },
          { name: "status", type: "enum", note: "healthy, degraded, down" },
          { name: "last_heartbeat", type: "datetime" },
        ],
        indexes: ["role", "status"],
      },
    ],
    estimationHints: {
      dailyActiveUsers: "N/A — infrastructure service; handles 500K+ reads/sec, 100K+ writes/sec",
      readWriteRatio: "5:1 reads:writes — caches are read-heavy by design",
      storagePerItem:
        "Average ~1 KB per entry; 500 GB total cache = ~500M entries across the cluster",
      peakMultiplier: "2x during application peak hours; hot keys can spike 100x",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 11. PAYMENT SYSTEM
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "payment-system",
    requirements: [
      {
        id: "r1",
        text: "Process payments (authorize, capture, settle)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Support refunds and partial refunds",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Double-entry accounting ledger",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Multiple payment methods (cards, bank transfers, wallets)",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Dispute/chargeback handling workflow",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Daily reconciliation with bank settlement files",
        category: "functional",
        importance: "important",
      },
      {
        id: "r7",
        text: "Effectively-once (idempotent) payment execution — idempotency keys make at-least-once retries safe, preventing double-charges",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "PCI DSS compliance — tokenize card numbers",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Multi-currency with proper rounding (banker's rounding)",
        category: "non-functional",
        importance: "important",
      },
      {
        id: "r10",
        text: "99.999% availability for payment processing",
        category: "non-functional",
        importance: "critical",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How do you ensure a payment is never processed twice?",
        category: "consistency",
        hint: "Idempotency keys stored with the result",
        answer:
          "Every payment API call includes a client-generated idempotency key. Before processing, check if the key exists in the database. If it does, return the stored result. If not, process the payment and store the key + result atomically in the same transaction. Use a unique index on the idempotency key to prevent race conditions.",
      },
      {
        id: "q2",
        question: "How do you handle a payment processor being down?",
        category: "failure",
        hint: "Circuit breaker + fallback processor",
        answer:
          "Implement a circuit breaker per payment processor. When the primary processor fails, route to a backup processor (e.g., Stripe → Adyen). Queue failed payments for retry with exponential backoff. For authorized-but-not-captured payments, the authorization has a TTL (typically 7 days) so there's time to retry.",
      },
      {
        id: "q3",
        question: "How does the double-entry ledger work?",
        category: "consistency",
        hint: "Every transaction creates balanced debit + credit entries",
        answer:
          "Every financial operation creates at least two balanced ledger entries — total debits always equal total credits. Each entry has a type (debit or credit) and an always-positive amount; direction lives in the type, never in the sign. E.g., a $100 payment creates: debit customer_account $100, credit merchant_account $100. Refunds reverse: debit merchant_account $50, credit customer_account $50. The ledger is append-only — never update or delete entries. This provides a complete audit trail and self-balancing verification.",
      },
      {
        id: "q4",
        question: "How do you handle a multi-step payment that fails midway?",
        category: "failure",
        hint: "Saga pattern with compensating transactions",
        answer:
          "Use the saga pattern: authorize → fraud check → capture → settle. Each step has a compensating action (void authorization, reverse capture). If step 3 fails, execute compensating actions in reverse order. A saga coordinator (backed by a message queue) tracks the state machine and triggers compensations on failure.",
      },
      {
        id: "q5",
        question: "How do you ensure PCI DSS compliance?",
        category: "security",
        hint: "Tokenization and network segmentation",
        answer:
          "Never store raw card numbers. Tokenize at the entry point using a PCI-compliant vault service. The token (not the card number) flows through the system. The vault resides in an isolated PCI-scoped network segment with strict access controls, encryption at rest and in transit, and detailed audit logging.",
      },
      {
        id: "q6",
        question: "How do you handle currency conversion in a multi-currency system?",
        category: "optimization",
        hint: "Store amounts in minor units with currency code",
        answer:
          "Store all amounts as integers in the smallest currency unit (cents for USD, yen for JPY). Store the currency code alongside. Use exchange rates from a reliable feed, updated every minute. Apply banker's rounding (round half to even) to avoid systematic bias. Lock the exchange rate at the time of transaction creation.",
      },
    ],
    referenceAPIs: [
      {
        method: "POST",
        path: "/api/v1/payments",
        description: "Create and authorize a payment",
        requestBody:
          "{ amount: number, currency: string, paymentMethod: object, idempotencyKey: string, merchantId: string }",
        response: "{ paymentId, status: 'authorized'|'declined', authCode }",
      },
      {
        method: "POST",
        path: "/api/v1/payments/{paymentId}/capture",
        description: "Capture an authorized payment",
        requestBody: "{ amount?: number }",
        response: "{ paymentId, status: 'captured', capturedAmount }",
      },
      {
        method: "POST",
        path: "/api/v1/payments/{paymentId}/refund",
        description: "Refund a captured payment",
        requestBody: "{ amount: number, reason: string, idempotencyKey: string }",
        response: "{ refundId, status, refundedAmount }",
      },
      {
        method: "GET",
        path: "/api/v1/payments/{paymentId}",
        description: "Get payment details and status",
        response: "{ paymentId, status, amount, currency, timeline: Event[] }",
      },
      {
        method: "GET",
        path: "/api/v1/ledger/balance/{accountId}",
        description: "Get account balance from ledger",
        response: "{ accountId, balance, currency, lastUpdated }",
      },
    ],
    dataModel: [
      {
        name: "payments",
        type: "sql",
        fields: [
          { name: "payment_id", type: "uuid" },
          {
            name: "idempotency_key",
            type: "string",
            note: "Unique index for idempotency (effectively-once)",
          },
          { name: "merchant_id", type: "string" },
          { name: "amount", type: "bigint", note: "In minor currency units (cents)" },
          { name: "currency", type: "string", note: "ISO 4217 (USD, EUR, JPY)" },
          {
            name: "status",
            type: "enum",
            note: "created, authorized, captured, settled, refunded, failed",
          },
          { name: "payment_method_token", type: "string", note: "Tokenized card/method reference" },
          { name: "processor_ref", type: "string", note: "External processor transaction ID" },
          { name: "created_at", type: "datetime" },
        ],
        indexes: ["idempotency_key (unique)", "merchant_id", "status", "created_at"],
      },
      {
        name: "ledger_entries",
        type: "sql",
        fields: [
          { name: "entry_id", type: "uuid" },
          { name: "transaction_id", type: "string", note: "Groups debit+credit pair" },
          { name: "account_id", type: "string" },
          {
            name: "amount",
            type: "bigint",
            note: "Always positive, in minor units — direction comes from type, never from sign",
          },
          { name: "currency", type: "string" },
          {
            name: "type",
            type: "enum",
            note: "debit or credit — per transaction, total debits = total credits",
          },
          { name: "description", type: "string" },
          { name: "created_at", type: "datetime" },
        ],
        indexes: ["transaction_id", "account_id", "created_at"],
      },
      {
        name: "idempotency_store",
        type: "cache",
        fields: [
          { name: "idempotency_key", type: "string" },
          { name: "response_body", type: "json", note: "Stored response for replay" },
          { name: "status_code", type: "int" },
          { name: "created_at", type: "datetime" },
          { name: "ttl", type: "int", note: "24 hours" },
        ],
      },
    ],
    estimationHints: {
      dailyActiveUsers: "10M merchants, ~100M transactions/day",
      readWriteRatio:
        "1:1 reads:writes — each payment involves writes (create, state transitions) and reads (status checks)",
      storagePerItem:
        "~2 KB per payment + 500 bytes per ledger entry pair; 100M transactions/day = ~250 GB/day",
      peakMultiplier: "10x during Black Friday / holiday shopping events",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 12. TICKET BOOKING
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "ticket-booking",
    requirements: [
      {
        id: "r1",
        text: "Browse events and view seat availability maps",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Select and temporarily hold seats during checkout",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Complete booking with payment processing",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Virtual waiting room queue for high-demand events",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r5",
        text: "Bot detection and mitigation",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Dynamic pricing based on demand and remaining inventory",
        category: "functional",
        importance: "nice-to-have",
      },
      {
        id: "r7",
        text: "No double-booking of the same seat",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Seat hold auto-releases after 10 min timeout",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Real-time seat availability updates to all clients",
        category: "non-functional",
        importance: "important",
      },
      {
        id: "r10",
        text: "Handle 14M+ concurrent users during popular on-sale events",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How do you prevent two users from booking the same seat?",
        category: "consistency",
        hint: "Distributed locks or optimistic locking",
        answer:
          "Use Redis SETNX with a 10-minute TTL to atomically claim a seat. The key is seat_{event_id}_{seat_id}. If SETNX returns 0 (key exists), the seat is taken. On payment success, persist to the SQL database. On timeout, the Redis key auto-expires and the seat becomes available again.",
      },
      {
        id: "q2",
        question: "How does the virtual waiting room work?",
        category: "scale",
        hint: "FIFO queue with controlled admission",
        answer:
          "When traffic exceeds capacity, redirect new users to a waiting room page. Assign each user a position in a Redis-backed FIFO queue. A rate controller admits users in batches (e.g., 1000 per minute) based on system capacity. Users see their position and estimated wait time. Use a signed JWT token to prove their queue position and prevent queue jumping.",
      },
      {
        id: "q3",
        question: "What if payment fails after seats are held?",
        category: "failure",
        hint: "Seat release on payment timeout",
        answer:
          "The seat hold has a 10-minute TTL in Redis. If payment doesn't succeed within that window, the Redis key expires and the seat is automatically released back to inventory. The client is notified to retry. If payment succeeds after the hold expired, refund immediately and ask the user to re-select.",
      },
      {
        id: "q4",
        question: "How do you detect and block ticket bots?",
        category: "security",
        hint: "Multi-layered detection",
        answer:
          "Layer multiple defenses: CAPTCHA challenges before entering the queue, device fingerprinting to detect multiple sessions from the same device, IP rate limiting, behavioral analysis (human-like mouse movements vs. bot scripts), and purchase history analysis (flagging accounts that buy tickets in bulk for resale).",
      },
      {
        id: "q5",
        question: "How do you provide real-time seat availability updates?",
        category: "optimization",
        hint: "Server-Sent Events or WebSocket",
        answer:
          "Use Server-Sent Events (SSE) to push seat availability changes to connected clients. When a seat is held or released, publish an event to Redis Pub/Sub. SSE gateway servers subscribe to the event's channel and push updates to clients. Only send diffs (seat X changed from available to held) to minimize bandwidth.",
      },
      {
        id: "q6",
        question: "How do you handle a massive traffic spike the moment tickets go on sale?",
        category: "scale",
        hint: "Pre-warming and traffic shaping",
        answer:
          "Pre-warm all caches with event data before sale starts. Activate the virtual queue 5 minutes before sale time. Use CDN for static assets (venue map, event details). Rate-limit the booking API independently of the browse API. Horizontally scale the booking service ahead of time based on pre-registered interest numbers.",
      },
    ],
    referenceAPIs: [
      {
        method: "GET",
        path: "/api/v1/events/{eventId}/seats",
        description: "Get seat map with availability",
        response: "{ sections: [{ seatId, row, number, status, price }] }",
      },
      {
        method: "POST",
        path: "/api/v1/events/{eventId}/hold",
        description: "Hold selected seats temporarily",
        requestBody: "{ seatIds: string[] }",
        response: "{ holdId, expiresAt, totalPrice }",
      },
      {
        method: "POST",
        path: "/api/v1/bookings",
        description: "Complete booking with payment",
        requestBody: "{ holdId: string, paymentMethod: object }",
        response: "{ bookingId, confirmationCode, tickets: Ticket[] }",
      },
      {
        method: "GET",
        path: "/api/v1/queue/{eventId}/position",
        description: "Get user's position in waiting room",
        response: "{ position: number, estimatedWaitMinutes: number }",
      },
      {
        method: "GET",
        path: "/api/v1/bookings/{bookingId}",
        description: "Get booking details",
        response: "{ bookingId, event, seats, totalPrice, status }",
      },
    ],
    dataModel: [
      {
        name: "events",
        type: "sql",
        fields: [
          { name: "event_id", type: "uuid" },
          { name: "name", type: "string" },
          { name: "venue_id", type: "string" },
          { name: "event_date", type: "datetime" },
          { name: "sale_start", type: "datetime" },
          { name: "total_seats", type: "int" },
          { name: "available_seats", type: "int" },
          { name: "status", type: "enum", note: "upcoming, on_sale, sold_out, completed" },
        ],
        indexes: ["event_date", "status", "venue_id"],
      },
      {
        name: "seats",
        type: "sql",
        fields: [
          { name: "seat_id", type: "string", note: "Composite: event_id + section + row + number" },
          { name: "event_id", type: "string" },
          { name: "section", type: "string" },
          { name: "row", type: "string" },
          { name: "number", type: "int" },
          { name: "price", type: "decimal" },
          { name: "status", type: "enum", note: "available, held, booked" },
          { name: "version", type: "int", note: "For optimistic locking" },
        ],
        indexes: ["event_id", "status"],
      },
      {
        name: "seat_holds",
        type: "cache",
        fields: [
          { name: "seat_key", type: "string", note: "seat_{eventId}_{seatId}" },
          { name: "user_id", type: "string" },
          { name: "hold_id", type: "string" },
          { name: "ttl", type: "int", note: "600 seconds (10 minutes)" },
        ],
      },
      {
        name: "bookings",
        type: "sql",
        fields: [
          { name: "booking_id", type: "uuid" },
          { name: "user_id", type: "string" },
          { name: "event_id", type: "string" },
          { name: "seat_ids", type: "string[]" },
          { name: "total_price", type: "decimal" },
          { name: "payment_id", type: "string" },
          { name: "confirmation_code", type: "string" },
          { name: "status", type: "enum", note: "confirmed, cancelled, refunded" },
          { name: "booked_at", type: "datetime" },
        ],
        indexes: ["user_id", "event_id", "confirmation_code"],
      },
    ],
    estimationHints: {
      dailyActiveUsers: "100M DAU browsing; 14M concurrent during hot on-sale events",
      readWriteRatio: "100:1 reads:writes — browsing seat maps vs actual bookings",
      storagePerItem:
        "~2 KB per booking; ~100 bytes per seat record; large events have 50K-100K seats",
      peakMultiplier: "100x normal traffic at the moment tickets go on sale",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 13. COLLABORATIVE EDITOR
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "collaborative-editor",
    requirements: [
      {
        id: "r1",
        text: "Multiple users editing the same document simultaneously",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Real-time visibility of all participants' changes (< 200ms)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Conflict resolution for concurrent edits (OT or CRDTs)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Cursor presence (see other editors' cursor positions)",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Full version history with diff between any two versions",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Offline editing with automatic merge on reconnect",
        category: "functional",
        importance: "nice-to-have",
      },
      {
        id: "r7",
        text: "Rich text: formatting, tables, images, embeds",
        category: "functional",
        importance: "important",
      },
      {
        id: "r8",
        text: "Document-level and block-level permissions",
        category: "non-functional",
        importance: "important",
      },
      {
        id: "r9",
        text: "Support up to 100 concurrent editors per document",
        category: "non-functional",
        importance: "critical",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "What's the difference between OT and CRDTs, and which would you choose?",
        category: "consistency",
        hint: "Server-centric vs peer-to-peer tradeoffs",
        answer:
          "OT (Operational Transformation) transforms operations against concurrent edits, requires a central server for ordering, and is what Google Docs uses. CRDTs (Conflict-free Replicated Data Types) converge automatically without a central coordinator, making them better for offline/P2P scenarios. OT is simpler to implement for a server-based architecture; CRDTs are more robust for offline editing.",
      },
      {
        id: "q2",
        question: "How do you handle the collaboration server crashing?",
        category: "failure",
        hint: "Persist operations + stateless recovery",
        answer:
          "Persist every operation to a durable message queue (Kafka) before acknowledging to the client. The collaboration server is stateless — it can be restarted and rebuild document state by replaying operations from the last snapshot. Use a separate snapshot service that periodically checkpoints documents so recovery doesn't require replaying the entire operation history.",
      },
      {
        id: "q3",
        question: "How do you store and retrieve version history efficiently?",
        category: "optimization",
        hint: "Snapshots + operation logs",
        answer:
          "Take full document snapshots every N operations (e.g., every 100 operations). Between snapshots, store individual operations. To reconstruct any version, load the nearest prior snapshot and replay operations up to the target version. This balances storage (fewer full copies) with reconstruction speed (limited replay needed).",
      },
      {
        id: "q4",
        question: "How do you route all operations for a document to the same server?",
        category: "scale",
        hint: "Document-to-server affinity",
        answer:
          "Use consistent hashing to assign each document to a collaboration server instance. Store the mapping in a service registry (Redis or ZooKeeper). When a user opens a document, they connect to the assigned server's WebSocket. If the server fails, re-assign the document to another server, which rebuilds state from the operation log.",
      },
      {
        id: "q5",
        question: "How do you handle offline edits being merged after reconnection?",
        category: "consistency",
        hint: "Buffer operations and transform on sync",
        answer:
          "The client buffers operations while offline. On reconnect, it sends its buffered operations along with the last-known server version. The server transforms the client's operations against all operations that occurred since that version (OT). If using CRDTs, the merge is automatic since CRDTs guarantee convergence regardless of operation ordering.",
      },
      {
        id: "q6",
        question: "How do you implement cursor presence without overwhelming the server?",
        category: "optimization",
        hint: "Throttle + ephemeral broadcast",
        answer:
          "Throttle cursor position updates to every 100ms per user. Broadcast cursor positions via WebSocket to only the active editors of that document (not stored in the database). Use a lightweight presence channel separate from the operation channel. Cursor data is ephemeral — if lost, the next update corrects it.",
      },
    ],
    referenceAPIs: [
      {
        method: "GET",
        path: "/api/v1/documents/{docId}",
        description: "Get document content and metadata",
        response: "{ docId, title, content, version, collaborators, permissions }",
      },
      {
        method: "POST",
        path: "/api/v1/documents",
        description: "Create a new document",
        requestBody: "{ title: string, content?: string }",
        response: "{ docId, title, version: 0 }",
      },
      {
        method: "POST",
        path: "/api/v1/documents/{docId}/operations",
        description: "Submit an operation (via WebSocket in practice)",
        requestBody: "{ operation: Operation, baseVersion: number }",
        response: "{ version: number, transformedOp: Operation }",
      },
      {
        method: "GET",
        path: "/api/v1/documents/{docId}/history",
        description: "Get version history",
        response: "{ versions: [{ version, author, timestamp, summary }] }",
      },
      {
        method: "PUT",
        path: "/api/v1/documents/{docId}/permissions",
        description: "Update document sharing/permissions",
        requestBody: "{ userId: string, role: 'viewer'|'commenter'|'editor' }",
        response: "{ success: boolean }",
      },
    ],
    dataModel: [
      {
        name: "documents",
        type: "sql",
        fields: [
          { name: "doc_id", type: "uuid" },
          { name: "title", type: "string" },
          { name: "owner_id", type: "string" },
          { name: "current_version", type: "int" },
          { name: "content_snapshot", type: "text", note: "Latest full document content" },
          { name: "created_at", type: "datetime" },
          { name: "updated_at", type: "datetime" },
        ],
        indexes: ["owner_id", "updated_at"],
      },
      {
        name: "operations",
        type: "nosql",
        fields: [
          { name: "doc_id", type: "string" },
          { name: "version", type: "int", note: "Monotonic per document" },
          { name: "user_id", type: "string" },
          { name: "operation", type: "json", note: "OT operation (insert, delete, retain)" },
          { name: "timestamp", type: "datetime" },
        ],
        partitionKey: "doc_id",
        indexes: ["version"],
      },
      {
        name: "snapshots",
        type: "nosql",
        fields: [
          { name: "doc_id", type: "string" },
          { name: "version", type: "int" },
          { name: "content", type: "text", note: "Full document content at this version" },
          { name: "created_at", type: "datetime" },
        ],
        partitionKey: "doc_id",
      },
    ],
    estimationHints: {
      dailyActiveUsers: "100M DAU, average 3 documents edited per day",
      readWriteRatio:
        "1:5 reads:writes (write-heavy) — real-time edits generate many operations per document view",
      storagePerItem:
        "~50 bytes per operation; active document generates ~1000 ops/hour with 5 editors",
      peakMultiplier: "3x during business hours (9 AM - 5 PM across timezones)",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 14. FILE STORAGE (DROPBOX)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "file-storage",
    requirements: [
      {
        id: "r1",
        text: "Upload and download files",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Sync files across multiple devices automatically",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "File versioning with rollback support",
        category: "functional",
        importance: "important",
      },
      {
        id: "r4",
        text: "Share files/folders with granular permissions",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Block-level chunking for delta sync",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r6",
        text: "Content deduplication across users",
        category: "functional",
        importance: "important",
      },
      {
        id: "r7",
        text: "Resumable uploads for large files",
        category: "non-functional",
        importance: "important",
      },
      {
        id: "r8",
        text: "Conflict resolution for simultaneous edits on different devices",
        category: "non-functional",
        importance: "important",
      },
      {
        id: "r9",
        text: "Real-time sync notifications across devices",
        category: "non-functional",
        importance: "critical",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How does delta sync work and why is it important?",
        category: "optimization",
        hint: "Block-level diff to minimize bandwidth",
        answer:
          "Split files into 4 MB blocks and hash each block. When a file changes, compute the new block list and compare hashes against the stored version. Only upload blocks with new hashes. For a 100 MB file where 1 block changed, you upload 4 MB instead of 100 MB — a 96% bandwidth reduction. Use rolling hash (Rabin fingerprint) for content-defined chunking.",
      },
      {
        id: "q2",
        question:
          "How do you handle a conflict when the same file is edited on two devices offline?",
        category: "consistency",
        hint: "Conflict copies with user resolution",
        answer:
          "Detect conflicts by comparing the base version. If device A and B both edit version 5, one wins (first to sync) and the other is saved as a conflict copy (e.g., 'report (Device B's conflicted copy).docx'). Notify the user of the conflict and let them choose which version to keep. Never silently discard changes.",
      },
      {
        id: "q3",
        question: "How do you implement cross-user deduplication?",
        category: "optimization",
        hint: "Content-addressable storage",
        answer:
          "Use content-addressable storage: the block's SHA-256 hash is its storage key. Before uploading a block, check if a block with that hash already exists. If it does, just add a reference — no upload needed. This is especially effective for common files (OS updates, popular documents). A reference count tracks when blocks can be garbage collected.",
      },
      {
        id: "q4",
        question: "How do you notify other devices when a file changes?",
        category: "scale",
        hint: "Long polling or push notifications",
        answer:
          "Desktop clients maintain a long-polling connection to the sync service. When a file changes, the sync service publishes an event to a message queue. A notification worker pushes the change event to all connected devices of that user. Mobile devices receive push notifications via APNS/FCM. Each device then pulls the specific block list changes.",
      },
      {
        id: "q5",
        question: "What happens if object storage goes down?",
        category: "failure",
        hint: "Replication across regions",
        answer:
          "Replicate object storage across at least 2 regions (e.g., S3 cross-region replication). Metadata is stored in a separate database with its own replication. During an outage, fail over reads to the secondary region. Writes are queued and replayed when the primary recovers. Data durability (11 nines for S3) is the highest priority.",
      },
      {
        id: "q6",
        question: "How do you handle a user with 500,000 files in a single folder?",
        category: "scale",
        hint: "Pagination and incremental sync",
        answer:
          "Never load the entire folder listing at once. Use cursor-based pagination for API responses. For sync, maintain a server-side changelog (journal) per user. The client stores a cursor and fetches only changes since the last sync. This makes sync O(changes) instead of O(total files), even for massive folders.",
      },
    ],
    referenceAPIs: [
      {
        method: "POST",
        path: "/api/v1/files/upload/init",
        description: "Initiate a chunked upload",
        requestBody: "{ path: string, fileSize: number, blockHashes: string[] }",
        response: "{ uploadId, blocksToUpload: string[] }",
      },
      {
        method: "PUT",
        path: "/api/v1/files/upload/{uploadId}/block/{blockHash}",
        description: "Upload a single block",
        requestBody: "Binary block data",
        response: "{ success: boolean }",
      },
      {
        method: "POST",
        path: "/api/v1/files/upload/{uploadId}/commit",
        description: "Commit the upload after all blocks are uploaded",
        response: "{ fileId, version, path }",
      },
      {
        method: "GET",
        path: "/api/v1/files/{fileId}/download",
        description: "Download a file",
        response: "Binary file data (streamed block-by-block)",
      },
      {
        method: "GET",
        path: "/api/v1/sync/changes?cursor={cursor}",
        description: "Get changes since last sync cursor",
        response: "{ changes: Change[], cursor: string, hasMore: boolean }",
      },
    ],
    dataModel: [
      {
        name: "files",
        type: "sql",
        fields: [
          { name: "file_id", type: "uuid" },
          { name: "user_id", type: "string" },
          { name: "path", type: "string", note: "Full path including filename" },
          { name: "is_directory", type: "boolean" },
          { name: "size_bytes", type: "bigint" },
          { name: "version", type: "int" },
          { name: "block_list", type: "string[]", note: "Ordered list of block hashes" },
          { name: "content_hash", type: "string", note: "SHA-256 of entire file" },
          { name: "updated_at", type: "datetime" },
          { name: "deleted", type: "boolean" },
        ],
        indexes: ["user_id + path (unique)", "updated_at"],
      },
      {
        name: "blocks",
        type: "nosql",
        fields: [
          { name: "block_hash", type: "string", note: "SHA-256 content hash = storage key" },
          { name: "storage_url", type: "string", note: "S3 path" },
          { name: "size_bytes", type: "int" },
          { name: "reference_count", type: "int", note: "Number of files referencing this block" },
        ],
        partitionKey: "block_hash",
      },
      {
        name: "sync_journal",
        type: "nosql",
        fields: [
          { name: "user_id", type: "string" },
          { name: "sequence_number", type: "bigint" },
          { name: "file_id", type: "string" },
          { name: "action", type: "enum", note: "create, update, delete, move" },
          { name: "timestamp", type: "datetime" },
        ],
        partitionKey: "user_id",
        indexes: ["sequence_number"],
      },
    ],
    estimationHints: {
      dailyActiveUsers:
        "700M+ registered users (tens of millions DAU), average 10 file syncs/day per user",
      readWriteRatio: "1:1 — balanced between downloads and uploads/syncs",
      storagePerItem:
        "Average file: 1 MB; with dedup and versioning, effective storage is ~60% of raw",
      peakMultiplier: "2x during business hours; Monday mornings see highest sync volume",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 15. PARKING LOT
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "parking-lot",
    requirements: [
      {
        id: "r1",
        text: "Track vehicle entry and exit in real time",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Show available spots by type (compact, regular, EV, handicapped)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Reservation system with time slots",
        category: "functional",
        importance: "important",
      },
      {
        id: "r4",
        text: "Payment processing (hourly, daily, monthly passes)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r5",
        text: "Dynamic pricing based on demand and occupancy",
        category: "functional",
        importance: "nice-to-have",
      },
      {
        id: "r6",
        text: "Automatic license plate recognition (LPR)",
        category: "functional",
        importance: "important",
      },
      {
        id: "r7",
        text: "Real-time availability updated within 2 seconds of entry/exit",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Prevent double-booking of reserved spots",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Multi-lot management dashboard with analytics",
        category: "non-functional",
        importance: "nice-to-have",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How do you handle an IoT sensor failing on a parking spot?",
        category: "failure",
        hint: "Redundancy + fallback detection",
        answer:
          "Use redundant sensors (e.g., ground sensor + overhead camera). If a sensor goes offline, mark the spot's status as 'unknown' and rely on the entry/exit gate count for total availability. Alert maintenance for repair. Keep the system functional by using gate-based counting as a fallback, even though per-spot accuracy degrades.",
      },
      {
        id: "q2",
        question: "How do you prevent two users from reserving the same spot?",
        category: "consistency",
        hint: "Optimistic locking at commit time",
        answer:
          "Use optimistic locking with a version column on the spot reservation table. When committing a reservation, check that the version hasn't changed since the user selected the spot. If it has (another user reserved it), return an error and ask the user to select a different spot. For high-contention lots, use a Redis distributed lock with short TTL.",
      },
      {
        id: "q3",
        question: "How does dynamic pricing work?",
        category: "optimization",
        hint: "Supply-demand signals",
        answer:
          "Calculate price multiplier based on: current occupancy percentage, time of day (peak hours), day of week, nearby events (concert, sports game), and historical demand patterns. Update prices every 5-15 minutes. Display the current rate clearly before the user enters or reserves. Cap the maximum surge multiplier for fairness.",
      },
      {
        id: "q4",
        question: "How do you handle a payment system failure at exit?",
        category: "failure",
        hint: "Capture on exit with fallback",
        answer:
          "Pre-authorize the card at entry or reservation. At exit, capture the final amount. If the payment system is down, record the unpaid exit in a retry queue and open the gate (prioritize traffic flow). Process the charge once the payment system recovers. For monthly pass holders, verification is done locally from a cached pass database.",
      },
      {
        id: "q5",
        question: "How do you integrate LPR (License Plate Recognition)?",
        category: "optimization",
        hint: "Camera at entry/exit + OCR pipeline",
        answer:
          "Cameras at entry and exit gates capture plate images. An OCR service (ML-based, e.g., OpenALPR) reads the plate number in under 500ms. Match against registered vehicles for automatic gate opening. Store plate + timestamp for billing. Accuracy is ~95-99%; fallback to ticket-based entry for unrecognized plates.",
      },
    ],
    referenceAPIs: [
      {
        method: "GET",
        path: "/api/v1/lots/{lotId}/availability",
        description: "Get real-time spot availability",
        response: "{ total, available, byType: { compact, regular, ev, handicapped } }",
      },
      {
        method: "POST",
        path: "/api/v1/lots/{lotId}/reservations",
        description: "Reserve a parking spot",
        requestBody:
          "{ spotType: string, startTime: ISO8601, endTime: ISO8601, vehiclePlate?: string }",
        response: "{ reservationId, spotId, confirmationCode }",
      },
      {
        method: "POST",
        path: "/api/v1/lots/{lotId}/entry",
        description: "Record vehicle entry (from IoT/LPR)",
        requestBody: "{ licensePlate: string, gateId: string, timestamp: ISO8601 }",
        response: "{ sessionId, assignedSpot?, rate }",
      },
      {
        method: "POST",
        path: "/api/v1/sessions/{sessionId}/exit",
        description: "Record vehicle exit and process payment",
        requestBody: "{ gateId: string, timestamp: ISO8601 }",
        response: "{ duration, totalCharge, paymentStatus }",
      },
    ],
    dataModel: [
      {
        name: "parking_lots",
        type: "sql",
        fields: [
          { name: "lot_id", type: "uuid" },
          { name: "name", type: "string" },
          { name: "address", type: "string" },
          { name: "total_spots", type: "int" },
          { name: "floors", type: "int" },
          { name: "hourly_rate", type: "decimal" },
          { name: "surge_multiplier", type: "decimal" },
        ],
        indexes: ["name"],
      },
      {
        name: "spots",
        type: "sql",
        fields: [
          { name: "spot_id", type: "string", note: "lot_id + floor + zone + number" },
          { name: "lot_id", type: "string" },
          { name: "floor", type: "int" },
          { name: "zone", type: "string" },
          { name: "type", type: "enum", note: "compact, regular, handicapped, ev" },
          { name: "status", type: "enum", note: "available, occupied, reserved, maintenance" },
          { name: "sensor_status", type: "enum", note: "online, offline, unknown" },
          { name: "version", type: "int", note: "For optimistic locking" },
        ],
        indexes: ["lot_id + type + status"],
      },
      {
        name: "availability_cache",
        type: "cache",
        fields: [
          { name: "lot_id", type: "string" },
          { name: "available_compact", type: "int" },
          { name: "available_regular", type: "int" },
          { name: "available_ev", type: "int" },
          { name: "available_handicapped", type: "int" },
          { name: "updated_at", type: "datetime" },
        ],
      },
      {
        name: "parking_sessions",
        type: "sql",
        fields: [
          { name: "session_id", type: "uuid" },
          { name: "lot_id", type: "string" },
          { name: "spot_id", type: "string" },
          { name: "license_plate", type: "string" },
          { name: "entry_time", type: "datetime" },
          { name: "exit_time", type: "datetime" },
          { name: "total_charge", type: "decimal" },
          { name: "payment_status", type: "enum", note: "pending, paid, failed" },
        ],
        indexes: ["lot_id", "license_plate", "entry_time"],
      },
    ],
    estimationHints: {
      dailyActiveUsers: "10M DAU, ~5M parking sessions/day across all lots",
      readWriteRatio: "5:1 — availability checks dominate over entry/exit writes",
      storagePerItem: "~500 bytes per session; 5M sessions/day = 2.5 GB/day",
      peakMultiplier: "3x during morning rush (8-9 AM) and evening rush (5-6 PM)",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 16. INSTAGRAM / PHOTO SHARING
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "instagram",
    requirements: [
      {
        id: "r1",
        text: "Upload photos with resizing and optional filters",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "View personalized ranked feed",
        category: "functional",
        importance: "critical",
      },
      { id: "r3", text: "Follow/unfollow users", category: "functional", importance: "critical" },
      {
        id: "r4",
        text: "Like, comment, and share posts",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Stories (24h ephemeral content)",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Reels (short video up to 3 minutes)",
        category: "functional",
        importance: "important",
      },
      {
        id: "r7",
        text: "Content moderation pipeline",
        category: "functional",
        importance: "important",
      },
      {
        id: "r8",
        text: "Image delivery via CDN with < 200ms latency globally",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Feed load time < 200ms at p99",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r10",
        text: "Handle 100M+ photo uploads per day",
        category: "non-functional",
        importance: "critical",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How do you generate a ranked feed for 500M daily active users?",
        category: "scale",
        hint: "Hybrid fan-out + ML ranking",
        answer:
          "For users following < 10K accounts, fan-out-on-write: push new post IDs to their cached feed (Redis list). For users following celebrities, fan-out-on-read: merge celebrity posts at read time. Then rank the top 500 candidate posts using an ML model scoring recency, engagement, relationship strength, and content-type preference. Return the top 50.",
      },
      {
        id: "q2",
        question: "How does the image processing pipeline work?",
        category: "optimization",
        hint: "Async pipeline: upload → queue → workers → CDN",
        answer:
          "Upload the original to object storage and publish a processing job to a message queue. Workers generate multiple sizes (thumbnail 150px, feed 640px, full 1080px), strip EXIF metadata, apply optional filters, and upload resized versions to object storage. Update the CDN to serve the processed images. The original is kept for reprocessing if needed.",
      },
      {
        id: "q3",
        question: "How do you handle stories that expire after 24 hours?",
        category: "optimization",
        hint: "TTL-based cleanup",
        answer:
          "Store stories with a TTL. Use Redis with ZRANGEBYSCORE to fetch active stories (timestamp > now - 24h). A background job cleans up expired story media from object storage after a grace period (e.g., 48h). Stories are stored separately from permanent posts because they have different access patterns and lifecycle.",
      },
      {
        id: "q4",
        question: "How do you prevent inappropriate content from being published?",
        category: "security",
        hint: "Automated ML + human review pipeline",
        answer:
          "Multi-stage pipeline: (1) On upload, run ML classifiers for nudity, violence, hate speech — block obvious violations immediately. (2) For borderline content, queue for human review. (3) Post-publication, monitor user reports and re-evaluate. Use a confidence threshold: high-confidence violations are auto-removed, medium-confidence goes to human review, low-confidence passes through.",
      },
      {
        id: "q5",
        question: "How do you handle the social graph at Instagram's scale?",
        category: "scale",
        hint: "Dedicated graph storage",
        answer:
          "Store the follow graph in a dedicated graph storage (like TAO at Facebook). Partition by user_id. For fan-out, maintain a materialized follower list (who follows this user) and following list (who this user follows). Cache hot users' follower lists in Redis. Use graph traversal for feed generation and friend suggestions.",
      },
      {
        id: "q6",
        question: "How do you serve images globally with low latency?",
        category: "optimization",
        hint: "Multi-tier CDN strategy",
        answer:
          "Serve all images through a multi-tier CDN. Edge nodes (100+ PoPs globally) cache popular images. A mid-tier shield layer prevents thundering herd on the origin. Use different CDN cache policies by image type: profile pictures (long TTL, small size), feed images (medium TTL), stories (short TTL, high churn). Pre-warm CDN for trending/viral content.",
      },
    ],
    referenceAPIs: [
      {
        method: "POST",
        path: "/api/v1/posts",
        description: "Create a new post with photo/video",
        requestBody: "{ mediaIds: string[], caption: string, location?: object, tags?: string[] }",
        response: "{ postId, mediaUrls, createdAt }",
      },
      {
        method: "GET",
        path: "/api/v1/feed",
        description: "Get personalized home feed",
        response: "{ posts: Post[], nextCursor: string }",
      },
      {
        method: "GET",
        path: "/api/v1/users/{userId}/stories",
        description: "Get a user's active stories",
        response: "{ stories: Story[] }",
      },
      {
        method: "POST",
        path: "/api/v1/posts/{postId}/like",
        description: "Like a post",
        response: "{ success: boolean, likeCount: number }",
      },
      {
        method: "POST",
        path: "/api/v1/media/upload",
        description: "Upload media (photo or video)",
        requestBody: "Multipart form data with media file",
        response: "{ mediaId, processingStatus }",
      },
    ],
    dataModel: [
      {
        name: "posts",
        type: "nosql",
        fields: [
          { name: "post_id", type: "snowflake_id" },
          { name: "user_id", type: "string" },
          { name: "caption", type: "string" },
          {
            name: "media_urls",
            type: "json",
            note: "{ original, thumbnail, feed, full } per image",
          },
          { name: "location", type: "json" },
          { name: "like_count", type: "int" },
          { name: "comment_count", type: "int" },
          { name: "created_at", type: "datetime" },
        ],
        partitionKey: "user_id",
        indexes: ["post_id", "created_at"],
      },
      {
        name: "stories",
        type: "nosql",
        fields: [
          { name: "story_id", type: "string" },
          { name: "user_id", type: "string" },
          { name: "media_url", type: "string" },
          { name: "type", type: "enum", note: "photo, video, boomerang" },
          { name: "created_at", type: "datetime" },
          { name: "expires_at", type: "datetime", note: "created_at + 24 hours" },
          { name: "view_count", type: "int" },
        ],
        partitionKey: "user_id",
      },
      {
        name: "feed_cache",
        type: "cache",
        fields: [
          { name: "user_id", type: "string" },
          { name: "post_ids", type: "string[]", note: "Pre-computed ranked feed, max 500 entries" },
          { name: "updated_at", type: "datetime" },
        ],
      },
      {
        name: "social_graph",
        type: "nosql",
        fields: [
          { name: "user_id", type: "string" },
          { name: "follower_id", type: "string" },
          { name: "followed_at", type: "datetime" },
          { name: "is_close_friend", type: "boolean" },
        ],
        partitionKey: "user_id",
      },
    ],
    estimationHints: {
      dailyActiveUsers:
        "3B MAU (~500M DAU), average user scrolls 30 posts/session, 100M uploads/day",
      readWriteRatio: "50:1 — feed views and media downloads vastly exceed uploads",
      storagePerItem:
        "Average photo: 2 MB original, ~5 MB across all sizes; 100M/day = 500 TB/day raw media",
      peakMultiplier: "3x during holidays and cultural events (New Year's Eve, festivals)",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 17. MUSIC STREAMING (SPOTIFY)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "music-streaming",
    requirements: [
      {
        id: "r1",
        text: "Stream audio tracks with adaptive bitrate",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Search tracks by title, artist, album, lyrics",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Create, edit, and share playlists",
        category: "functional",
        importance: "important",
      },
      {
        id: "r4",
        text: "Personalized recommendations (Discover Weekly, daily mixes)",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Offline download with encrypted local storage",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Gapless playback with pre-buffering",
        category: "functional",
        importance: "important",
      },
      {
        id: "r7",
        text: "Real-time play count tracking for royalty calculations",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Adaptive bitrate: 96/160/320 kbps based on network",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Catalog of 100M+ tracks searchable in < 200ms",
        category: "non-functional",
        importance: "critical",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How do you handle millions of concurrent audio streams efficiently?",
        category: "scale",
        hint: "CDN + edge caching for popular tracks",
        answer:
          "Store audio files at multiple bitrates in object storage. Serve through a CDN with edge caching. The top 1% of tracks (popular hits) account for ~80% of streams, so CDN cache hit ratio is very high. For long-tail tracks, use an origin shield to prevent thundering herd. Pre-buffer the next track 30 seconds before the current track ends.",
      },
      {
        id: "q2",
        question: "How do you build the recommendation engine?",
        category: "optimization",
        hint: "Collaborative filtering + content features",
        answer:
          "Combine collaborative filtering (users who listened to X also liked Y — matrix factorization on the user-track interaction matrix) with content-based features (audio analysis: tempo, energy, key, mood). Process listening events through Kafka into a batch pipeline (Spark) that recomputes recommendations daily. Serve from a precomputed cache per user.",
      },
      {
        id: "q3",
        question: "How do you accurately track play counts for royalty payments?",
        category: "consistency",
        hint: "At-least-once delivery + dedup",
        answer:
          "The client reports a 'stream completed' event (after 30+ seconds of playback per industry standard). Events are sent to Kafka for durability. A stream processing pipeline deduplicates (using user_id + track_id + timestamp window) and aggregates play counts. Counts feed into the royalty calculation system. Accuracy is contractually required, so data integrity is paramount.",
      },
      {
        id: "q4",
        question: "How do you implement offline download securely?",
        category: "security",
        hint: "Encrypted local storage with license checks",
        answer:
          "Downloaded tracks are encrypted with a device-specific key derived from the user's DRM license. The app checks the license validity on each playback start. Licenses expire after 30 days offline, requiring an internet connection to renew. If the subscription lapses, the license server revokes the key and downloaded tracks become unplayable.",
      },
      {
        id: "q5",
        question: "How do you implement gapless playback?",
        category: "optimization",
        hint: "Pre-fetch + client-side audio buffer",
        answer:
          "When the current track has ~30 seconds remaining, the client requests the next track's audio data. The audio decoder prepares both tracks in memory. At the transition point, crossfade or gap-fill based on metadata (some albums have intentional gaps, others expect gapless). The server provides track boundary metadata so the client can handle both cases correctly.",
      },
      {
        id: "q6",
        question: "How do you handle a new album release by a top artist?",
        category: "scale",
        hint: "Pre-warming and traffic management",
        answer:
          "Pre-upload and transcode the album hours before release. Push the audio files to CDN edge nodes in advance (cache warming). At release time, update the metadata database and invalidate the search cache. Stagger notifications to avoid a thundering herd — send push notifications in batches over 5-10 minutes rather than all at once.",
      },
    ],
    referenceAPIs: [
      {
        method: "GET",
        path: "/api/v1/tracks/{trackId}/stream",
        description: "Get streaming URL for a track",
        response: "{ streamUrl: string, bitrates: number[], duration: number, cdnUrl: string }",
      },
      {
        method: "GET",
        path: "/api/v1/search?q={query}&type={tracks|artists|albums}",
        description: "Search the catalog",
        response: "{ tracks?: Track[], artists?: Artist[], albums?: Album[] }",
      },
      {
        method: "GET",
        path: "/api/v1/playlists/{playlistId}",
        description: "Get playlist details and tracks",
        response: "{ playlistId, name, tracks: Track[], followerCount }",
      },
      {
        method: "POST",
        path: "/api/v1/playlists",
        description: "Create a new playlist",
        requestBody: "{ name: string, trackIds?: string[], isPublic: boolean }",
        response: "{ playlistId, name }",
      },
      {
        method: "POST",
        path: "/api/v1/streams/report",
        description: "Report a stream event for royalty tracking",
        requestBody: "{ trackId, duration, bitrate, timestamp, offline: boolean }",
        response: "{ success: boolean }",
      },
    ],
    dataModel: [
      {
        name: "tracks",
        type: "nosql",
        fields: [
          { name: "track_id", type: "string" },
          { name: "title", type: "string" },
          { name: "artist_ids", type: "string[]" },
          { name: "album_id", type: "string" },
          { name: "duration_ms", type: "int" },
          { name: "audio_urls", type: "json", note: "{ 96kbps: url, 160kbps: url, 320kbps: url }" },
          { name: "genre", type: "string[]" },
          { name: "release_date", type: "date" },
          { name: "play_count", type: "bigint" },
          {
            name: "audio_features",
            type: "json",
            note: "tempo, energy, key, danceability for recommendations",
          },
        ],
        partitionKey: "track_id",
      },
      {
        name: "playlists",
        type: "nosql",
        fields: [
          { name: "playlist_id", type: "string" },
          { name: "owner_id", type: "string" },
          { name: "name", type: "string" },
          { name: "track_ids", type: "string[]" },
          { name: "is_public", type: "boolean" },
          { name: "follower_count", type: "int" },
          { name: "updated_at", type: "datetime" },
        ],
        partitionKey: "playlist_id",
      },
      {
        name: "track_search",
        type: "search",
        fields: [
          { name: "track_id", type: "string" },
          { name: "title", type: "text" },
          { name: "artist_name", type: "text" },
          { name: "album_name", type: "text" },
          { name: "lyrics", type: "text", note: "Full-text searchable" },
          { name: "genre", type: "keyword[]" },
          { name: "popularity", type: "long", note: "For relevance boosting" },
        ],
      },
      {
        name: "stream_events",
        type: "nosql",
        fields: [
          { name: "event_id", type: "string" },
          { name: "user_id", type: "string" },
          { name: "track_id", type: "string" },
          { name: "duration_ms", type: "int" },
          { name: "bitrate", type: "int" },
          { name: "timestamp", type: "datetime" },
          { name: "country", type: "string", note: "For regional royalty reporting" },
        ],
        partitionKey: "track_id",
      },
    ],
    estimationHints: {
      dailyActiveUsers: "200M DAU, average 30 songs/day per user = 6B streams/day",
      readWriteRatio: "100:1 — streaming reads far exceed playlist edits and play count writes",
      storagePerItem:
        "Average track: 3.5 MB at 160kbps for 3 min; ~10 MB across all bitrates; 100M tracks = 1 PB",
      peakMultiplier: "3x during commute hours (7-9 AM, 5-7 PM) and new album releases",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 18. E-COMMERCE (AMAZON)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "ecommerce",
    requirements: [
      {
        id: "r1",
        text: "Product catalog with search and filters",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Shopping cart that persists across sessions and devices",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Order placement with payment processing",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Real-time inventory tracking across warehouses",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r5",
        text: "Personalized product recommendations",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Order tracking from placement to delivery",
        category: "functional",
        importance: "important",
      },
      {
        id: "r7",
        text: "Product reviews and ratings",
        category: "functional",
        importance: "important",
      },
      {
        id: "r8",
        text: "Prevent overselling during concurrent purchases",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Product search with filters in < 200ms",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r10",
        text: "Handle 100x traffic spikes during flash sales (Prime Day)",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How do you prevent overselling when 10,000 users try to buy the last 5 items?",
        category: "consistency",
        hint: "Inventory reservation with optimistic locking",
        answer:
          "Use optimistic locking with a version number on the inventory count. At checkout, execute an atomic UPDATE inventory SET count = count - 1, version = version + 1 WHERE product_id = X AND version = Y AND count > 0. If the WHERE clause matches 0 rows, the item is sold out. For extreme concurrency, pre-partition inventory into Redis counters per warehouse.",
      },
      {
        id: "q2",
        question: "How do you handle the shopping cart across devices?",
        category: "optimization",
        hint: "Server-side cart with merge logic",
        answer:
          "Store carts server-side in a NoSQL database (DynamoDB) keyed by user_id. Anonymous users get a session-based cart. On sign-in, merge the anonymous cart with the user's existing cart (combine items, keep higher quantity). Cart reads are served from cache with a short TTL. This ensures carts survive browser closure and work across devices.",
      },
      {
        id: "q3",
        question: "How do you handle a flash sale with 100x normal traffic?",
        category: "scale",
        hint: "Pre-scaling + queue-based checkout",
        answer:
          "Pre-scale all services 24 hours before the sale. Use a virtual queue for the checkout flow to control concurrency. Cache product pages aggressively (CDN + app cache). Separate the browse path (read-heavy, cacheable) from the buy path (write-heavy, needs consistency). Disable non-essential features (recommendations, reviews) during peak to free up resources.",
      },
      {
        id: "q4",
        question: "How do you build product search with faceted filtering?",
        category: "optimization",
        hint: "Elasticsearch with denormalized product data",
        answer:
          "Index products in Elasticsearch with all filterable attributes denormalized into the document (category, brand, price, rating, availability). Use Elasticsearch aggregations for faceted counts. Boost results by relevance, popularity, and availability. Cache popular search queries in Redis. For autocomplete, use the completion suggester.",
      },
      {
        id: "q5",
        question: "How do you implement the order processing pipeline?",
        category: "scale",
        hint: "Event-driven saga pattern",
        answer:
          "Model orders as an event stream: created -> payment_authorized -> inventory_reserved -> warehouse_assigned -> picked -> packed -> shipped -> delivered. Each step is a separate service consuming events from a message queue. Failed steps trigger compensating actions (release inventory, void payment). This decouples services and provides full order auditability.",
      },
      {
        id: "q6",
        question: "How do you handle returns and refunds?",
        category: "consistency",
        hint: "Reverse flow through the pipeline",
        answer:
          "A return request triggers a reverse saga: verify return eligibility -> generate return label -> receive item at warehouse -> quality inspection -> restock inventory -> process refund. Each step updates the order status. Refunds use the same idempotent payment system. Inventory is only restocked after quality check passes.",
      },
    ],
    referenceAPIs: [
      {
        method: "GET",
        path: "/api/v1/products/search?q={query}&filters={filters}",
        description: "Search products with filters",
        response: "{ products: Product[], facets: Facet[], totalResults: number }",
      },
      {
        method: "GET",
        path: "/api/v1/products/{productId}",
        description: "Get product details",
        response: "{ productId, name, price, variants, reviews, availability }",
      },
      {
        method: "POST",
        path: "/api/v1/cart/items",
        description: "Add item to cart",
        requestBody: "{ productId: string, variantId: string, quantity: number }",
        response: "{ cartId, items: CartItem[], total }",
      },
      {
        method: "POST",
        path: "/api/v1/orders",
        description: "Place an order from cart",
        requestBody: "{ cartId: string, shippingAddress: object, paymentMethod: object }",
        response: "{ orderId, status, estimatedDelivery }",
      },
      {
        method: "GET",
        path: "/api/v1/orders/{orderId}/tracking",
        description: "Get order tracking info",
        response: "{ orderId, status, timeline: Event[], trackingNumber }",
      },
    ],
    dataModel: [
      {
        name: "products",
        type: "nosql",
        fields: [
          { name: "product_id", type: "string" },
          { name: "name", type: "string" },
          { name: "description", type: "text" },
          { name: "category", type: "string" },
          { name: "brand", type: "string" },
          { name: "price", type: "decimal" },
          { name: "variants", type: "json", note: "Size, color, etc. with per-variant pricing" },
          { name: "image_urls", type: "string[]" },
          { name: "avg_rating", type: "decimal" },
          { name: "review_count", type: "int" },
          { name: "seller_id", type: "string" },
        ],
        partitionKey: "product_id",
      },
      {
        name: "inventory",
        type: "sql",
        fields: [
          { name: "product_id", type: "string" },
          { name: "warehouse_id", type: "string" },
          { name: "variant_id", type: "string" },
          { name: "quantity", type: "int" },
          { name: "reserved", type: "int", note: "Held for pending orders" },
          { name: "version", type: "int", note: "For optimistic locking" },
        ],
        indexes: ["product_id + warehouse_id + variant_id (unique)"],
      },
      {
        name: "orders",
        type: "sql",
        fields: [
          { name: "order_id", type: "uuid" },
          { name: "user_id", type: "string" },
          {
            name: "items",
            type: "json",
            note: "Snapshot of items, prices, quantities at order time",
          },
          { name: "total_amount", type: "decimal" },
          {
            name: "status",
            type: "enum",
            note: "placed, paid, processing, shipped, delivered, returned",
          },
          { name: "shipping_address", type: "json" },
          { name: "payment_id", type: "string" },
          { name: "created_at", type: "datetime" },
        ],
        indexes: ["user_id", "status", "created_at"],
      },
      {
        name: "carts",
        type: "nosql",
        fields: [
          { name: "user_id", type: "string" },
          { name: "items", type: "json", note: "[{ productId, variantId, quantity, price }]" },
          { name: "updated_at", type: "datetime" },
        ],
        partitionKey: "user_id",
      },
    ],
    estimationHints: {
      dailyActiveUsers:
        "300M+ active customer accounts, ~10M orders/day, 200M+ product searches/day",
      readWriteRatio:
        "100:1 reads:writes — product browsing and search vastly exceed order placement",
      storagePerItem:
        "~5 KB per product, ~2 KB per order; 100M products = 500 GB catalog; 10M orders/day = ~20 GB/day",
      peakMultiplier: "100x during Prime Day / Black Friday flash sales",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 19. TEAM MESSAGING (SLACK)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "team-messaging",
    requirements: [
      {
        id: "r1",
        text: "Real-time messaging in channels and DMs",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Workspace isolation (multi-tenant data security)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Threaded conversations with reply counts",
        category: "functional",
        importance: "important",
      },
      {
        id: "r4",
        text: "Full-text search across all workspace messages",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "File sharing with preview generation",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Integration framework (bots, webhooks, slash commands)",
        category: "functional",
        importance: "important",
      },
      {
        id: "r7",
        text: "Channel types: public, private, DM, group DM",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Message delivery in real time via WebSocket",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Offline message queuing for disconnected clients",
        category: "non-functional",
        importance: "important",
      },
      {
        id: "r10",
        text: "Search across billions of messages in < 500ms",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How do you ensure workspace data isolation in a multi-tenant system?",
        category: "security",
        hint: "Tenant-scoped data access at every layer",
        answer:
          "Every database query includes a workspace_id in the WHERE clause. Partition the search index by workspace_id. Use workspace-scoped auth tokens that are validated at the API gateway. Row-level security in the database as a defense-in-depth measure. Encrypt data at rest per workspace with distinct keys for compliance-sensitive customers.",
      },
      {
        id: "q2",
        question: "How do you build full-text search across billions of messages?",
        category: "scale",
        hint: "Elasticsearch partitioned by workspace",
        answer:
          "Index messages in a Lucene-based search engine (Slack uses Solr), partitioned by workspace_id for tenant isolation. Index asynchronously via a message queue to avoid slowing down message sends. Support rich query syntax: 'from:alice in:#engineering has:file after:2025-01-01'. Use per-workspace result limits and relevance scoring based on recency and channel membership.",
      },
      {
        id: "q3",
        question: "How do you deliver a message to 10,000 members of a large channel?",
        category: "scale",
        hint: "Pub/Sub with connection registry",
        answer:
          "When a message is sent to a channel, publish it to a Redis Pub/Sub topic for that channel. Each WebSocket gateway server subscribes to topics for its connected users' channels. The gateway pushes the message to all locally connected members. Users not currently connected receive the message on next sync. This avoids iterating over all 10K members in the app server.",
      },
      {
        id: "q4",
        question: "How do you implement threaded conversations?",
        category: "optimization",
        hint: "Parent-child message relationship",
        answer:
          "Store a thread_id (parent message ID) on reply messages. Maintain a thread metadata record with reply_count, last_reply_at, and participant_ids. When loading a channel, show thread previews (reply count + latest reply) without loading full threads. Fetch full thread content on demand when the user clicks 'View thread'. Index threads separately for thread-specific search.",
      },
      {
        id: "q5",
        question: "How do you handle the integration framework (bots, webhooks)?",
        category: "optimization",
        hint: "Event-driven with app-scoped permissions",
        answer:
          "Expose a webhook URL per integration. When events occur (message posted, reaction added, user joined), publish events to a message queue. Integration workers deliver events to registered webhook URLs. Slash commands route through the API gateway to the registered handler URL. Each integration has scoped permissions (which channels it can read/write) and rate limits.",
      },
      {
        id: "q6",
        question: "What happens when a WebSocket gateway server goes down?",
        category: "failure",
        hint: "Stateless gateway + reconnect protocol",
        answer:
          "WebSocket gateways are stateless: connection-to-user mappings are stored in Redis. When a gateway dies, connected clients detect the broken socket and reconnect to another gateway via the load balancer. The new gateway registers the connection in Redis. The client sends its last-seen message sequence number, and the server replays any missed messages from the message store.",
      },
    ],
    referenceAPIs: [
      {
        method: "POST",
        path: "/api/v1/workspaces/{workspaceId}/channels/{channelId}/messages",
        description: "Send a message to a channel",
        requestBody: "{ text: string, threadId?: string, attachments?: string[] }",
        response: "{ messageId, timestamp, sequenceNumber }",
      },
      {
        method: "GET",
        path: "/api/v1/workspaces/{workspaceId}/channels/{channelId}/messages",
        description: "Get channel message history",
        response: "{ messages: Message[], hasMore: boolean }",
      },
      {
        method: "GET",
        path: "/api/v1/workspaces/{workspaceId}/search?q={query}",
        description: "Search messages in workspace",
        response: "{ messages: Message[], totalResults: number }",
      },
      {
        method: "POST",
        path: "/api/v1/workspaces/{workspaceId}/channels",
        description: "Create a channel",
        requestBody: "{ name: string, type: 'public'|'private', description?: string }",
        response: "{ channelId, name, type }",
      },
      {
        method: "POST",
        path: "/api/v1/workspaces/{workspaceId}/integrations",
        description: "Register a new integration",
        requestBody: "{ name, webhookUrl, events: string[], permissions: string[] }",
        response: "{ integrationId, token }",
      },
    ],
    dataModel: [
      {
        name: "messages",
        type: "nosql",
        fields: [
          { name: "workspace_id", type: "string" },
          { name: "channel_id", type: "string" },
          { name: "message_id", type: "string" },
          { name: "sequence_number", type: "bigint", note: "Per-channel monotonic" },
          { name: "user_id", type: "string" },
          { name: "text", type: "string" },
          { name: "thread_id", type: "string", note: "Null if top-level message" },
          { name: "attachments", type: "json" },
          { name: "reactions", type: "json", note: "{ emoji: [userId, ...] }" },
          { name: "edited_at", type: "datetime" },
          { name: "created_at", type: "datetime" },
        ],
        partitionKey: "workspace_id + channel_id",
        indexes: ["sequence_number", "thread_id"],
      },
      {
        name: "channels",
        type: "sql",
        fields: [
          { name: "channel_id", type: "uuid" },
          { name: "workspace_id", type: "string" },
          { name: "name", type: "string" },
          { name: "type", type: "enum", note: "public, private, dm, group_dm" },
          { name: "description", type: "string" },
          { name: "member_count", type: "int" },
          { name: "created_at", type: "datetime" },
          { name: "last_message_at", type: "datetime" },
        ],
        indexes: ["workspace_id + name (unique)", "workspace_id + type"],
      },
      {
        name: "message_search",
        type: "search",
        fields: [
          { name: "message_id", type: "string" },
          { name: "workspace_id", type: "keyword", note: "Mandatory filter for tenant isolation" },
          { name: "channel_id", type: "keyword" },
          { name: "user_id", type: "keyword" },
          { name: "text", type: "text" },
          { name: "has_attachment", type: "boolean" },
          { name: "created_at", type: "date" },
        ],
      },
      {
        name: "connection_registry",
        type: "cache",
        fields: [
          { name: "user_id", type: "string" },
          { name: "gateway_server_id", type: "string" },
          { name: "workspace_id", type: "string" },
          { name: "subscribed_channels", type: "string[]" },
          { name: "connected_at", type: "datetime" },
        ],
      },
    ],
    estimationHints: {
      dailyActiveUsers: "100M DAU across millions of workspaces, ~50 messages sent/day per user",
      readWriteRatio: "5:1 — reading message history and search exceed message sends",
      storagePerItem: "~500 bytes per message; 5B messages/day = 2.5 TB/day",
      peakMultiplier: "3x during business hours (9 AM - 12 PM across US and EU timezones)",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 20. METRICS / MONITORING SYSTEM
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "metrics-monitoring",
    requirements: [
      {
        id: "r1",
        text: "Ingest time-series metrics from thousands of servers",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Flexible query language with aggregations (avg, sum, percentiles, rate)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Real-time dashboards with auto-refresh",
        category: "functional",
        importance: "important",
      },
      {
        id: "r4",
        text: "Alerting engine with threshold and anomaly detection",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r5",
        text: "Alert routing with escalation policies and on-call schedules",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Automatic downsampling (raw -> 1min -> 1hour)",
        category: "functional",
        importance: "important",
      },
      {
        id: "r7",
        text: "Ingest 500K+ data points per second",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Tag-based metric organization with high-cardinality support",
        category: "non-functional",
        importance: "important",
      },
      {
        id: "r9",
        text: "Query response < 100ms for recent data (last 1 hour)",
        category: "non-functional",
        importance: "critical",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How do you store time-series data efficiently?",
        category: "optimization",
        hint: "Column-oriented storage + compression",
        answer:
          "Use a time-series database optimized for append-heavy, time-ordered data. Partition by metric name + time range (e.g., 1-hour chunks). Within each chunk, use delta-of-delta encoding for timestamps (saves 80%+) and XOR encoding for values (saves 50%+ for slowly-changing metrics). This is the approach used by Gorilla (Facebook) and achieves 12:1 compression ratios.",
      },
      {
        id: "q2",
        question: "How does the alerting pipeline work without missing alerts?",
        category: "failure",
        hint: "Separate evaluation from ingestion",
        answer:
          "Run an independent alert evaluation service that queries recent data every 15-60 seconds per rule. Decouple alerting from ingestion so ingestion lag doesn't affect alerting. Use a state machine per alert rule: OK -> PENDING (threshold breached once) -> FIRING (breached for configurable duration) -> RESOLVED. Persist alert state so it survives service restarts.",
      },
      {
        id: "q3",
        question: "How do you handle high-cardinality tags?",
        category: "scale",
        hint: "Inverted index + cardinality limits",
        answer:
          "Maintain an inverted index mapping tag values to metric series IDs for fast lookups. Set cardinality limits per tag (e.g., max 10K unique values) to prevent combinatorial explosion. For high-cardinality dimensions like request_id, recommend using logs/traces instead of metrics. Monitor and alert on tag cardinality to prevent runaway growth.",
      },
      {
        id: "q4",
        question: "How does the downsampling pipeline work?",
        category: "optimization",
        hint: "Background aggregation with retention policies",
        answer:
          "A scheduled job reads raw metrics older than 7 days, computes per-minute aggregates (avg, min, max, sum, count), writes them to a separate 1-minute resolution table, and marks the raw data for deletion. At 30 days, repeat for 1-hour resolution. This reduces storage by ~100x for historical data while preserving statistical accuracy. Queries automatically route to the appropriate resolution based on the time range.",
      },
      {
        id: "q5",
        question: "How do you ensure alerts don't create noise (alert fatigue)?",
        category: "optimization",
        hint: "Grouping, dedup, and routing",
        answer:
          "Group related alerts (e.g., all instances of the same service) into a single notification. Require a configurable 'for' duration (e.g., 5 minutes) before firing to filter transient spikes. Implement escalation policies: page on-call after 5 minutes, escalate to team lead after 15, escalate to manager after 30. Support silencing and maintenance windows.",
      },
      {
        id: "q6",
        question: "How do you handle a monitoring system outage — who monitors the monitor?",
        category: "failure",
        hint: "Self-monitoring + external watchdog",
        answer:
          "The monitoring system monitors itself (meta-monitoring) with dedicated health checks. Additionally, use a simple external watchdog service (even a cron job on a separate machine) that pings the monitoring system and alerts via a completely separate channel (e.g., PagerDuty direct integration) if it's unreachable. The watchdog must have zero dependencies on the main monitoring stack.",
      },
    ],
    referenceAPIs: [
      {
        method: "POST",
        path: "/api/v1/metrics/ingest",
        description: "Ingest a batch of metric data points",
        requestBody:
          "{ dataPoints: [{ metric: string, value: number, timestamp: number, tags: object }] }",
        response: "{ accepted: number, rejected: number }",
      },
      {
        method: "GET",
        path: "/api/v1/metrics/query",
        description: "Query metrics with aggregations",
        response: "{ series: [{ metric, tags, datapoints: [timestamp, value][] }] }",
      },
      {
        method: "POST",
        path: "/api/v1/alerts/rules",
        description: "Create an alert rule",
        requestBody:
          "{ name, query: string, condition: string, forDuration: string, severity: string, notifyChannels: string[] }",
        response: "{ ruleId, status: 'active' }",
      },
      {
        method: "GET",
        path: "/api/v1/alerts/active",
        description: "List currently firing alerts",
        response: "{ alerts: [{ ruleId, status, firedAt, metric, value }] }",
      },
      {
        method: "GET",
        path: "/api/v1/dashboards/{dashboardId}",
        description: "Get dashboard layout and widget queries",
        response: "{ dashboardId, name, widgets: Widget[] }",
      },
    ],
    dataModel: [
      {
        name: "metric_data",
        type: "nosql",
        fields: [
          { name: "metric_name", type: "string" },
          { name: "tags", type: "json", note: "{ host: 'web-01', region: 'us-east-1', ... }" },
          { name: "timestamp", type: "bigint", note: "Unix epoch milliseconds" },
          { name: "value", type: "double" },
          { name: "resolution", type: "enum", note: "raw, 1min, 1hour" },
        ],
        partitionKey: "metric_name + time_bucket",
      },
      {
        name: "alert_rules",
        type: "sql",
        fields: [
          { name: "rule_id", type: "uuid" },
          { name: "name", type: "string" },
          { name: "query", type: "string", note: "Metric query expression" },
          { name: "condition", type: "string", note: "e.g., '> 90' or 'anomaly'" },
          { name: "for_duration", type: "string", note: "e.g., '5m' — must be true for this long" },
          { name: "severity", type: "enum", note: "critical, warning, info" },
          { name: "notify_channels", type: "string[]", note: "Slack, PagerDuty, email" },
          { name: "state", type: "enum", note: "ok, pending, firing, resolved" },
          { name: "last_evaluated_at", type: "datetime" },
        ],
        indexes: ["state", "severity"],
      },
      {
        name: "tag_index",
        type: "nosql",
        fields: [
          { name: "tag_key", type: "string" },
          { name: "tag_value", type: "string" },
          {
            name: "series_ids",
            type: "string[]",
            note: "Inverted index: tag value -> matching series",
          },
          { name: "cardinality", type: "int", note: "Number of unique values for this tag key" },
        ],
        partitionKey: "tag_key",
      },
      {
        name: "dashboards",
        type: "sql",
        fields: [
          { name: "dashboard_id", type: "uuid" },
          { name: "name", type: "string" },
          { name: "owner_id", type: "string" },
          { name: "widgets", type: "json", note: "Layout + query definition per widget" },
          { name: "refresh_interval", type: "int", note: "Auto-refresh in seconds" },
          { name: "created_at", type: "datetime" },
          { name: "updated_at", type: "datetime" },
        ],
        indexes: ["owner_id"],
      },
    ],
    estimationHints: {
      dailyActiveUsers:
        "N/A — infrastructure service; ingests from 100K+ hosts, ~500K data points/sec",
      readWriteRatio: "1:10 write-heavy — continuous metric ingestion dominates dashboard queries",
      storagePerItem:
        "~16 bytes per data point (8 timestamp + 8 value); 500K/sec = 43B/day = ~690 GB/day raw",
      peakMultiplier:
        "2x during deployments and incident investigations (more dashboards open, more queries)",
    },
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // 21. NETFLIX
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "netflix",
    requirements: [
      {
        id: "r1",
        text: "Stream video with adaptive bitrate (per-title encoding ladder)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Personalized homepage with ranked recommendation rows per profile",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Continue watching — resume playback position across devices",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Multiple profiles per account with isolated viewing history",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Search across titles, genres, cast",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Offline downloads with DRM-protected local storage",
        category: "functional",
        importance: "nice-to-have",
      },
      {
        id: "r7",
        text: "< 1s video start time at p95",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Serve 95%+ of video traffic from ISP-embedded CDN appliances (Open Connect)",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "DRM enforcement (Widevine, FairPlay, PlayReady) on every stream",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r10",
        text: "99.99% playback availability — degrade gracefully, never block play",
        category: "non-functional",
        importance: "critical",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How does Netflix's Open Connect CDN differ from a regular CDN?",
        category: "scale",
        hint: "ISP-embedded appliances filled proactively, not on cache miss",
        answer:
          "Open Connect Appliances (OCAs) are storage servers Netflix gives to ISPs to install inside their networks, so video traffic never crosses the public internet backbone. Unlike a pull-through CDN, OCAs are proactively filled during off-peak windows (e.g., 2-6 AM local) with content predicted to be popular in that region. A steering service picks the best OCA per client based on network proximity (BGP data), health, and which OCA actually has the title. This serves 95%+ of traffic from inside the ISP and slashes both latency and Netflix's transit costs.",
      },
      {
        id: "q2",
        question: "How does the adaptive bitrate ladder work?",
        category: "optimization",
        hint: "Per-title encoding + client-side switching between segments",
        answer:
          "Each title is encoded into a ladder of bitrate/resolution pairs (e.g., from ~235 kbps 320p up to ~16 Mbps 4K). The client downloads a manifest listing all renditions, then picks a rendition per segment based on measured throughput and buffer level — shifting down before the buffer empties, shifting up when bandwidth allows. Netflix pioneered per-title (and later per-shot) encoding: a simple animation gets a much cheaper ladder than a grainy action film at the same perceptual quality (measured with VMAF), saving ~20%+ bandwidth versus a fixed ladder.",
      },
      {
        id: "q3",
        question: "Why precompute recommendations instead of computing them at request time?",
        category: "optimization",
        hint: "Offline batch ranking + online cache reads",
        answer:
          "Recommendation models (collaborative filtering + deep models over viewing history) are far too expensive to run per page load at 200M+ daily viewers. Batch pipelines precompute ranked rows per profile (offline, refreshed roughly daily) and store them in a low-latency cache (EVCache); the homepage request is then mostly cache reads assembled in milliseconds. A lightweight online layer re-orders rows with fresh signals (time of day, what you just watched). This matters commercially: ~80% of watch time comes from recommendations.",
      },
      {
        id: "q4",
        question: "What happens when the OCA a client is streaming from fails?",
        category: "failure",
        hint: "Manifest contains ranked fallback URLs",
        answer:
          "The playback manifest gives the client a ranked list of OCA URLs for each stream. If segment requests start failing or throughput collapses, the client transparently fails over to the next OCA on the list (possibly an ISP-level, then IX-level, then AWS origin) and may drop to a lower bitrate during the switch. Playback continues from the buffer during failover, so a well-buffered client sees no interruption.",
      },
      {
        id: "q5",
        question: "How does Netflix survive a full AWS region outage?",
        category: "failure",
        hint: "Active-active multi-region + chaos engineering",
        answer:
          "The control plane runs active-active across multiple AWS regions; user traffic can be evacuated from a failing region by shifting DNS/edge routing, and stateful services replicate cross-region. Critically, video delivery keeps working because OCAs are independent of AWS — only sign-in, browse, and license requests need the control plane. Netflix validates all this continuously with chaos engineering (Chaos Monkey, regional evacuation drills), so failover is a practiced path, not a hope.",
      },
      {
        id: "q6",
        question: "How do you prevent piracy of streams?",
        category: "security",
        hint: "DRM license servers + per-session keys",
        answer:
          "Video segments are encrypted; to play, the client requests a license from a DRM license server (Widevine on Android/Chrome, FairPlay on Apple, PlayReady on others), which returns content keys bound to the device's security level. Hardware-backed DRM (e.g., Widevine L1) is required for HD/4K; software-only devices are capped at lower resolutions. CDN URLs are signed with short TTLs, and watermarking plus monitoring catch leaked copies.",
      },
    ],
    referenceAPIs: [
      {
        method: "GET",
        path: "/api/v1/homepage",
        description: "Get personalized ranked rows for the active profile",
        response: "{ rows: [{ title: string, titleIds: string[] }], evidence: object }",
      },
      {
        method: "GET",
        path: "/api/v1/titles/{titleId}/playback",
        description: "Get playback manifest with OCA URLs and DRM license URL",
        response:
          "{ manifest: { renditions: [{ bitrate, resolution, codec, urls: string[] }] }, licenseUrl, drmScheme }",
      },
      {
        method: "POST",
        path: "/api/v1/playback/events",
        description: "Report playback heartbeat (position, bitrate, rebuffers)",
        requestBody:
          "{ titleId, positionMs, bitrate, bufferMs, event: 'start'|'heartbeat'|'stop' }",
        response: "{ success: boolean }",
      },
      {
        method: "GET",
        path: "/api/v1/search?q={query}",
        description: "Search titles by name, genre, cast",
        response: "{ titles: Title[], suggestions: string[] }",
      },
      {
        method: "GET",
        path: "/api/v1/profiles/{profileId}/continue-watching",
        description: "Get resume positions for in-progress titles",
        response: "{ items: [{ titleId, positionMs, updatedAt }] }",
      },
    ],
    dataModel: [
      {
        name: "titles",
        type: "nosql",
        fields: [
          { name: "title_id", type: "string" },
          { name: "name", type: "string" },
          { name: "type", type: "enum", note: "movie, series, episode" },
          { name: "genres", type: "string[]" },
          { name: "cast", type: "string[]" },
          { name: "duration_ms", type: "int" },
          { name: "maturity_rating", type: "string" },
          {
            name: "available_regions",
            type: "string[]",
            note: "Licensing windows differ per country",
          },
        ],
        partitionKey: "title_id",
      },
      {
        name: "video_assets",
        type: "nosql",
        fields: [
          { name: "title_id", type: "string" },
          { name: "rendition_id", type: "string" },
          { name: "bitrate_kbps", type: "int", note: "Ladder entry, e.g., 235 to 16000" },
          { name: "resolution", type: "string", note: "320p ... 4K" },
          { name: "codec", type: "string", note: "H.264, HEVC, AV1" },
          { name: "segment_base_path", type: "string", note: "Path on OCA / origin storage" },
        ],
        partitionKey: "title_id",
      },
      {
        name: "viewing_history",
        type: "nosql",
        fields: [
          { name: "profile_id", type: "string" },
          { name: "title_id", type: "string" },
          { name: "position_ms", type: "bigint", note: "Resume point for continue watching" },
          { name: "watched_pct", type: "decimal" },
          { name: "updated_at", type: "datetime" },
        ],
        partitionKey: "profile_id",
      },
      {
        name: "recommendations_cache",
        type: "cache",
        fields: [
          { name: "profile_id", type: "string", note: "Cache key (EVCache-style)" },
          { name: "ranked_rows", type: "json", note: "Precomputed rows of ranked title IDs" },
          { name: "computed_at", type: "datetime", note: "Refreshed by nightly batch pipeline" },
        ],
      },
    ],
    estimationHints: {
      dailyActiveUsers:
        "over 300 million subscribers (~302M, Q4 2024), ~200M daily viewers; 15%+ of global downstream internet traffic",
      readWriteRatio:
        "1000:1 reads:writes — streaming and browsing dominate; writes are playback events and catalog updates",
      storagePerItem:
        "A 1-hour title across the full ladder (1000+ encoded variants incl. codecs/languages) ≈ 100+ GB; 17K titles = multi-PB corpus replicated across thousands of OCAs",
      peakMultiplier:
        "3x during regional evening prime time; major releases pre-positioned on OCAs to absorb day-one spikes",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 22. TINDER
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "tinder",
    requirements: [
      {
        id: "r1",
        text: "Swipe left/right on a deck of nearby profiles",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Geospatial candidate retrieval within a configurable radius (1-160 km)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Never show the same profile twice, even across sessions",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Instant match detection when both users swipe right, with push notification",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r5",
        text: "Chat between matched users",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Preference filters: age range, gender, distance",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r7",
        text: "Photo upload with face detection and content moderation",
        category: "functional",
        importance: "important",
      },
      {
        id: "r8",
        text: "Deck load latency < 200ms",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Sustain ~2B swipe writes/day (~23K/sec average)",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r10",
        text: "Match notification delivered within 1 second",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How do you find candidate profiles near a user efficiently?",
        category: "optimization",
        hint: "Geohash partitioning + Redis geo commands",
        answer:
          "Convert each active user's lat/lng to a geohash and store locations in Redis via GEOADD. A deck request runs GEOSEARCH around the user's position for the chosen radius, then filters by preferences (age, gender). Shard the geo index by geohash prefix so each shard owns a geographic region — queries touch one shard (plus neighbors when the radius spans cell boundaries). Dense cities get finer-grained shards than rural areas.",
      },
      {
        id: "q2",
        question: "How do you guarantee a user never sees the same profile twice?",
        category: "optimization",
        hint: "Bloom filter in front of the swipe store",
        answer:
          "Persist every swipe in a NoSQL store keyed (swiper_id, swipee_id) as the source of truth, but checking billions of historical swipes per deck build is expensive. Keep a per-user Bloom filter of swiped IDs in Redis: candidate generation tests each candidate against the filter in O(1) memory-cheap operations (~10 bits per element at 1% false-positive rate). A false positive merely hides one candidate — harmless; false negatives are impossible, so a seen profile is never re-shown. Rebuild the filter from the swipe table if evicted.",
      },
      {
        id: "q3",
        question:
          "How does match detection work, and how do you handle two simultaneous right-swipes?",
        category: "consistency",
        hint: "O(1) reverse-swipe lookup + atomic create",
        answer:
          "On a right-swipe from A on B, look up whether swipe (B, A, right) already exists — an O(1) point read. If yes, create the match. Two simultaneous right-swipes can both observe 'no reverse swipe yet'; prevent duplicate matches by writing the match with a deterministic ID (sorted pair user IDs) under a unique constraint, or run check-and-create atomically in a Redis Lua script. Exactly one match record wins; both users get the push notification.",
      },
      {
        id: "q4",
        question: "How does ELO-style desirability scoring work?",
        category: "optimization",
        hint: "Borrowed from chess ratings — who likes you matters",
        answer:
          "Each profile carries a desirability score updated like a chess ELO rating: getting a right-swipe from a highly-rated user raises your score more than one from a low-rated user, and being passed on by a low-rated user hurts more. The recommender then preferentially shows users to others in a comparable score band, which balances the like distribution and improves match rates. (Tinder has since blended this into a broader ML ranking using activity and engagement, but the ELO framing is the classic interview answer.)",
      },
      {
        id: "q5",
        question: "How do you serve a deck in under 200ms when ranking is expensive?",
        category: "scale",
        hint: "Precomputed decks, refreshed offline",
        answer:
          "Precompute a ranked deck of ~100 candidates per active user during off-peak hours: filter by preferences and the Bloom filter, then rank by compatibility score, distance, recency of activity. Store decks in Redis; a deck request is a cache read. As the user swipes through the deck, asynchronously top it up; if it's exhausted (or the user changes location/filters), fall back to a live geo query with lightweight ranking.",
      },
      {
        id: "q6",
        question: "How do you fight bots and fake profiles?",
        category: "security",
        hint: "Verification + behavioral signals",
        answer:
          "Photo verification: ask for a selfie matching a randomized pose and compare against profile photos with face matching. Apply device fingerprinting and phone-number verification at signup, rate-limit swipes, and detect bot-like behavior (right-swiping 100% of profiles at constant intervals) — such accounts get score-penalized or challenged. Run all uploaded photos through a moderation pipeline (ML classifiers + human review queue) before they're shown.",
      },
    ],
    referenceAPIs: [
      {
        method: "GET",
        path: "/api/v1/recommendations",
        description: "Get the next deck of candidate profiles",
        response: "{ profiles: [{ userId, name, age, distanceKm, photos: string[] }] }",
      },
      {
        method: "POST",
        path: "/api/v1/swipes",
        description: "Record a swipe and detect match",
        requestBody: "{ targetUserId: string, direction: 'left'|'right'|'super' }",
        response: "{ match: boolean, matchId?: string }",
      },
      {
        method: "GET",
        path: "/api/v1/matches",
        description: "List the user's matches",
        response: "{ matches: [{ matchId, userId, name, lastMessageAt }] }",
      },
      {
        method: "PUT",
        path: "/api/v1/users/{userId}/location",
        description: "Update user location",
        requestBody: "{ lat: number, lng: number }",
        response: "{ success: boolean }",
      },
      {
        method: "POST",
        path: "/api/v1/matches/{matchId}/messages",
        description: "Send a chat message within a match",
        requestBody: "{ text: string }",
        response: "{ messageId, createdAt }",
      },
    ],
    dataModel: [
      {
        name: "profiles",
        type: "nosql",
        fields: [
          { name: "user_id", type: "string" },
          { name: "name", type: "string" },
          { name: "birth_date", type: "date" },
          { name: "gender", type: "string" },
          { name: "bio", type: "string" },
          { name: "photo_urls", type: "string[]" },
          { name: "preferences", type: "json", note: "Age range, distance, genders" },
          { name: "desirability_score", type: "decimal", note: "ELO-style rating" },
          { name: "last_active_at", type: "datetime" },
        ],
        partitionKey: "user_id",
      },
      {
        name: "swipes",
        type: "nosql",
        fields: [
          { name: "swiper_id", type: "string" },
          { name: "swipee_id", type: "string" },
          { name: "direction", type: "enum", note: "left, right, super" },
          { name: "created_at", type: "datetime" },
        ],
        partitionKey: "swiper_id",
        indexes: ["swipee_id"],
      },
      {
        name: "matches",
        type: "nosql",
        fields: [
          {
            name: "match_id",
            type: "string",
            note: "Deterministic: sorted pair of user IDs — dedupes races",
          },
          { name: "user_a", type: "string" },
          { name: "user_b", type: "string" },
          { name: "matched_at", type: "datetime" },
          { name: "last_message_at", type: "datetime" },
        ],
        partitionKey: "match_id",
      },
      {
        name: "geo_and_deck_cache",
        type: "cache",
        fields: [
          {
            name: "geo:active_users",
            type: "string",
            note: "Redis geo set (GEOADD/GEOSEARCH), sharded by geohash prefix",
          },
          {
            name: "deck:{user_id}",
            type: "json",
            note: "Precomputed ranked candidate deck (~100 profiles)",
          },
          {
            name: "bloom:{user_id}",
            type: "bytes",
            note: "Bloom filter of already-swiped profile IDs",
          },
        ],
      },
    ],
    estimationHints: {
      dailyActiveUsers: "75M MAU (~26M DAU); ~2B swipes/day ≈ 23K swipe writes/sec average",
      readWriteRatio:
        "≈2:1 reads:writes — deck fetches, profile and photo reads vs the heavy swipe write stream",
      storagePerItem:
        "~100 bytes per swipe record = ~200 GB/day; ~2 KB per profile + ~5 MB of photos per user (CDN/object storage)",
      peakMultiplier: "3x on Sunday evenings; seasonal spikes around New Year and Valentine's Day",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 23. GOOGLE MAPS
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "google-maps",
    requirements: [
      {
        id: "r1",
        text: "Render map tiles at 20+ zoom levels (vector on mobile, raster on web)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Compute driving/walking/transit routes with turn-by-turn directions",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Live traffic layer and traffic-aware ETAs",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Geocoding (address → lat/lng) and reverse geocoding",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Place search with autocomplete near the viewport",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Automatic rerouting during navigation when the driver deviates or traffic shifts",
        category: "functional",
        importance: "important",
      },
      {
        id: "r7",
        text: "Offline map downloads per region",
        category: "functional",
        importance: "nice-to-have",
      },
      {
        id: "r8",
        text: "Route computation < 200ms end-to-end on a 500M+ segment road graph",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Tile load < 100ms from CDN edge",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r10",
        text: "Traffic data refreshed every ~30 seconds from GPS probes",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How does the map tile pyramid work?",
        category: "optimization",
        hint: "2^z × 2^z grid per zoom level, pre-rendered, CDN-cached",
        answer:
          "The world is rendered as a pyramid: at zoom level z the map is a 2^z × 2^z grid of 256px tiles (4^z tiles total) — zoom 0 is one tile for the whole world; zoom 20 resolves individual buildings. Tiles are addressed by (z, x, y), pre-rendered offline from the geographic database, stored in object storage, and served via CDN — the client just fetches the tiles covering its viewport. Mobile clients use vector tiles instead of raster: smaller payloads, client-side rendering, smooth rotation, and restyling without new downloads.",
      },
      {
        id: "q2",
        question:
          "How do you compute a cross-country route in milliseconds when Dijkstra would take seconds?",
        category: "optimization",
        hint: "Preprocessing: Contraction Hierarchies; A* as the baseline improvement",
        answer:
          "Plain Dijkstra explores millions of nodes; A* with a distance heuristic prunes that but is still too slow at continental scale. Production routing uses contraction-hierarchy-style preprocessing (e.g., CH; Google's published work centers on CRP): offline, nodes are ranked by importance and 'contracted' one by one, adding shortcut edges that preserve shortest-path distances. A query then runs a bidirectional search that only ever goes 'upward' in the hierarchy — touching thousands of nodes instead of millions, answering in under a millisecond on the server. Live traffic is folded in via customizable variants like CRP (Customizable Route Planning) whose edge weights can be re-customized in minutes without redoing the full preprocessing.",
      },
      {
        id: "q3",
        question: "How is live traffic computed from GPS probes?",
        category: "scale",
        hint: "Map matching + windowed aggregation in a stream processor",
        answer:
          "Phones running navigation send anonymized GPS probes every few seconds. Raw GPS is noisy, so a map-matching step (classically an HMM that considers road connectivity and plausible speeds) snaps each probe sequence to specific road segments. A stream processor then aggregates per-segment speeds over ~30-60 second windows and writes them to a real-time speed store. ETAs blend this live layer with historical speed profiles per segment per time-of-day, so a road with no current probes still gets a sane estimate.",
      },
      {
        id: "q4",
        question: "Why might you use S2 cells instead of geohash?",
        category: "optimization",
        hint: "Sphere-aware hierarchical cells vs rectangular grid",
        answer:
          "Geohash divides the lat/lng rectangle, so cells shrink toward the poles and proximity queries must check up to 8 neighbor cells for points near edges. S2 projects the sphere onto a cube and indexes it with a hierarchical space-filling curve, giving roughly uniform-area cells at each of 30 levels and the ability to cover any region with a small union of cells at mixed levels. That makes 'all POIs in this viewport/radius' a set of efficient index range scans. Geohash remains fine for simple cases since it's a plain sortable string usable in any database.",
      },
      {
        id: "q5",
        question: "What happens to routing if the traffic pipeline goes down?",
        category: "failure",
        hint: "Degrade to historical speeds",
        answer:
          "Routing must not fail with traffic — edge weights fall back to historical time-of-day speed profiles (which are baked in and always available), and the UI drops the live-traffic overlay. Stale traffic data is bounded with TTLs so the router never trusts a 30-minute-old jam reading. This is graceful degradation: ETAs get less accurate, but routes still compute in the same latency budget.",
      },
      {
        id: "q6",
        question: "How do you scale routing across the globe?",
        category: "scale",
        hint: "Geographic graph partitioning + overlay graph",
        answer:
          "Partition the road graph geographically so each routing server holds a region in memory. Intra-region queries are served locally. For long routes, use a two-level scheme: a small overlay graph of boundary nodes and highways computes the macro route, and the origin/destination partitions compute the first and last miles. Cache popular origin-destination pairs (commute corridors) for instant answers, and replicate hot regions for throughput.",
      },
    ],
    referenceAPIs: [
      {
        method: "GET",
        path: "/api/v1/tiles/{z}/{x}/{y}.pbf",
        description: "Fetch a vector map tile (CDN-cached)",
        response: "Binary vector tile (Mapbox Vector Tile / protobuf format)",
      },
      {
        method: "GET",
        path: "/api/v1/directions?origin={lat,lng}&dest={lat,lng}&mode={driving|walking|transit}",
        description: "Compute a route with traffic-aware ETA",
        response:
          "{ routes: [{ polyline, distanceMeters, durationSec, durationInTrafficSec, steps: Step[] }] }",
      },
      {
        method: "GET",
        path: "/api/v1/geocode?address={query}",
        description: "Geocode an address to coordinates",
        response: "{ results: [{ lat, lng, formattedAddress, placeId }] }",
      },
      {
        method: "POST",
        path: "/api/v1/probes",
        description: "Ingest a batch of anonymized GPS probes from a navigating client",
        requestBody: "{ probes: [{ lat, lng, speed, heading, timestamp }] }",
        response: "{ accepted: number }",
      },
      {
        method: "GET",
        path: "/api/v1/places/autocomplete?q={prefix}&lat={lat}&lng={lng}",
        description: "Location-biased place autocomplete",
        response: "{ predictions: [{ placeId, description, distanceMeters }] }",
      },
    ],
    dataModel: [
      {
        name: "road_segments",
        type: "nosql",
        fields: [
          { name: "segment_id", type: "string" },
          { name: "geometry", type: "bytes", note: "Encoded polyline" },
          { name: "start_node", type: "string" },
          { name: "end_node", type: "string" },
          { name: "road_class", type: "enum", note: "motorway, primary, residential, ..." },
          { name: "speed_limit_kph", type: "int" },
          {
            name: "historical_speeds",
            type: "json",
            note: "Speed profile per day-of-week per time bucket",
          },
          { name: "one_way", type: "boolean" },
        ],
        partitionKey: "segment_id",
      },
      {
        name: "tile_metadata",
        type: "nosql",
        fields: [
          { name: "tile_key", type: "string", note: "z/x/y" },
          { name: "storage_url", type: "string", note: "Object storage path; served via CDN" },
          { name: "version", type: "int", note: "Bumped on re-render after map data edits" },
          { name: "rendered_at", type: "datetime" },
        ],
        partitionKey: "tile_key",
      },
      {
        name: "live_traffic",
        type: "cache",
        fields: [
          { name: "segment_id", type: "string", note: "Key" },
          {
            name: "current_speed_kph",
            type: "decimal",
            note: "Aggregated over last 30-60s window",
          },
          {
            name: "probe_count",
            type: "int",
            note: "Confidence — few probes = blend more historical",
          },
          { name: "updated_at", type: "datetime", note: "TTL ~5 min so stale jams expire" },
        ],
      },
      {
        name: "places_search",
        type: "search",
        fields: [
          { name: "place_id", type: "string" },
          { name: "name", type: "text" },
          { name: "location", type: "geo_point" },
          { name: "category", type: "keyword" },
          { name: "address", type: "text" },
          { name: "popularity", type: "long", note: "For ranking autocomplete" },
        ],
      },
    ],
    estimationHints: {
      dailyActiveUsers:
        "2B+ MAU; hundreds of millions of daily route requests and billions of tile fetches",
      readWriteRatio:
        "5:1 reads:writes — tile/route/search reads vs a heavy GPS probe ingestion stream (millions of navigating clients reporting every few seconds)",
      storagePerItem:
        "Road graph: 500M+ segments × ~200 bytes ≈ 100+ GB in memory per full replica; pre-rendered tile corpus is multi-PB across zoom levels",
      peakMultiplier:
        "2x during commute hours; 3-4x on holiday travel days (Thanksgiving, Diwali, Lunar New Year)",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 24. ZOOM
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "zoom",
    requirements: [
      {
        id: "r1",
        text: "Real-time audio/video meetings with up to 1000 participants",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Screen sharing at 1080p alongside camera feeds",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Cloud recording with server-side composition for playback",
        category: "functional",
        importance: "important",
      },
      {
        id: "r4",
        text: "Breakout rooms, waiting room, mute/remove host controls",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "In-meeting chat and reactions",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "PSTN dial-in (join by phone)",
        category: "functional",
        importance: "nice-to-have",
      },
      {
        id: "r7",
        text: "Glass-to-glass latency < 150ms for audio/video",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Tolerate 10-20% packet loss with graceful quality degradation",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Media encrypted in transit (DTLS-SRTP); optional E2E encryption mode",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "SFU vs MCU — which architecture do you choose and why?",
        category: "optimization",
        hint: "Forwarding packets vs decoding and mixing them",
        answer:
          "An MCU (Multipoint Control Unit) decodes every participant's stream and mixes them into one composite stream per receiver — clients are simple and receive a single stream, but the server burns enormous CPU on transcoding and adds latency. An SFU (Selective Forwarding Unit) forwards encrypted RTP packets without decoding — roughly 10x cheaper per participant and lower latency, at the cost of clients receiving multiple streams. Modern platforms choose SFU plus simulcast. MCU-style mixing survives in two places: PSTN dial-in (a phone can only receive one audio stream) and composing cloud recordings.",
      },
      {
        id: "q2",
        question: "How does simulcast solve the heterogeneous-bandwidth problem?",
        category: "optimization",
        hint: "Sender encodes multiple layers; SFU picks per receiver",
        answer:
          "Each sender encodes its video at ~3 quality layers (e.g., 180p, 360p, 720p) and sends all of them to the SFU. For every receiver, the SFU selects which layer of which sender to forward, based on (a) the receiver's available bandwidth, estimated via RTCP feedback / transport-wide congestion control, and (b) the tile size in the receiver's layout — a thumbnail in gallery view only needs 180p, while the pinned active speaker gets 720p. The sender pays a modest encoding overhead (~15-20% extra bandwidth) so the SFU never has to transcode.",
      },
      {
        id: "q3",
        question: "What does the WebRTC stack actually provide here?",
        category: "optimization",
        hint: "NAT traversal, encryption, codecs, loss recovery",
        answer:
          "WebRTC gives you: ICE with STUN/TURN for NAT traversal (with an SFU, clients usually just connect to the SFU's public address); DTLS for key exchange and SRTP for media encryption; Opus audio and VP8/H.264/AV1 video codecs; and loss resilience — jitter buffers, NACK-based retransmission, keyframe requests (PLI), and forward error correction. Congestion control (e.g., transport-wide-cc) continuously estimates bandwidth so senders adapt bitrate instead of inducing bufferbloat. Audio is prioritized over video because losing audio kills a meeting.",
      },
      {
        id: "q4",
        question:
          "How do you make a 1000-participant meeting feasible when N×N streams is impossible?",
        category: "scale",
        hint: "Forward only what's visible/audible",
        answer:
          "Never forward all streams to everyone — 1000×999 streams would melt everything. Each receiver subscribes only to visible tiles (25-49 in gallery view, 1-2 in speaker view), paginated as they scroll. For audio, the SFU runs active-speaker detection on audio-level headers and forwards only the loudest ~3-5 streams; everyone else's audio is not forwarded at all. Large meetings effectively degrade into a broadcast: a few active senders, everyone else receive-only (webinar mode makes this explicit).",
      },
      {
        id: "q5",
        question: "What happens when an SFU node dies mid-meeting?",
        category: "failure",
        hint: "Separate signaling/state from media; ICE restart",
        answer:
          "Keep meeting state (roster, host, mute states, breakout assignments) in a state service backed by Redis/DB — the SFU only routes media. Clients detect media loss within ~1-2 seconds (no packets, failed heartbeats); the signaling channel (WebSocket) assigns them a replacement SFU in the same region, and clients perform an ICE restart to reconnect. The meeting resumes within a few seconds with no state loss; participants see a brief freeze, not a dropped meeting.",
      },
      {
        id: "q6",
        question: "How do you run a global meeting without routing everyone through one region?",
        category: "scale",
        hint: "Cascaded SFUs over the backbone",
        answer:
          "Each participant connects to the nearest regional SFU (lowest first-hop latency). SFUs in the meeting form a server-to-server cascade over the provider's private backbone, forwarding only the streams actually subscribed across regions — typically the active speaker and pinned streams, not all participants. This cuts cross-region bandwidth by ~80% versus hub-and-spoke and keeps each user's media path short. Region assignment happens at join time via the meeting lookup service.",
      },
    ],
    referenceAPIs: [
      {
        method: "POST",
        path: "/api/v1/meetings",
        description: "Create a meeting",
        requestBody:
          "{ topic: string, scheduledAt?: ISO8601, settings: { waitingRoom: boolean, recordAuto: boolean } }",
        response: "{ meetingId, joinUrl, passcode }",
      },
      {
        method: "POST",
        path: "/api/v1/meetings/{meetingId}/join",
        description: "Join a meeting — returns media routing info",
        requestBody: "{ displayName: string, passcode: string }",
        response: "{ participantId, sfuEndpoint, iceServers: [], signalingToken }",
      },
      {
        method: "GET",
        path: "/api/v1/meetings/{meetingId}/participants",
        description: "Get the live roster",
        response: "{ participants: [{ participantId, displayName, audioMuted, videoOn, role }] }",
      },
      {
        method: "POST",
        path: "/api/v1/meetings/{meetingId}/recordings/start",
        description: "Start cloud recording (server-side composition)",
        response: "{ recordingId, status: 'recording' }",
      },
      {
        method: "POST",
        path: "/api/v1/meetings/{meetingId}/breakout-rooms",
        description: "Create breakout rooms and assign participants",
        requestBody: "{ rooms: [{ name: string, participantIds: string[] }] }",
        response: "{ rooms: [{ roomId, name }] }",
      },
    ],
    dataModel: [
      {
        name: "meetings",
        type: "sql",
        fields: [
          { name: "meeting_id", type: "string" },
          { name: "host_id", type: "string" },
          { name: "topic", type: "string" },
          { name: "status", type: "enum", note: "scheduled, live, ended" },
          { name: "settings", type: "json", note: "Waiting room, passcode, recording policy" },
          { name: "started_at", type: "datetime" },
          { name: "ended_at", type: "datetime" },
        ],
        indexes: ["host_id", "status"],
      },
      {
        name: "meeting_state",
        type: "cache",
        fields: [
          { name: "meeting_id", type: "string", note: "Key" },
          {
            name: "roster",
            type: "json",
            note: "participantId → { mute, video, role, breakoutRoom }",
          },
          {
            name: "active_speakers",
            type: "string[]",
            note: "Updated by SFU audio-level detection",
          },
          { name: "sfu_nodes", type: "string[]", note: "Cascaded SFU nodes serving this meeting" },
        ],
      },
      {
        name: "media_subscriptions",
        type: "cache",
        fields: [
          { name: "participant_id", type: "string" },
          {
            name: "sfu_node_id",
            type: "string",
            note: "Which SFU this participant is connected to",
          },
          {
            name: "subscribed_streams",
            type: "json",
            note: "senderId → simulcast layer (180p/360p/720p)",
          },
          {
            name: "bandwidth_estimate_kbps",
            type: "int",
            note: "From congestion control feedback",
          },
        ],
      },
      {
        name: "recordings",
        type: "nosql",
        fields: [
          { name: "recording_id", type: "string" },
          { name: "meeting_id", type: "string" },
          { name: "storage_url", type: "string", note: "Composed MP4 in object storage" },
          { name: "duration_sec", type: "int" },
          { name: "size_bytes", type: "bigint" },
          { name: "status", type: "enum", note: "recording, processing, ready" },
        ],
        partitionKey: "meeting_id",
      },
    ],
    estimationHints: {
      dailyActiveUsers: "300M daily meeting participants; millions of concurrent meetings at peak",
      readWriteRatio:
        "≈1:1 — media is symmetric (every active participant both sends and receives); control-plane reads (rosters) slightly exceed writes",
      storagePerItem:
        "Live media is never stored; a 1-hour 720p composed recording ≈ 1 GB. A 25-person video meeting moves ~50-100 GB/hour through SFUs without persisting any of it",
      peakMultiplier:
        "3x during business hours Mon-Thu, with sharp spikes at :00 and :30 as meetings start simultaneously",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 25. FOOD DELIVERY
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "food-delivery",
    requirements: [
      {
        id: "r1",
        text: "Browse nearby restaurants and menus with availability",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Place orders with payment; restaurant accepts with a prep-time estimate",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Dispatch: match each order to the best available driver (with batching)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Live order tracking with driver GPS and continuously updated ETA",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r5",
        text: "Three-way payment split: customer charge, restaurant payout, driver payout (base + tip)",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Ratings for restaurants and drivers",
        category: "functional",
        importance: "important",
      },
      {
        id: "r7",
        text: "Surge delivery fees per zone based on demand/supply",
        category: "functional",
        importance: "nice-to-have",
      },
      {
        id: "r8",
        text: "Driver GPS updates every 5 seconds while on an active delivery",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Dispatch decision within seconds of order acceptance",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r10",
        text: "Order state machine is consistent — no lost or duplicated state transitions",
        category: "non-functional",
        importance: "critical",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How does the dispatch system decide which driver gets an order?",
        category: "optimization",
        hint: "Global assignment problem per zone, not greedy nearest-driver",
        answer:
          "Greedy 'nearest driver' is locally optimal but globally bad — it can strand a far-away order with no good options. Instead, run a periodic batch assignment (every few seconds, per geographic zone): build a bipartite graph of pending orders × available drivers, with edge costs combining driver→restaurant travel time, food-ready time (so the driver doesn't wait), delivery deadline risk, and driver earnings fairness. Solve with a min-cost matching (Hungarian algorithm or an LP heuristic). Batching multiple orders onto one route uses a TSP-style heuristic, only when both orders still meet their promised windows.",
      },
      {
        id: "q2",
        question: "How do you predict the ETA shown to the customer?",
        category: "optimization",
        hint: "ETA = prep + pickup travel + delivery travel, each ML-estimated",
        answer:
          "Decompose: quoted ETA = restaurant prep time + driver travel to restaurant + handoff + drive to customer. Prep time is the hardest: predict it with a model per restaurant using time-of-day, current kitchen load (open orders), and item mix. Travel legs use live-traffic routing. Re-estimate continuously as real events arrive (restaurant confirmed, driver picked up, GPS progress) and push updates to the customer. Bias slightly pessimistic — being 5 minutes early delights customers; being 5 minutes late generates support tickets and refunds.",
      },
      {
        id: "q3",
        question: "Walk me through the order state machine. How do you keep it consistent?",
        category: "consistency",
        hint: "Single writer per order + idempotent, event-sourced transitions",
        answer:
          "States: created → paid → accepted_by_restaurant → preparing → ready_for_pickup → driver_assigned → picked_up → delivered, with cancelled/refunded branches and a compensation path (refund + driver release) from any failure. Transitions come from three actors (customer, restaurant, driver app), so guard them: each transition is an event processed through a queue partitioned by order_id — one consumer owns each order at a time, applying transitions with an allowed-transitions table (illegal jumps rejected) and idempotency keys (retries don't double-fire). Every transition is appended to an order_events log for audit and customer-support timelines.",
      },
      {
        id: "q4",
        question: "A driver picks up the food and goes dark. What happens?",
        category: "failure",
        hint: "Heartbeat timeout + escalation ladder",
        answer:
          "GPS updates double as heartbeats. If a driver on an active delivery stops reporting for ~2 minutes, flag the delivery at-risk: try push/SMS/phone contact, and show the customer an honest 'delay' state. If unreachable past a threshold before pickup, unassign and re-dispatch to another driver. After pickup, re-dispatch isn't possible — escalate to support, refund or re-order for the customer, and log the incident against the driver's record. The key design point: the order state machine must distinguish 'pre-pickup' (recoverable by reassignment) from 'post-pickup' (recoverable only by compensation).",
      },
      {
        id: "q5",
        question: "How do you handle the GPS ingestion load?",
        category: "scale",
        hint: "Hot path in Redis, durable path downsampled",
        answer:
          "~200K concurrent active drivers reporting every 5s = ~40K location writes/sec. Split the paths: the hot path writes latest position to Redis (GEOADD keyed per zone) — this serves dispatch and live tracking; the durable path streams updates through Kafka and persists a downsampled trail (e.g., 1 point per 30s) for ETA training data and dispute resolution. Customers tracking an order get pushes over WebSocket/SSE from the hot path — never poll the database.",
      },
      {
        id: "q6",
        question: "How does menu availability stay accurate when the kitchen is overwhelmed?",
        category: "consistency",
        hint: "Restaurant-controlled toggles + automatic throttling",
        answer:
          "Two mechanisms: restaurants can 86 items (mark sold out) from their tablet, which invalidates the cached menu within seconds; and the platform auto-throttles — if a restaurant's open-order count exceeds its modeled kitchen capacity, inflate its quoted prep times or temporarily mark it 'busy' (hidden from new orders). This prevents the classic failure mode of accepting orders the kitchen can't fulfill, which cascades into late deliveries and refunds.",
      },
    ],
    referenceAPIs: [
      {
        method: "GET",
        path: "/api/v1/restaurants?lat={lat}&lng={lng}",
        description: "List nearby restaurants with ETA and fees",
        response:
          "{ restaurants: [{ restaurantId, name, etaMinutes, deliveryFee, rating, isBusy }] }",
      },
      {
        method: "POST",
        path: "/api/v1/orders",
        description: "Place an order",
        requestBody:
          "{ restaurantId, items: [{ itemId, quantity, options }], address, tip, paymentMethodId }",
        response: "{ orderId, status: 'created', quotedEtaMinutes, total }",
      },
      {
        method: "GET",
        path: "/api/v1/orders/{orderId}/tracking",
        description: "Get live tracking state",
        response: "{ status, driverLocation?, etaMinutes, timeline: Event[] }",
      },
      {
        method: "PUT",
        path: "/api/v1/drivers/{driverId}/location",
        description: "Driver GPS update (every 5s)",
        requestBody: "{ lat, lng, heading, speed }",
        response: "{ success: boolean }",
      },
      {
        method: "POST",
        path: "/api/v1/orders/{orderId}/transitions",
        description: "Apply a state transition (restaurant/driver apps)",
        requestBody: "{ event: 'accept'|'ready'|'picked_up'|'delivered', actorId, idempotencyKey }",
        response: "{ orderId, status }",
      },
    ],
    dataModel: [
      {
        name: "orders",
        type: "sql",
        fields: [
          { name: "order_id", type: "uuid" },
          { name: "customer_id", type: "string" },
          { name: "restaurant_id", type: "string" },
          { name: "driver_id", type: "string", note: "Null until dispatched" },
          { name: "items", type: "json", note: "Snapshot of items + prices at order time" },
          {
            name: "status",
            type: "enum",
            note: "created, paid, accepted, preparing, ready, driver_assigned, picked_up, delivered, cancelled",
          },
          { name: "quoted_eta", type: "datetime" },
          { name: "totals", type: "json", note: "subtotal, fees, tip, payout splits" },
          { name: "created_at", type: "datetime" },
        ],
        indexes: ["customer_id", "restaurant_id", "driver_id", "status"],
      },
      {
        name: "order_events",
        type: "nosql",
        fields: [
          { name: "order_id", type: "string" },
          { name: "sequence", type: "int" },
          { name: "event", type: "string", note: "State transition with actor + idempotency key" },
          { name: "actor", type: "string", note: "customer, restaurant, driver, system" },
          { name: "timestamp", type: "datetime" },
        ],
        partitionKey: "order_id",
        indexes: ["sequence"],
      },
      {
        name: "driver_state",
        type: "cache",
        fields: [
          { name: "driver_id", type: "string" },
          { name: "location", type: "json", note: "Redis GEO set per zone, updated every 5s" },
          {
            name: "status",
            type: "enum",
            note: "offline, idle, en_route_to_restaurant, delivering",
          },
          { name: "active_order_ids", type: "string[]", note: "Supports batched deliveries" },
          { name: "last_heartbeat", type: "datetime" },
        ],
      },
      {
        name: "restaurants",
        type: "nosql",
        fields: [
          { name: "restaurant_id", type: "string" },
          { name: "name", type: "string" },
          { name: "location", type: "json" },
          { name: "menu", type: "json", note: "Items with prices, options, sold-out flags" },
          { name: "avg_prep_time_min", type: "decimal", note: "Model output, per time-of-day" },
          { name: "open_order_count", type: "int", note: "For kitchen-capacity throttling" },
          { name: "rating", type: "decimal" },
        ],
        partitionKey: "restaurant_id",
      },
    ],
    estimationHints: {
      dailyActiveUsers:
        "~42M MAU (37M+ all-time high reported Dec 2023, growing double-digit YoY); ~8M orders/day (DoorDash scale: 750M orders/quarter)",
      readWriteRatio:
        "2:1 reads:writes — menu browsing and tracking reads vs order events plus the GPS stream (~200K concurrent drivers × every 5s = 40K location writes/sec)",
      storagePerItem:
        "~2 KB per order + ~1 KB of state-transition events; 8M orders/day ≈ 25 GB/day; downsampled GPS trails dominate raw volume",
      peakMultiplier:
        "4x at meal times (12-1 PM, 6-9 PM local); weather events spike demand while shrinking driver supply",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 26. REDDIT
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "reddit",
    requirements: [
      {
        id: "r1",
        text: "Submit posts (text, link, media) to topic communities (subreddits)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Upvote/downvote posts and comments — one vote per user per item",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Nested comment trees with collapse and lazy 'load more'",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Feed sorts: hot, new, top (by window), controversial, best",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r5",
        text: "/r/all and home feed aggregating across subscribed communities",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Moderation tools: remove, lock, ban, automod rules",
        category: "functional",
        importance: "important",
      },
      {
        id: "r7",
        text: "Full-text search with subreddit and time filters",
        category: "functional",
        importance: "nice-to-have",
      },
      {
        id: "r8",
        text: "Feed load < 200ms at p99; vote acknowledgment instant",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Vote manipulation resistance (rate limits, fuzzing, ring detection)",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "Explain Reddit's hot ranking formula precisely.",
        category: "optimization",
        hint: "Sign applies to the log term; the time term only grows",
        answer:
          "score = sign(s) × log10(max(|s|, 1)) + (t − 1134028003) / 45000, where s = upvotes − downvotes and t is the post's creation time in epoch seconds (1134028003 is Reddit's epoch, Dec 8, 2005). The sign multiplies the log term only — a net-negative post gets a vote penalty, but its time term still grows like everyone else's. Votes count logarithmically: 10x the net votes adds just one point, and every 45,000 seconds (12.5 hours) of newness is also worth exactly one point — i.e., a newer post beats an older one unless the older one has 10x the net votes per 12.5h of age difference. Because t is the creation time, a post's score only changes when votes change — so you compute it on each vote and keep feeds in sorted sets (Redis ZSET) per subreddit, no periodic decay job needed.",
      },
      {
        id: "q2",
        question: "How do you store and render comment trees with 50K nested comments?",
        category: "optimization",
        hint: "parent_id + materialized path; never load the whole tree",
        answer:
          "Store each comment with parent_id and a materialized path (e.g., 'a3f.b72.c19') so any subtree is a prefix range query. Never render the full tree: load the top ~200 comments by the chosen sort, depth-limited; deeper branches and remaining siblings become 'load more comments' stubs that resolve on demand. Rank sibling comments by 'best' — the Wilson score lower bound — and cache the rendered tree skeleton for hot posts, invalidating incrementally as comments arrive.",
      },
      {
        id: "q3",
        question: "How do you enforce one vote per user and handle vote changes?",
        category: "consistency",
        hint: "Unique (user, thing) row; apply deltas",
        answer:
          "Votes live in a table keyed (user_id, thing_id) with a unique constraint and a direction (+1, 0, −1). A new vote inserts; changing your vote updates the same row and applies the delta to the cached counters (e.g., +1 → −1 applies −2). The unique key makes double-voting impossible regardless of retries. Counters are cached in Redis and flushed to the store asynchronously; displayed scores are 'fuzzed' (slightly jittered) so manipulators can't verify whether their bot votes landed.",
      },
      {
        id: "q4",
        question:
          "A post hits the front page and gets 10K votes/minute. How does the write path survive?",
        category: "scale",
        hint: "Queue + batched counter updates",
        answer:
          "Acknowledge the vote immediately after the unique-key write, then push a vote event to a queue. Consumers batch-aggregate deltas per post (e.g., fold 1000 events into one counter update) and update the hot-score and the subreddit's sorted feed. The displayed count is the cached value, eventually consistent within seconds. This turns 10K row-contention updates/minute on one post into a handful of batched updates while the authoritative per-user vote rows remain exact.",
      },
      {
        id: "q5",
        question: "How does /r/all avoid being dominated by the biggest subreddits?",
        category: "optimization",
        hint: "Normalize scores within each community",
        answer:
          "Raw hot scores aren't comparable across communities — a top post in a 1M-subscriber subreddit dwarfs a 5K-subscriber one. For /r/all, normalize each post's score relative to its own subreddit's typical top scores (or take each community's top-N with per-community caps), then interleave. This keeps niche communities visible. Users' home feeds do the same merge but only over subscribed subreddits, blended with light personalization.",
      },
      {
        id: "q6",
        question: "How do you detect vote manipulation rings?",
        category: "security",
        hint: "Graph analysis + behavioral signals",
        answer:
          "Look for correlated voting: accounts that repeatedly vote on the same authors' content within minutes, share device fingerprints/IP ranges, or were created in bursts. Build a bipartite voter→author graph and flag dense clusters with abnormal reciprocity. Mitigations: discount suspicious votes silently (don't tell the attacker), require email/age/karma thresholds for vote weight in sensitive communities, rate-limit voting per account, and fuzz displayed scores so attackers can't measure their own effectiveness.",
      },
    ],
    referenceAPIs: [
      {
        method: "POST",
        path: "/api/v1/subreddits/{subreddit}/posts",
        description: "Submit a post",
        requestBody: "{ title: string, kind: 'text'|'link'|'media', body?: string, url?: string }",
        response: "{ postId, createdAt }",
      },
      {
        method: "POST",
        path: "/api/v1/things/{thingId}/vote",
        description: "Vote on a post or comment",
        requestBody: "{ direction: 1 | 0 | -1 }",
        response: "{ success: boolean, score: number }",
      },
      {
        method: "GET",
        path: "/api/v1/subreddits/{subreddit}/feed?sort={hot|new|top|controversial}&t={hour|day|week|all}",
        description: "Get a ranked feed",
        response: "{ posts: Post[], after: string }",
      },
      {
        method: "GET",
        path: "/api/v1/posts/{postId}/comments?sort=best&depth=10",
        description: "Get the comment tree (depth-limited)",
        response: "{ comments: CommentNode[], moreStubs: [{ parentId, count }] }",
      },
      {
        method: "POST",
        path: "/api/v1/posts/{postId}/comments",
        description: "Add a comment",
        requestBody: "{ parentId?: string, body: string }",
        response: "{ commentId, path }",
      },
    ],
    dataModel: [
      {
        name: "posts",
        type: "nosql",
        fields: [
          { name: "post_id", type: "string" },
          { name: "subreddit_id", type: "string" },
          { name: "author_id", type: "string" },
          { name: "title", type: "string" },
          { name: "body", type: "text" },
          { name: "ups", type: "int" },
          { name: "downs", type: "int" },
          {
            name: "hot_score",
            type: "double",
            note: "sign(s)·log10(max(|s|,1)) + (t−1134028003)/45000",
          },
          { name: "comment_count", type: "int" },
          { name: "created_at", type: "datetime" },
        ],
        partitionKey: "subreddit_id",
        indexes: ["hot_score", "created_at"],
      },
      {
        name: "comments",
        type: "nosql",
        fields: [
          { name: "comment_id", type: "string" },
          { name: "post_id", type: "string" },
          { name: "parent_id", type: "string", note: "Null for top-level" },
          { name: "path", type: "string", note: "Materialized path for subtree range queries" },
          { name: "author_id", type: "string" },
          { name: "body", type: "text" },
          { name: "ups", type: "int" },
          { name: "downs", type: "int" },
          { name: "created_at", type: "datetime" },
        ],
        partitionKey: "post_id",
        indexes: ["path"],
      },
      {
        name: "votes",
        type: "sql",
        fields: [
          { name: "user_id", type: "string" },
          { name: "thing_id", type: "string", note: "Post or comment ID" },
          { name: "direction", type: "int", note: "+1, 0, -1" },
          { name: "updated_at", type: "datetime" },
        ],
        indexes: ["user_id + thing_id (unique)"],
      },
      {
        name: "feed_cache",
        type: "cache",
        fields: [
          {
            name: "feed:{subreddit}:{sort}",
            type: "string",
            note: "Redis ZSET: post_id scored by hot/top score",
          },
          {
            name: "counts:{thing_id}",
            type: "json",
            note: "Cached ups/downs, flushed asynchronously",
          },
        ],
      },
    ],
    estimationHints: {
      dailyActiveUsers:
        "~120M daily active uniques (DAUq, Q4 2025); ~500K posts/day, tens of millions of votes and comments/day",
      readWriteRatio:
        "10:1 reads:writes — feed and comment reads dominate; votes are the highest-volume write",
      storagePerItem:
        "~1 KB per post, ~500 bytes per comment, ~50 bytes per vote row; vote rows dominate row count (billions)",
      peakMultiplier:
        "3x during US evenings; 10x on individual posts during major events (elections, AMAs, breaking news)",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 27. AIRBNB
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "airbnb",
    requirements: [
      {
        id: "r1",
        text: "Search listings by location, date range, guest count, price, amenities",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Listing pages with photos, reviews, and an availability calendar",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Booking flow: hold dates → pay → confirm",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Host calendar management: block dates, set per-date pricing",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r5",
        text: "Bilateral reviews revealed simultaneously after both submit (or 14-day window)",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Dynamic pricing suggestions for hosts",
        category: "functional",
        importance: "nice-to-have",
      },
      {
        id: "r7",
        text: "Multi-currency: guest pays in their currency, host paid in theirs",
        category: "functional",
        importance: "important",
      },
      {
        id: "r8",
        text: "A date can NEVER be double-booked, under any concurrency",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Search results < 200ms at p95",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r10",
        text: "Payments idempotent end-to-end",
        category: "non-functional",
        importance: "critical",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How do you model listing availability?",
        category: "optimization",
        hint: "One row per listing per date + a bitmap for search",
        answer:
          "Authoritative store: a calendar_days table with one row per (listing_id, date) holding status (available/blocked/booked) and that night's price — a 5-night booking touches exactly 5 rows in one transaction. For search, that's too slow to join, so each listing also carries a 365-bit availability bitmap in the search index: checking 'free for Mar 3-8' is a bitwise AND against the stay's mask. The bitmap is a denormalized copy updated asynchronously — search may be seconds stale, which is fine because the booking transaction re-validates against the SQL rows.",
      },
      {
        id: "q2",
        question:
          "Two guests hit 'book' for the same dates at the same moment. Walk me through why exactly one succeeds.",
        category: "consistency",
        hint: "Redis hold for UX; the database transaction is the arbiter",
        answer:
          "Two layers. Layer 1 (UX): entering checkout takes a Redis hold (SET NX with 15-min TTL) on listing+dates so the second guest sees 'someone else is booking' instead of failing after entering card details. Layer 2 (correctness): the confirm step runs a SQL transaction that locks the exact date rows (SELECT ... FOR UPDATE on calendar_days WHERE listing_id = X AND date IN (...)), verifies every row is still 'available', then flips them to 'booked' and inserts the booking. If both guests somehow reach this step, row locks serialize them and the second transaction sees non-available rows and aborts. The cache is for experience; the database constraint is the guarantee — never the reverse.",
      },
      {
        id: "q3",
        question: "How does search handle 'Paris, May 12-15, 2 guests, under $200, with washer'?",
        category: "scale",
        hint: "Inverted index with geo + bitmap availability + facets",
        answer:
          "Elasticsearch-style index: geo query for the map area, range filter on price, term filters on amenities and capacity, and the availability bitmap check for the date span. That retrieval stage returns ~1000 candidates cheaply; a second-stage ML ranker then scores them (listing quality, host responsiveness, price competitiveness vs comparables, predicted booking probability) and returns the top page. Index updates flow asynchronously from booking/calendar events — the brief staleness is acceptable since booking re-validates.",
      },
      {
        id: "q4",
        question: "How do dynamic pricing suggestions work?",
        category: "optimization",
        hint: "Comparables + seasonality + demand signals, host keeps control",
        answer:
          "For each listing+date, estimate the price that maximizes expected revenue = price × P(booked at that price). Features: comparable listings nearby (similar capacity/quality), seasonality curves, day-of-week, lead time, local events (concerts, conferences inflate demand), and current search-to-booking conversion in the area. Hosts set guardrails (min/max price) and the system fills in per-date suggestions. Crucially, it's a suggestion engine, not auto-pricing — hosts opt in (Smart Pricing) and retain override control.",
      },
      {
        id: "q5",
        question: "Why are reviews revealed simultaneously, and how do you implement that?",
        category: "consistency",
        hint: "Hidden until both submit or the window closes",
        answer:
          "If a guest could read the host's review before writing their own, reviews become retaliatory or reciprocal-inflated. So both reviews are stored hidden; they're revealed only when both parties have submitted or a 14-day window expires (then whatever exists is published). Implementation: review rows carry a visible flag; a check on each submit (and a scheduled job for window expiry) flips both to visible atomically. Edits are locked after reveal.",
      },
      {
        id: "q6",
        question: "Payment is captured but the booking-confirm write fails. Now what?",
        category: "failure",
        hint: "Saga with idempotency and reconciliation",
        answer:
          "The booking flow is a saga: hold dates → authorize/capture payment → confirm booking → notify. Each step is idempotent (the payment uses an idempotency key derived from the booking attempt). If confirm fails after capture, retry confirm — the dates are still held and the capture is recorded. If confirm cannot succeed (host cancelled, listing deactivated), run the compensating action: refund the capture and release the hold. A reconciliation job continuously sweeps for captured-but-unconfirmed payments older than a threshold and forces them down one path or the other — money and bookings must never disagree silently.",
      },
    ],
    referenceAPIs: [
      {
        method: "GET",
        path: "/api/v1/listings/search?lat={lat}&lng={lng}&checkin={date}&checkout={date}&guests={n}&filters={...}",
        description: "Search listings with availability for a date range",
        response:
          "{ listings: [{ listingId, name, pricePerNight, totalPrice, rating, photos }], nextCursor }",
      },
      {
        method: "GET",
        path: "/api/v1/listings/{listingId}/calendar?from={date}&to={date}",
        description: "Get per-date availability and pricing",
        response: "{ days: [{ date, status, price }] }",
      },
      {
        method: "POST",
        path: "/api/v1/bookings/hold",
        description: "Hold dates during checkout (15-min TTL)",
        requestBody: "{ listingId, checkin, checkout, guests }",
        response: "{ holdId, expiresAt, totalPrice }",
      },
      {
        method: "POST",
        path: "/api/v1/bookings",
        description: "Confirm booking with payment",
        requestBody: "{ holdId, paymentMethodId, idempotencyKey }",
        response: "{ bookingId, status: 'confirmed', confirmationCode }",
      },
      {
        method: "PUT",
        path: "/api/v1/listings/{listingId}/calendar",
        description: "Host blocks dates or sets prices",
        requestBody: "{ days: [{ date, status?: 'blocked'|'available', price?: number }] }",
        response: "{ updated: number }",
      },
    ],
    dataModel: [
      {
        name: "listings",
        type: "nosql",
        fields: [
          { name: "listing_id", type: "string" },
          { name: "host_id", type: "string" },
          { name: "title", type: "string" },
          { name: "location", type: "json", note: "lat/lng + address" },
          { name: "capacity", type: "int" },
          { name: "amenities", type: "string[]" },
          { name: "base_price", type: "decimal" },
          { name: "rating", type: "decimal" },
          { name: "photo_urls", type: "string[]" },
        ],
        partitionKey: "listing_id",
      },
      {
        name: "calendar_days",
        type: "sql",
        fields: [
          { name: "listing_id", type: "string" },
          { name: "date", type: "date" },
          { name: "status", type: "enum", note: "available, blocked, booked" },
          { name: "price", type: "decimal", note: "Per-night price for this date" },
          { name: "booking_id", type: "string", note: "Set when booked" },
        ],
        indexes: ["listing_id + date (unique)", "booking_id"],
      },
      {
        name: "bookings",
        type: "sql",
        fields: [
          { name: "booking_id", type: "uuid" },
          { name: "listing_id", type: "string" },
          { name: "guest_id", type: "string" },
          { name: "checkin", type: "date" },
          { name: "checkout", type: "date" },
          { name: "status", type: "enum", note: "pending, confirmed, cancelled, completed" },
          { name: "total_amount", type: "bigint", note: "Minor units + currency code" },
          { name: "payment_id", type: "string" },
          { name: "created_at", type: "datetime" },
        ],
        indexes: ["listing_id", "guest_id", "status"],
      },
      {
        name: "listings_search",
        type: "search",
        fields: [
          { name: "listing_id", type: "string" },
          { name: "location", type: "geo_point" },
          { name: "price_per_night", type: "long" },
          { name: "capacity", type: "int" },
          { name: "amenities", type: "keyword[]" },
          {
            name: "availability_bitmap",
            type: "bytes",
            note: "365-bit mask for fast date-range intersection",
          },
          { name: "quality_score", type: "double", note: "Input to second-stage ranking" },
        ],
      },
    ],
    estimationHints: {
      dailyActiveUsers: "~5M DAU searching and browsing; ~1M nights booked/day across 7M+ listings",
      readWriteRatio:
        "100:1 reads:writes — hundreds of searches and listing views per completed booking",
      storagePerItem:
        "Calendar: 7M listings × 365 day-rows ≈ 2.6B rows (~100 bytes each ≈ 260 GB); ~2 KB per booking; photos dominate raw bytes (object storage + CDN)",
      peakMultiplier:
        "3x during January planning season and Sunday evenings; event-driven spikes per city (Olympics, festivals)",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 28. WHATSAPP
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "whatsapp",
    requirements: [
      {
        id: "r1",
        text: "1:1 and group messaging (up to 1024 members), E2E encrypted",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Offline delivery — store-and-forward until the recipient reconnects",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Delivery receipts: sent (one tick), delivered (two ticks), read (blue ticks)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Multi-device: phone + up to 4 linked devices, each independently encrypted",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Media sharing (images, video, documents) encrypted client-side",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Typing indicators and last-seen presence (ephemeral, never stored)",
        category: "functional",
        importance: "nice-to-have",
      },
      {
        id: "r7",
        text: "Server must never be able to read message content (E2E)",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Strict per-conversation message ordering on every device",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Sustain 100B messages/day (~1.2M writes/sec average)",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r10",
        text: "Online delivery latency < 100ms",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question:
          "Explain the Signal protocol at a high level. What do X3DH and the Double Ratchet each give you?",
        category: "security",
        hint: "Async session setup + per-message key evolution",
        answer:
          "X3DH (Extended Triple Diffie-Hellman) establishes a shared secret with someone who is offline: each user uploads a bundle of public keys to the server — an identity key, a signed prekey, and one-time prekeys. A sender fetches the recipient's bundle and combines several DH operations to derive a session key, so the first message can be sent without the recipient online. The Double Ratchet then evolves keys continuously: a symmetric KDF chain gives every single message a fresh key (forward secrecy — compromising today's key can't decrypt yesterday's messages), and a DH ratchet on each round trip heals future traffic after a compromise (post-compromise security). The server only ever stores public keys and ciphertext — it cannot decrypt anything.",
      },
      {
        id: "q2",
        question: "How do you guarantee message ordering within a conversation?",
        category: "consistency",
        hint: "Server-assigned per-conversation sequence numbers, never client clocks",
        answer:
          "Client timestamps can't be trusted (clock skew, manipulation), so order is defined by a per-conversation monotonic sequence number assigned at the server when the message is accepted (atomic counter per conversation, e.g., Redis INCR or the partition's log order). Devices render strictly by sequence number, buffer out-of-order arrivals briefly, detect gaps (got 41, 43 → request 42), and pull missing messages from their queue. This same sequence number is the sync cursor for offline catch-up — ordering and reliable delivery share one mechanism.",
      },
      {
        id: "q3",
        question: "Walk me through the receipt state machine for the ticks.",
        category: "consistency",
        hint: "Monotonic states; receipts are idempotent and can arrive out of order",
        answer:
          "Per message per recipient: pending (in the sender's outbox, clock icon) → sent (server accepted it — one gray tick) → delivered (the recipient's device acked receipt — two gray ticks) → read (recipient opened the chat — two blue ticks). Receipts are tiny reverse-direction messages. Two rules make it robust: states only move forward (a 'delivered' receipt arriving after 'read' is ignored — apply max(current, incoming)), and receipts are idempotent, so retries are harmless. In groups, the sender's tick shows the aggregate minimum (delivered when ALL members' devices acked; read when all read) with a per-member detail view. Read receipts respect the privacy toggle; delivered receipts don't, since they reflect transport, not behavior.",
      },
      {
        id: "q4",
        question: "How does offline delivery work at this scale?",
        category: "scale",
        hint: "Per-device durable queues drained by sequence cursor",
        answer:
          "Store-and-forward: every message is appended to a durable per-device queue (the server can't store 'the conversation' in plaintext — it stores undelivered ciphertext per recipient device). When a device connects, it presents its last-received cursor per conversation and the server drains its queue in sequence order; each delivered message is acked and deleted from the queue — the server is a relay, not an archive. Queues have a TTL (~30 days); push notifications (APNS/FCM) wake mobile clients so 'offline' is usually seconds. History backup is a separate, client-driven encrypted backup, not a server-side message store.",
      },
      {
        id: "q5",
        question: "Group messages: how do you avoid encrypting the same message 1024 times?",
        category: "optimization",
        hint: "Sender Keys — encrypt once, fan out ciphertext",
        answer:
          "With pairwise sessions, sending to a 1024-member group would mean 1024 encryptions and uploads. Sender Keys fixes this: each member generates a 'sender key' and distributes it once to every other member via their pairwise encrypted channels. A group message is then encrypted once with the sender key, and the server fans out identical ciphertext to all members' queues. Membership changes are the cost: when someone leaves (or is removed), everyone rotates sender keys so the departed member can't read future messages.",
      },
      {
        id: "q6",
        question: "How does multi-device work without breaking E2E encryption?",
        category: "security",
        hint: "Each device is an independent Signal client",
        answer:
          "Each linked device (phone, desktop, web) has its own identity key and its own Signal sessions — there's no shared key escrow and the server still can't read anything. Sending to a user means encrypting the message separately for each of their registered devices (client-fanout: a contact with 4 devices = 4 ciphertexts), and your own other devices get a self-addressed copy too. The server maintains per-device queues and delivers independently, so your desktop works even when your phone is off. Device linking is authenticated by QR-scanning a key-verification payload from the primary phone.",
      },
    ],
    referenceAPIs: [
      {
        method: "POST",
        path: "/api/v1/messages",
        description:
          "Send an encrypted message (one ciphertext per recipient device for 1:1; sender-key ciphertext for groups)",
        requestBody: "{ conversationId, payloads: [{ deviceId, ciphertext }], mediaRef?: string }",
        response: "{ messageId, sequenceNumber, serverTimestamp }",
      },
      {
        method: "GET",
        path: "/api/v1/sync?cursors={conversationId:seq,...}",
        description: "Drain queued messages since last-known sequence numbers",
        response: "{ messages: [{ conversationId, sequenceNumber, ciphertext }], cursors }",
      },
      {
        method: "POST",
        path: "/api/v1/receipts",
        description: "Send delivery/read receipts",
        requestBody: "{ receipts: [{ messageId, type: 'delivered'|'read' }] }",
        response: "{ success: boolean }",
      },
      {
        method: "GET",
        path: "/api/v1/users/{userId}/prekeys",
        description: "Fetch a prekey bundle to start an X3DH session (consumes a one-time prekey)",
        response: "{ identityKey, signedPrekey, oneTimePrekey?, deviceId }",
      },
      {
        method: "POST",
        path: "/api/v1/media",
        description:
          "Upload client-side-encrypted media blob; decryption key travels inside the E2E message",
        requestBody: "Encrypted binary",
        response: "{ mediaRef, size }",
      },
    ],
    dataModel: [
      {
        name: "device_message_queues",
        type: "nosql",
        fields: [
          { name: "device_id", type: "string" },
          { name: "conversation_id", type: "string" },
          {
            name: "sequence_number",
            type: "bigint",
            note: "Per-conversation monotonic — defines ordering and sync cursor",
          },
          { name: "ciphertext", type: "bytes", note: "Server never sees plaintext" },
          {
            name: "expires_at",
            type: "datetime",
            note: "TTL ~30 days; deleted immediately on delivery ack",
          },
        ],
        partitionKey: "device_id",
        indexes: ["conversation_id + sequence_number"],
      },
      {
        name: "prekey_store",
        type: "nosql",
        fields: [
          { name: "user_id", type: "string" },
          { name: "device_id", type: "string" },
          { name: "identity_key", type: "bytes", note: "Public only" },
          { name: "signed_prekey", type: "bytes" },
          {
            name: "one_time_prekeys",
            type: "bytes[]",
            note: "Each consumed once by X3DH; replenished by client",
          },
        ],
        partitionKey: "user_id",
      },
      {
        name: "message_status",
        type: "nosql",
        fields: [
          { name: "message_id", type: "string" },
          { name: "recipient_device_id", type: "string" },
          { name: "state", type: "enum", note: "sent, delivered, read — monotonic, apply max()" },
          { name: "updated_at", type: "datetime" },
        ],
        partitionKey: "message_id",
      },
      {
        name: "connection_registry",
        type: "cache",
        fields: [
          { name: "device_id", type: "string", note: "Key, TTL-based presence" },
          {
            name: "gateway_server_id",
            type: "string",
            note: "Which WebSocket gateway holds the connection",
          },
          { name: "last_seen_at", type: "datetime" },
        ],
      },
    ],
    estimationHints: {
      dailyActiveUsers: "3B MAU; 100B messages/day ≈ 1.2M message writes/sec average",
      readWriteRatio:
        "≈2:1 reads:writes — ~2.4M reads/sec vs ~1.2M writes/sec; every message is read on at least one device, and group fan-out plus multi-device delivery multiply reads",
      storagePerItem:
        "~300 bytes of ciphertext per message, but storage is transient — delivered messages are deleted from server queues; only undelivered backlog persists",
      peakMultiplier:
        "2x in regional evenings; New Year's midnight is the historic record spike (per-second message peaks far above daily average)",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 29. SEARCH ENGINE
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "search-engine",
    requirements: [
      {
        id: "r1",
        text: "Crawl and index billions of web pages continuously",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Keyword queries with spell correction and synonym expansion",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Relevance ranking combining link authority (PageRank) and text relevance (BM25)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Snippet generation — show the most relevant fragment per result",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Freshness tier — news pages searchable within minutes",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Pagination and per-site grouping of results",
        category: "functional",
        importance: "nice-to-have",
      },
      {
        id: "r7",
        text: "Query latency < 200ms at p99 over a 100B+ page index",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Serve ~8.5B searches/day (~100K average QPS)",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Index updates must not disrupt serving (atomic segment swaps)",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "What exactly is an inverted index and how is it laid out?",
        category: "optimization",
        hint: "term → compressed postings list; sharded by document",
        answer:
          "A forward index maps document → words; an inverted index flips it: each term maps to a postings list of (docID, term frequency, positions). Postings are sorted by docID, delta-encoded, and compressed (variable-byte or PForDelta) — compression matters because postings for common terms span millions of entries. Positions enable phrase queries ('new york' as adjacent terms). Shard by document: each shard holds the complete index for its subset of pages, so any query can be answered shard-locally and merged — versus term-sharding, which breaks multi-term intersection across shards.",
      },
      {
        id: "q2",
        question: "Explain PageRank — the formula and how you'd compute it at scale.",
        category: "optimization",
        hint: "Random surfer; iterate to convergence offline",
        answer:
          "PageRank models a random surfer: PR(p) = (1−d)/N + d × Σ PR(q)/outdegree(q), summed over pages q linking to p, with damping d ≈ 0.85 (the surfer follows links 85% of the time, jumps randomly 15%). A link is a weighted vote — votes from important pages with few outlinks count most. Compute it offline over the 100B+ node link graph with iterative matrix-vector multiplication (MapReduce/Pregel style), converging in roughly 40-50 iterations; handle dangling nodes by redistributing their mass. Crucially, PageRank is one static, query-independent feature among hundreds in ranking — not the ranking itself.",
      },
      {
        id: "q3",
        question: "Walk me through the full crawl → index → serve pipeline.",
        category: "scale",
        hint: "Offline index building; atomic swap into serving",
        answer:
          "Crawl: a URL frontier prioritizes by authority, freshness, and change frequency; fetchers respect robots.txt and politeness; content is deduped (SimHash) and stored. Index: parsers extract text, links, and metadata; the link graph feeds PageRank; indexers build immutable inverted-index segments offline, which are validated and then atomically swapped into the serving fleet — serving never sees a half-built index. Serve: query → spell-correct/expand → scatter to all shards → each shard retrieves and scores its top-k → aggregator merges, re-ranks, fetches snippets. News bypasses the batch path via a small 'fresh tier' index updated in minutes and merged at query time.",
      },
      {
        id: "q4",
        question: "Why two-phase ranking instead of scoring everything with the best model?",
        category: "optimization",
        hint: "Cheap retrieval over billions; expensive model over hundreds",
        answer:
          "The best ranking models (learned, hundreds of features) cost milliseconds per document — you cannot run them on a billion matches. Phase 1 (retrieval) uses cheap, index-friendly scoring — BM25, which rewards term frequency with diminishing returns, rarity (IDF), and penalizes long documents — to pull the top ~1000 candidates per shard. Phase 2 (re-ranking) runs the expensive ML model over only the merged few-thousand candidates, using PageRank, click-through statistics, freshness, and query-document embedding similarity. This funnel shape — cheap-and-broad then expensive-and-narrow — is the universal pattern in search and recommendations.",
      },
      {
        id: "q5",
        question: "How do you keep p99 under 200ms when one slow shard can stall the whole query?",
        category: "failure",
        hint: "Hedging, timeouts, partial results",
        answer:
          "Scatter-gather makes tail latency multiplicative: with 1000 shards, a 1-in-1000 slow response happens nearly every query. Mitigations: per-shard timeout budgets with partial results (drop straggler shards — losing 1% of the corpus rarely changes the top 10); hedged requests (send a duplicate to a replica if no answer within p95 and take the first response); replicas per shard for load spreading; and a result cache in front — query frequency is Zipfian, so caching the top queries absorbs 30%+ of traffic before any shard is touched.",
      },
      {
        id: "q6",
        question: "How do you fight SEO spam and link farms?",
        category: "security",
        hint: "Trust propagation + penalize manipulated signals",
        answer:
          "Link farms inflate PageRank with dense artificial link clusters. Countermeasures: TrustRank-style propagation from a manually verified seed set of trusted sites (spam is far from trusted seeds in the link graph); statistical detection of abnormal link patterns (reciprocal rings, sudden link-velocity spikes, irrelevant-topic links); discounting paid/footer/boilerplate links; and content-quality classifiers for keyword stuffing and doorway pages. Penalties are applied as ranking demotions and graph-edge discounts, and detection signals are kept secret to slow adversarial adaptation.",
      },
    ],
    referenceAPIs: [
      {
        method: "GET",
        path: "/api/v1/search?q={query}&start={offset}&num={count}",
        description: "Run a search query",
        response:
          "{ results: [{ url, title, snippet, rank }], totalEstimate, latencyMs, correctedQuery? }",
      },
      {
        method: "GET",
        path: "/api/v1/suggest?q={prefix}",
        description: "Query autocomplete suggestions",
        response: "{ suggestions: string[] }",
      },
      {
        method: "POST",
        path: "/internal/v1/index/segments",
        description: "Publish a new index segment to the serving fleet (atomic swap)",
        requestBody: "{ shardId, segmentUrl, docCount, checksum }",
        response: "{ activated: boolean }",
      },
      {
        method: "GET",
        path: "/api/v1/search/news?q={query}",
        description: "Search the fresh tier (recent pages only)",
        response: "{ results: Result[], freshestDocAgeSec }",
      },
    ],
    dataModel: [
      {
        name: "inverted_index_segments",
        type: "nosql",
        fields: [
          { name: "shard_id", type: "string" },
          { name: "term", type: "string" },
          {
            name: "postings",
            type: "bytes",
            note: "Delta-encoded, compressed (docID, tf, positions) list",
          },
          { name: "doc_frequency", type: "int", note: "For IDF in BM25" },
          { name: "segment_version", type: "int", note: "Immutable segments, atomically swapped" },
        ],
        partitionKey: "shard_id",
      },
      {
        name: "document_store",
        type: "nosql",
        fields: [
          { name: "doc_id", type: "bigint" },
          { name: "url", type: "string" },
          { name: "title", type: "string" },
          {
            name: "body_for_snippets",
            type: "text",
            note: "Used to extract the matching fragment at serve time",
          },
          { name: "pagerank", type: "double", note: "Precomputed offline, refreshed periodically" },
          { name: "crawl_timestamp", type: "datetime" },
          { name: "language", type: "string" },
        ],
        partitionKey: "doc_id",
      },
      {
        name: "link_graph",
        type: "nosql",
        fields: [
          { name: "doc_id", type: "bigint" },
          {
            name: "outlinks",
            type: "bigint[]",
            note: "Adjacency list — input to PageRank iterations",
          },
          {
            name: "anchor_texts",
            type: "json",
            note: "Anchor text is a strong relevance signal for the TARGET page",
          },
        ],
        partitionKey: "doc_id",
      },
      {
        name: "query_result_cache",
        type: "cache",
        fields: [
          {
            name: "normalized_query",
            type: "string",
            note: "Cache key (lowercased, sorted filters)",
          },
          {
            name: "result_page",
            type: "json",
            note: "Top results + snippets, TTL minutes (shorter for newsy queries)",
          },
          { name: "hit_count", type: "int" },
        ],
      },
    ],
    estimationHints: {
      dailyActiveUsers: "~8.5B searches/day ≈ ~100K average QPS (250K+ at peak)",
      readWriteRatio:
        "10:1 reads:writes — queries vs continuous index updates flowing from the crawl pipeline (tens of thousands of docs/sec)",
      storagePerItem:
        "Inverted index ≈ 10-30% of corpus text size; with a multi-hundred-PB crawled corpus, the serving index is tens of PB across thousands of shards (plus replicas)",
      peakMultiplier:
        "2x during global daytime overlap; sharp topical spikes on breaking news absorbed largely by the result cache",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 30. LOCATION SERVICE (YELP)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "location-service",
    requirements: [
      {
        id: "r1",
        text: "Find businesses within a radius, filtered by category, price, rating, open-now",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Business detail pages: hours, photos, menu, reviews",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Submit reviews with ratings; aggregate scores update",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Autocomplete for business names/categories, biased to user location",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Photo uploads with moderation and CDN delivery",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Busy-times estimates from check-in data",
        category: "functional",
        importance: "nice-to-have",
      },
      {
        id: "r7",
        text: "Proximity search < 200ms at p95",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Heavily read-dominated — design for cacheability",
        category: "non-functional",
        importance: "important",
      },
      {
        id: "r9",
        text: "Ratings resistant to small-sample distortion",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "QuadTree vs geohash for the spatial index — compare them.",
        category: "optimization",
        hint: "Adaptive tree vs fixed grid encoded as a string",
        answer:
          "Geohash encodes lat/lng into a base32 string where a shared prefix implies proximity — its killer feature is that it's just a sortable string, so any database B-tree or KV store becomes a spatial index with prefix range scans. Weaknesses: cells are fixed-size at each precision (dense Manhattan and empty Nevada get the same grid), and two adjacent points can straddle a cell boundary, so you must always query the 8 neighbor cells too. A QuadTree recursively splits space until each leaf holds ≤ K businesses — it adapts to density (deep in cities, shallow in deserts) — but it's an in-memory structure you must build, rebalance on inserts, and rebuild on restart. Rule of thumb: geohash when you want simplicity on existing storage; QuadTree (or S2/H3 cells) when density skew is extreme. For Yelp-scale mostly-static data, either works — businesses don't move.",
      },
      {
        id: "q2",
        question: "Walk me through a 'coffee near me' query end to end.",
        category: "optimization",
        hint: "Cover the circle with cells → candidates → exact filter → rank → hydrate",
        answer:
          "(1) Client sends lat/lng, radius, category. (2) Compute the set of geohash cells (or QuadTree leaves) that cover the search circle — e.g., the center cell plus its 8 neighbors at a precision matching the radius. (3) Fetch candidate business IDs from the index for those cells — this is the cheap pruning step that avoids scanning the world. (4) Exact-filter candidates: haversine distance ≤ radius, category = coffee, open now. (5) Rank by a blend of distance, rating, review count, and popularity. (6) Hydrate the top ~20 from the business cache and return. Steps 3-6 hit cache for popular cells — 'coffee near downtown' is asked thousands of times a day.",
      },
      {
        id: "q3",
        question: "Why use a Bayesian average for ratings instead of a plain mean?",
        category: "consistency",
        hint: "Shrink small samples toward a prior",
        answer:
          "A plain mean lets a business with two 5-star reviews outrank one with 800 reviews averaging 4.6 — statistically absurd. Bayesian average shrinks small samples toward a prior: rating = (C × m + Σ scores) / (C + n), where m is the global/category mean (say 3.8) and C is a confidence weight (say 20 'virtual reviews'). With 2 reviews the displayed score sits near 3.9; with 800 reviews the prior is negligible and the true mean dominates. This also blunts review-bombing of small businesses. Same family of fixes as Reddit's Wilson-score comment ranking.",
      },
      {
        id: "q4",
        question: "The system is 100:1 read-heavy. Where do you put caches?",
        category: "scale",
        hint: "Cache by cell + by business; data changes rarely",
        answer:
          "Three layers. (1) CDN: photos and static page fragments. (2) Search-result cache keyed by (geohash cell, category, filters) — popular cells in city centers have enormous hit rates; TTL of minutes is fine since businesses rarely change. (3) Business-object cache (Redis) keyed by business_id holding the hydrated profile + aggregate rating, invalidated explicitly on edits/new reviews. Hot-cell hotspots (Times Square) get replicated cache entries. The DB then only sees cache misses and writes — a tiny fraction of traffic.",
      },
      {
        id: "q5",
        question: "A new review arrives. What updates, and how consistent must it be?",
        category: "consistency",
        hint: "Async aggregate update; eventual is fine",
        answer:
          "Write the review row synchronously (the reviewer must see their own review), then publish an event. Consumers update: the aggregate rating (recompute Bayesian average from incremental sum + count — O(1), no rescan), the cached business object, and the search index document. All of this is eventually consistent within seconds, which is fine — no user action depends on the aggregate updating instantly. The one synchronous-ish need is read-your-own-write for the reviewer, served by reading through the cache after invalidation or pinning their session to fresh data.",
      },
    ],
    referenceAPIs: [
      {
        method: "GET",
        path: "/api/v1/businesses/search?lat={lat}&lng={lng}&radius={m}&category={cat}&open_now={bool}",
        description: "Proximity search with filters",
        response:
          "{ businesses: [{ bizId, name, rating, reviewCount, distanceMeters, priceTier }] }",
      },
      {
        method: "GET",
        path: "/api/v1/businesses/{bizId}",
        description: "Get business details",
        response: "{ bizId, name, hours, photos, rating, reviewCount, location, busyTimes }",
      },
      {
        method: "POST",
        path: "/api/v1/businesses/{bizId}/reviews",
        description: "Submit a review",
        requestBody: "{ rating: 1-5, text: string, photoIds?: string[] }",
        response: "{ reviewId, createdAt }",
      },
      {
        method: "GET",
        path: "/api/v1/autocomplete?q={prefix}&lat={lat}&lng={lng}",
        description: "Location-biased name/category autocomplete",
        response: "{ suggestions: [{ text, type: 'business'|'category', bizId? }] }",
      },
    ],
    dataModel: [
      {
        name: "businesses",
        type: "nosql",
        fields: [
          { name: "biz_id", type: "string" },
          { name: "name", type: "string" },
          { name: "lat", type: "decimal" },
          { name: "lng", type: "decimal" },
          { name: "geohash", type: "string", note: "Precision ~6-7 chars; spatial index key" },
          { name: "categories", type: "string[]" },
          { name: "hours", type: "json" },
          { name: "price_tier", type: "int", note: "1-4 ($-$$$$)" },
          {
            name: "rating_sum",
            type: "bigint",
            note: "Incremental aggregate — Bayesian avg computed from sum+count",
          },
          { name: "review_count", type: "int" },
        ],
        partitionKey: "biz_id",
        indexes: ["geohash"],
      },
      {
        name: "geo_cell_index",
        type: "nosql",
        fields: [
          { name: "geohash_cell", type: "string", note: "Partition: all businesses in this cell" },
          { name: "biz_id", type: "string" },
          { name: "categories", type: "string[]", note: "Denormalized for cell+category scans" },
        ],
        partitionKey: "geohash_cell",
      },
      {
        name: "reviews",
        type: "nosql",
        fields: [
          { name: "review_id", type: "string" },
          { name: "biz_id", type: "string" },
          { name: "user_id", type: "string" },
          { name: "rating", type: "int" },
          { name: "text", type: "text" },
          { name: "created_at", type: "datetime" },
        ],
        partitionKey: "biz_id",
        indexes: ["user_id"],
      },
      {
        name: "search_and_cache",
        type: "cache",
        fields: [
          {
            name: "results:{cell}:{category}:{filters}",
            type: "json",
            note: "Cached ranked results per cell, TTL minutes",
          },
          {
            name: "biz:{biz_id}",
            type: "json",
            note: "Hydrated business object, invalidated on write",
          },
        ],
      },
    ],
    estimationHints: {
      dailyActiveUsers:
        "~178M monthly unique visitors across web + app (2024) (~5M DAU); 7M+ businesses, 330M+ reviews",
      readWriteRatio:
        "100:1 reads:writes — searches and page views vastly outnumber reviews/check-ins (most users never write)",
      storagePerItem:
        "~5 KB per business (7M ≈ 35 GB), ~1 KB per review (330M ≈ 330 GB); photos dominate raw bytes in object storage",
      peakMultiplier: "2x at meal decision times (11:30 AM-1 PM, 6-8 PM) and weekend evenings",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 31. TIKTOK
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "tiktok",
    requirements: [
      {
        id: "r1",
        text: "Infinite personalized For You feed of short videos",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Video upload with transcoding and pre-publication moderation",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Capture fine-grained engagement signals (watch time, replays, skips, shares)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Likes, comments, follows; following feed alongside FYP",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "New videos from unknown creators must be discoverable (exploration)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r6",
        text: "Duet/Stitch composition features",
        category: "functional",
        importance: "nice-to-have",
      },
      {
        id: "r7",
        text: "Next video starts instantly — prefetched, < 100ms perceived",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Recommendations adapt within minutes of new engagement signals",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Useful personalization for brand-new users within one session (cold start)",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "Explain the two-tower model and why it's used for retrieval.",
        category: "optimization",
        hint: "Separate user and item encoders meeting at a dot product",
        answer:
          "Two neural networks: a user tower encodes user features (watch history, engagement patterns, demographics) into an embedding; an item tower encodes video features (visual/audio embeddings, text, hashtags, creator stats) into the same vector space. Training pushes embeddings of (user, engaged-video) pairs together so the dot product predicts engagement. The architecture exists for serving efficiency: item embeddings are precomputed for the whole corpus and loaded into an ANN index (FAISS/ScaNN); at request time you run the user tower once and do an approximate nearest-neighbor search — retrieving the best few thousand from hundreds of millions of videos in milliseconds. A joint user×item network would score better but can't be indexed — that's why it appears only later, in ranking.",
      },
      {
        id: "q2",
        question: "Why split candidate generation from ranking?",
        category: "scale",
        hint: "A funnel: cheap-and-broad, then expensive-and-narrow",
        answer:
          "You can't run an expensive model over hundreds of millions of videos per swipe. Funnel: (1) Candidate generation — multiple cheap sources each nominate candidates: two-tower ANN retrieval (interest match), trending/viral pool, followed creators, geographic/language pools, and a fresh-content exploration pool — yielding a few thousand. (2) Light ranker prunes to a few hundred. (3) Heavy ranker — a multi-task DNN predicting watch-time, like, share, and follow probabilities, combined into one score. (4) Policy layer: diversity rules (don't show 5 videos from one creator), moderation filters, already-seen suppression. Multiple candidate sources also de-risk filter bubbles — pure interest-matching converges on monotony.",
      },
      {
        id: "q3",
        question: "How does TikTok solve cold start — for a new user AND a new video?",
        category: "optimization",
        hint: "Watch time is implicit feedback; give new videos an exploration quota",
        answer:
          "New user: start with popular/regional content plus optional onboarding interests, then exploit the medium's superpower — every video watched yields signal (watch duration, skip-at-second, replay) with no clicks required. A session of 50 videos = 50 labeled examples, so bandit-style exploration narrows interests within minutes, not weeks. New video: every upload gets a small exploration quota — shown to a few hundred users matched on its content embedding regardless of the creator's following. Strong completion/like/share ratios promote it to progressively larger audiences in tiers; weak signals end its run. This is why unknown creators can go viral — distribution follows content performance, not follower counts.",
      },
      {
        id: "q4",
        question: "How do engagement signals flow back into recommendations within minutes?",
        category: "scale",
        hint: "Event stream → feature store → next request reads fresh features",
        answer:
          "Every play emits events (impression, watch_ms, completion, like, share, skip) batched from the client into Kafka — billions of events/day. Stream processors (Flink-style) update two things in near-real-time: the user's feature vector in a low-latency feature store (recent interests, per-category engagement rates) and per-video aggregate stats (completion rate, like ratio, velocity). The next feed request reads these fresh features, so the heavy ranker reacts within minutes. The full model retrain happens offline (hours), but feature freshness gives most of the adaptivity — this two-speed loop (fresh features, slower weights) is the standard recsys pattern.",
      },
      {
        id: "q5",
        question: "How do you make the next video start instantly?",
        category: "optimization",
        hint: "Client prefetch + CDN + short-segment encoding",
        answer:
          "The feed response carries a small batch of next videos (IDs + CDN URLs + first-segment hints). While the current video plays, the client prefetches the first seconds of the next 2-3 candidates over the CDN; on swipe, playback starts from the already-buffered segment — perceived latency near zero. Videos are encoded with short initial segments and fast-start container layout (moov atom up front). Cost control: prefetch only the head (a few hundred KB), at a quality chosen by current bandwidth, and cancel prefetches the user skips past.",
      },
      {
        id: "q6",
        question: "Moderation must happen before publication at millions of uploads/day. How?",
        category: "security",
        hint: "ML triage in parallel with transcoding; humans for the gray zone",
        answer:
          "On upload, moderation runs in parallel with transcoding so it adds no extra wall-clock time: frame-sampled visual classifiers, audio transcription + text models, and hash-matching against known-bad databases (CSAM, terror content). High-confidence violations are blocked automatically; high-confidence-clean publishes immediately; the gray zone routes to human review queues prioritized by predicted severity and the creator's predicted reach. Post-publication, monitoring continues — a video accelerating toward a large audience gets re-reviewed at higher scrutiny tiers, and user reports feed back into the queues.",
      },
    ],
    referenceAPIs: [
      {
        method: "GET",
        path: "/api/v1/feed/foryou?count=5",
        description: "Get next batch of FYP videos with prefetch hints",
        response: "{ videos: [{ videoId, cdnUrls, creator, stats, firstSegmentHint }] }",
      },
      {
        method: "POST",
        path: "/api/v1/videos",
        description: "Initiate video upload",
        requestBody: "{ description, hashtags: string[], visibility }",
        response: "{ videoId, uploadUrl, status: 'processing' }",
      },
      {
        method: "POST",
        path: "/api/v1/events",
        description: "Batch engagement events from the client",
        requestBody:
          "{ events: [{ videoId, type: 'impression'|'watch'|'like'|'share'|'skip', watchMs?, ts }] }",
        response: "{ accepted: number }",
      },
      {
        method: "POST",
        path: "/api/v1/videos/{videoId}/comments",
        description: "Comment on a video",
        requestBody: "{ text: string, parentId?: string }",
        response: "{ commentId, createdAt }",
      },
      {
        method: "POST",
        path: "/api/v1/users/{userId}/follow",
        description: "Follow a creator",
        response: "{ success: boolean }",
      },
    ],
    dataModel: [
      {
        name: "videos",
        type: "nosql",
        fields: [
          { name: "video_id", type: "string" },
          { name: "creator_id", type: "string" },
          { name: "description", type: "string" },
          { name: "hashtags", type: "string[]" },
          { name: "rendition_urls", type: "json", note: "Per-quality CDN paths" },
          { name: "content_embedding_ref", type: "string", note: "Pointer into the ANN index" },
          {
            name: "moderation_status",
            type: "enum",
            note: "pending, approved, blocked, restricted",
          },
          {
            name: "stats",
            type: "json",
            note: "views, likes, completion_rate, like_ratio — streamed aggregates",
          },
          { name: "created_at", type: "datetime" },
        ],
        partitionKey: "video_id",
      },
      {
        name: "engagement_events",
        type: "nosql",
        fields: [
          { name: "user_id", type: "string" },
          { name: "video_id", type: "string" },
          {
            name: "event_type",
            type: "enum",
            note: "impression, watch, like, share, skip, follow_from_video",
          },
          { name: "watch_ms", type: "int" },
          { name: "timestamp", type: "datetime" },
        ],
        partitionKey: "user_id",
      },
      {
        name: "user_feature_store",
        type: "cache",
        fields: [
          { name: "user_id", type: "string", note: "Key" },
          {
            name: "interest_embedding",
            type: "bytes",
            note: "User-tower input features, updated by stream processor in near-real-time",
          },
          { name: "recent_video_ids", type: "string[]", note: "Already-seen suppression list" },
          { name: "category_affinities", type: "json" },
        ],
      },
      {
        name: "video_ann_index",
        type: "search",
        fields: [
          { name: "video_id", type: "string" },
          {
            name: "embedding",
            type: "bytes",
            note: "Item-tower output; ANN (FAISS/ScaNN) similarity search",
          },
          { name: "language", type: "keyword" },
          { name: "region_allowlist", type: "keyword[]", note: "Per-country availability rules" },
          { name: "freshness_tier", type: "keyword", note: "exploration, growing, established" },
        ],
      },
    ],
    estimationHints: {
      dailyActiveUsers:
        "1.5B MAU (~1B DAU); tens of billions of video views/day, millions of uploads/day",
      readWriteRatio:
        "10:1 reads:writes on the serving path — video delivery dominates; the engagement event stream (several events per view) is a separate high-volume analytics write path",
      storagePerItem:
        "~50 MB per video across renditions; millions of uploads/day = multi-PB/year; engagement events ~100 bytes × tens of billions/day ≈ several TB/day",
      peakMultiplier:
        "2x in regional evenings; viral spikes are absorbed by CDN since the same hot content serves millions",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 32. DISTRIBUTED MESSAGE QUEUE (KAFKA)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "message-queue-design",
    requirements: [
      {
        id: "r1",
        text: "Topics split into partitions; strict ordering within a partition",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Consumer groups: each partition consumed by exactly one consumer in a group",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Durable storage with configurable retention (time/size) and log compaction",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Consumer-managed offsets with commit/seek/replay",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r5",
        text: "Replication with leader election; no acked-message loss on single-broker failure",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r6",
        text: "Idempotent producers and transactions for exactly-once processing pipelines",
        category: "functional",
        importance: "important",
      },
      {
        id: "r7",
        text: "1M+ messages/sec per broker; single-digit-ms p99 produce latency",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Horizontal scaling by adding partitions and brokers",
        category: "non-functional",
        importance: "important",
      },
      {
        id: "r9",
        text: "Consumer lag observable per group per partition",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How does partitioning work, and what does the partition key decide?",
        category: "scale",
        hint: "hash(key) → partition; ordering is per-partition only",
        answer:
          "A topic is N append-only logs (partitions) spread across brokers. Producers route each message: hash(key) % N, or round-robin/sticky if keyless. The key choice is the central design decision because ordering exists ONLY within a partition: key by user_id and each user's events are ordered; there is no total order across the topic. Partition count caps consumer parallelism (more consumers than partitions sit idle) and is painful to change later — rehashing breaks key→partition stability — so over-provision modestly. Hot keys create hot partitions; fixes include composite keys or two-stage aggregation.",
      },
      {
        id: "q2",
        question: "Explain consumer groups, offsets, and what happens during a rebalance.",
        category: "consistency",
        hint: "Coordinator assigns partitions; offsets are the consumer's bookmark",
        answer:
          "A consumer group shares a topic's partitions: a group coordinator (a broker) assigns each partition to exactly one group member, so the group collectively reads everything once-ish while scaling horizontally. Each consumer tracks its position as an offset — just a number per partition — and periodically commits it to the internal __consumer_offsets topic. On restart it resumes from the committed offset; anything processed-but-uncommitted gets redelivered (this is where at-least-once comes from). When members join or leave, the coordinator rebalances; classic 'eager' rebalancing stops the whole group while cooperative incremental rebalancing moves only the affected partitions. Lag = log-end-offset − committed-offset is THE consumer health metric.",
      },
      {
        id: "q3",
        question: "How does ISR replication provide durability without waiting for every replica?",
        category: "failure",
        hint: "Acks from the in-sync set only; min.insync.replicas",
        answer:
          "Each partition has one leader and N−1 followers; producers write to the leader and followers pull-replicate. The ISR (in-sync replica set) is the dynamically maintained subset of replicas caught up within a lag bound — slow or dead followers get evicted from the ISR so they never block writes (this is the trick: quorum over healthy replicas only). With acks=all, the leader acks once all current ISR members have the message; min.insync.replicas=2 with replication factor 3 means you tolerate one broker loss with zero acked-data loss while surviving another's slowness. On leader failure, a new leader is elected from the ISR — guaranteed to have all acked data. Unclean leader election (allowing a non-ISR leader) trades that guarantee for availability; keep it off for important data.",
      },
      {
        id: "q4",
        question: "Can this system give me exactly-once delivery?",
        category: "consistency",
        hint: "Trick question — delivery vs processing",
        answer:
          "No system can guarantee exactly-once DELIVERY over an unreliable network — if an ack is lost, the sender must retry (duplicate) or not (potential loss); if a consumer crashes after processing but before committing its offset, the message is redelivered. What you CAN engineer is exactly-once PROCESSING — duplicates happen but their effects apply once: (1) idempotent producers — broker dedupes retries using a producer ID + per-partition sequence numbers; (2) transactions — atomically write output messages AND commit consumer offsets, with downstream read_committed consumers, making consume-transform-produce pipelines effectively-once; (3) idempotent consumers — dedup keys or upserts at the sink. In an interview, saying 'exactly-once delivery' unqualified is a red flag; say at-least-once delivery + idempotent/transactional processing.",
      },
      {
        id: "q5",
        question: "Why is an append-only log on disk so fast?",
        category: "optimization",
        hint: "Sequential I/O, page cache, zero-copy, batching",
        answer:
          "Four reasons: (1) all writes are sequential appends — the access pattern disks and SSDs are fastest at, no in-place updates or B-tree maintenance; (2) reads ride the OS page cache — recently produced data is served from RAM with no application-level cache to manage; (3) zero-copy (sendfile) moves data from page cache to network socket without copying through user space — crucial when fanning the same bytes to many consumers; (4) producers batch and compress many messages per request, amortizing syscalls and network overhead. Result: ~1M msgs/sec and hundreds of MB/s per broker on commodity hardware.",
      },
      {
        id: "q6",
        question: "What is log compaction and when do you use it instead of time retention?",
        category: "optimization",
        hint: "Keep the latest value per key",
        answer:
          "Time/size retention deletes whole old segments — right for event streams where old events age out. Log compaction instead keeps at least the latest value for every key, deleting older values for the same key in the background; a null value (tombstone) deletes the key entirely after a grace period. Use it for changelog topics — table snapshots, cache-warming feeds, Kafka Streams state store backups — where a new consumer must be able to rebuild current state by reading the topic from the start without replaying unbounded history. Offsets stay monotonic; compacted logs just have gaps.",
      },
    ],
    referenceAPIs: [
      {
        method: "POST",
        path: "/api/v1/topics",
        description: "Create a topic",
        requestBody:
          "{ name, partitions: number, replicationFactor: number, retention: { ms?: number, bytes?: number }, cleanupPolicy: 'delete'|'compact' }",
        response: "{ topic, partitionLeaders: object }",
      },
      {
        method: "POST",
        path: "/api/v1/topics/{topic}/messages",
        description: "Produce a batch",
        requestBody: "{ messages: [{ key?: string, value: bytes }], acks: '0'|'1'|'all' }",
        response: "{ results: [{ partition, offset }] }",
      },
      {
        method: "GET",
        path: "/api/v1/topics/{topic}/partitions/{p}/messages?offset={n}&maxBytes={b}",
        description: "Fetch messages from an offset (consumer poll)",
        response: "{ messages: [{ offset, key, value, timestamp }], highWatermark }",
      },
      {
        method: "POST",
        path: "/api/v1/consumer-groups/{group}/offsets",
        description: "Commit consumed offsets",
        requestBody: "{ offsets: [{ topic, partition, offset }] }",
        response: "{ success: boolean }",
      },
      {
        method: "GET",
        path: "/api/v1/consumer-groups/{group}/lag",
        description: "Get lag per partition",
        response: "{ partitions: [{ topic, partition, committedOffset, logEndOffset, lag }] }",
      },
    ],
    dataModel: [
      {
        name: "partition_log_segments",
        type: "nosql",
        fields: [
          { name: "topic_partition", type: "string", note: "e.g., orders-7" },
          {
            name: "base_offset",
            type: "bigint",
            note: "First offset in this immutable segment file",
          },
          {
            name: "records",
            type: "bytes",
            note: "Append-only batches: (offset, key, value, timestamp, headers)",
          },
          {
            name: "offset_index",
            type: "bytes",
            note: "Sparse offset → file-position index for fast seeks",
          },
        ],
        partitionKey: "topic_partition",
      },
      {
        name: "consumer_offsets",
        type: "nosql",
        fields: [
          { name: "group_id", type: "string" },
          { name: "topic_partition", type: "string" },
          { name: "committed_offset", type: "bigint" },
          { name: "metadata", type: "string" },
          { name: "commit_timestamp", type: "datetime" },
        ],
        partitionKey: "group_id",
      },
      {
        name: "cluster_metadata",
        type: "sql",
        fields: [
          { name: "topic", type: "string" },
          { name: "partition", type: "int" },
          { name: "leader_broker", type: "string" },
          { name: "replicas", type: "string[]" },
          { name: "isr", type: "string[]", note: "Current in-sync replica set" },
          { name: "config", type: "json", note: "retention, min.insync.replicas, cleanup.policy" },
        ],
        indexes: ["topic + partition (unique)"],
      },
      {
        name: "producer_state",
        type: "cache",
        fields: [
          { name: "producer_id", type: "bigint", note: "Assigned at producer init" },
          { name: "topic_partition", type: "string" },
          {
            name: "last_sequence",
            type: "int",
            note: "Broker-side dedup of idempotent-producer retries",
          },
          {
            name: "transaction_state",
            type: "enum",
            note: "ongoing, prepare_commit, committed, aborted",
          },
        ],
      },
    ],
    estimationHints: {
      dailyActiveUsers:
        "N/A — infrastructure; 1M+ messages/sec in and out per cluster, trillions/day at large deployments",
      readWriteRatio:
        "≈1:1 or read-heavier — every message is produced once and consumed by ≥1 consumer group; 3 groups = 3:1 reads:writes",
      storagePerItem:
        "~1 KB average message × 1M/sec ≈ 86 TB/day raw; × replication factor 3 and 7-day retention ≈ 1.8 PB cluster footprint",
      peakMultiplier:
        "3x during traffic spikes; 10x+ read bursts when a consumer group replays history after an outage or bug fix",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 33. DIGITAL WALLET / UPI
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "digital-wallet",
    requirements: [
      {
        id: "r1",
        text: "P2P transfers between wallets (and to bank accounts / VPAs)",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Wallet top-up from bank account or card",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Balance inquiry and full transaction history",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Double-entry ledger as the source of financial truth",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r5",
        text: "KYC tiers with corresponding wallet/transaction limits",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Daily settlement reconciliation with partner banks",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r7",
        text: "Effectively-once (idempotent) transaction execution — a retried request never debits twice",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Balance can never go negative; no money created or destroyed",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Complete immutable audit trail for regulators",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r10",
        text: "99.99% availability — payment failures are user-visible incidents",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question:
          "A transfer request times out and the client retries. How do you guarantee the user isn't debited twice?",
        category: "consistency",
        hint: "Idempotency keys stored atomically with the result",
        answer:
          "Every transfer carries a client-generated idempotency key (UUID per logical payment attempt). The server checks a table with a unique index on that key: if present, return the stored result without re-executing; if absent, execute and insert the key + outcome inside the SAME database transaction as the ledger writes — so a crash between 'executed' and 'recorded' is impossible. The unique index closes the race where two retries arrive simultaneously: one inserts, the other hits the constraint and reads the winner's result. This matters acutely on mobile networks: the client that timed out cannot know whether the debit happened — only the idempotency key makes retrying safe.",
      },
      {
        id: "q2",
        question: "Design the ledger. How are amounts and directions represented?",
        category: "consistency",
        hint: "Pin down the convention: type enum + always-positive amounts",
        answer:
          "Double-entry: every transfer writes at least two entries grouped by transaction_id — a debit against the sender's wallet account and a credit to the receiver's. State the convention explicitly: each entry has a type (debit or credit) and an amount that is ALWAYS positive, in integer minor units; direction lives in the type column, never in the sign. (The alternative — signed amounts — must never be mixed with typed entries; ambiguity here causes real accounting bugs.) Invariant: within a transaction, total debits = total credits. The ledger is append-only — corrections are new reversing entries, never updates or deletes. Balances are derivable by summing entries; in practice keep a cached running balance per wallet that's transactionally updated with the entries and periodically verified against the sum.",
      },
      {
        id: "q3",
        question:
          "Two concurrent payments hit the same wallet with balance ₹100, each for ₹80. How do you prevent both succeeding?",
        category: "consistency",
        hint: "Row lock + check + debit in one transaction; consistent lock ordering",
        answer:
          "In one SQL transaction: SELECT ... FOR UPDATE the sender's wallet row (taking a row lock), check balance ≥ amount, write the ledger entries, update the cached balance, commit. The second transaction blocks on the row lock, then re-reads the post-commit balance (₹20) and fails the check — no negative balance possible. For transfers touching two wallets, always lock rows in a consistent global order (e.g., by wallet_id) to prevent deadlocks between A→B and B→A transfers. Hot merchant wallets that serialize too much traffic can be split into sharded sub-accounts that are summed for reporting.",
      },
      {
        id: "q4",
        question: "How does daily reconciliation with banks work?",
        category: "failure",
        hint: "Match internal ledger vs settlement files; classify and resolve breaks",
        answer:
          "Each day, partner banks (or the UPI switch) send settlement files listing every transaction they processed. A reconciliation job matches them against the internal ledger by transaction reference. Three break categories: (1) in our ledger, not in the bank file — likely timing (T+1) or a failed leg we recorded as success; (2) in the bank file, not ours — most dangerous, money moved we didn't record; (3) amount/status mismatches. Auto-resolve known timing patterns; queue the rest to an ops workbench with SLAs. Separately, run continuous internal invariant checks: global debits = credits, and the sum of all customer wallet balances equals the escrow bank account — catching drift within hours, not at audit time.",
      },
      {
        id: "q5",
        question:
          "The sender was debited, but crediting the receiver failed. Walk me through recovery.",
        category: "failure",
        hint: "Saga with compensation; reversal is new entries",
        answer:
          "The transfer is a saga: validate → debit sender (with the lock-and-check transaction) → credit receiver → mark completed. Each step records saga state durably, so a crashed orchestrator resumes where it left off. If the credit step fails permanently (receiver wallet frozen/closed), execute the compensating action: re-credit the sender with a new pair of reversal ledger entries referencing the original transaction_id, and mark the transfer 'reversed'. Never delete or mutate the original entries — auditors must see debit, failed credit, and reversal as three facts. The user sees 'refunded'; the books balance at every point in time.",
      },
      {
        id: "q6",
        question: "How do you handle fraud and regulatory limits?",
        category: "security",
        hint: "KYC tiers, velocity rules, step-up auth",
        answer:
          "Enforce KYC-tier limits at the API layer (per-transaction, daily, monthly caps that rise with verification level — min-KYC vs full-KYC). Run velocity checks (transactions/hour, new-payee + large-amount combinations, device changes) and an ML risk score per transaction; high-risk triggers step-up authentication (UPI mandates a PIN per transaction by design) or holds. Maintain device binding (a registered device + SIM is part of the auth factor), screen against sanctions lists, and file mandated suspicious-transaction reports. All limits and decisions are logged to the audit trail since regulators inspect both the money and the controls.",
      },
    ],
    referenceAPIs: [
      {
        method: "POST",
        path: "/api/v1/transfers",
        description: "Initiate a P2P transfer",
        requestBody:
          "{ idempotencyKey: string, fromWalletId: string, toVpa: string, amount: number, currency: string, note?: string }",
        response: "{ transferId, status: 'completed'|'pending'|'failed', completedAt }",
      },
      {
        method: "GET",
        path: "/api/v1/wallets/{walletId}/balance",
        description: "Get current balance",
        response:
          "{ walletId, balance: number, currency, kycTier, limits: { perTxn, daily, monthly } }",
      },
      {
        method: "GET",
        path: "/api/v1/wallets/{walletId}/transactions?cursor={c}",
        description: "Paginated transaction history",
        response:
          "{ transactions: [{ transferId, type, amount, counterparty, status, timestamp }], nextCursor }",
      },
      {
        method: "POST",
        path: "/api/v1/wallets/{walletId}/topup",
        description: "Top up wallet from a bank/card",
        requestBody: "{ idempotencyKey, amount, fundingSourceId }",
        response: "{ topupId, status }",
      },
      {
        method: "GET",
        path: "/api/v1/transfers/{transferId}",
        description: "Get transfer status and timeline",
        response: "{ transferId, status, sagaTimeline: [{ step, status, at }] }",
      },
    ],
    dataModel: [
      {
        name: "wallets",
        type: "sql",
        fields: [
          { name: "wallet_id", type: "string" },
          { name: "user_id", type: "string" },
          {
            name: "balance",
            type: "bigint",
            note: "Cached running balance in minor units; verified against ledger sum",
          },
          { name: "currency", type: "string" },
          { name: "kyc_tier", type: "enum", note: "min_kyc, full_kyc — determines limits" },
          { name: "status", type: "enum", note: "active, frozen, closed" },
          { name: "version", type: "int" },
        ],
        indexes: ["user_id"],
      },
      {
        name: "ledger_entries",
        type: "sql",
        fields: [
          { name: "entry_id", type: "uuid" },
          { name: "transaction_id", type: "string", note: "Groups the balanced debit+credit set" },
          { name: "account_id", type: "string", note: "Wallet or internal account (escrow, fees)" },
          { name: "type", type: "enum", note: "debit or credit — direction lives HERE" },
          { name: "amount", type: "bigint", note: "ALWAYS positive, minor units — never signed" },
          { name: "currency", type: "string" },
          { name: "created_at", type: "datetime", note: "Append-only; reversals are new entries" },
        ],
        indexes: ["transaction_id", "account_id + created_at"],
      },
      {
        name: "transfers",
        type: "sql",
        fields: [
          { name: "transfer_id", type: "uuid" },
          {
            name: "idempotency_key",
            type: "string",
            note: "UNIQUE index — the idempotency (effectively-once) mechanism",
          },
          { name: "from_wallet_id", type: "string" },
          { name: "to_wallet_id", type: "string" },
          { name: "amount", type: "bigint" },
          {
            name: "status",
            type: "enum",
            note: "initiated, debited, credited, completed, failed, reversed",
          },
          { name: "saga_state", type: "json", note: "Durable step tracking for crash recovery" },
          { name: "created_at", type: "datetime" },
        ],
        indexes: ["idempotency_key (unique)", "from_wallet_id", "status"],
      },
      {
        name: "reconciliation_breaks",
        type: "sql",
        fields: [
          { name: "break_id", type: "uuid" },
          { name: "settlement_date", type: "date" },
          { name: "bank_ref", type: "string" },
          {
            name: "category",
            type: "enum",
            note: "missing_internal, missing_bank, amount_mismatch, status_mismatch",
          },
          { name: "status", type: "enum", note: "open, auto_resolved, ops_review, resolved" },
          { name: "details", type: "json" },
        ],
        indexes: ["settlement_date", "status"],
      },
    ],
    estimationHints: {
      dailyActiveUsers:
        "100M DAU; ~500M transactions/day at UPI scale (16B/month) ≈ 6K/sec average",
      readWriteRatio:
        "2:1 reads:writes — balance checks and history reads vs transfers (each transfer = several writes: transfer row, 2+ ledger entries, balance updates)",
      storagePerItem:
        "~1 KB per transfer + ~250 bytes per ledger entry; 500M transfers/day ≈ 750 GB/day, retained for years for regulators — archival tiering essential",
      peakMultiplier: "5-10x on festival days (Diwali, New Year) and salary days at month start",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 34. ONLINE CODE EDITOR
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "code-editor",
    requirements: [
      {
        id: "r1",
        text: "Real-time collaborative editing with multiple cursors",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Execute user code in 50+ languages, sandboxed",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "LSP features: autocomplete, diagnostics, go-to-definition",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Per-project virtual file system with version history and git",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Interactive terminal (PTY over WebSocket)",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Instant project forks via filesystem snapshots",
        category: "functional",
        importance: "nice-to-have",
      },
      {
        id: "r7",
        text: "Keystroke-to-peer latency < 100ms",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Untrusted code can never escape its sandbox or starve neighbors",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r9",
        text: "Project cold start < 5s (pre-warmed pools)",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question:
          "OT vs CRDT for collaborative editing — how do they differ and which do you pick?",
        category: "consistency",
        hint: "Transform-against-concurrent-ops vs commutative-by-construction",
        answer:
          "OT (Operational Transformation) keeps the document as plain text and transforms concurrent operations against each other — if you insert at position 5 while I insert at position 2, your op is transformed to position 6 before applying. It needs a central server to define the canonical order, and the transform-function case analysis is notoriously tricky to get right (Google Docs is the famous OT system). CRDTs make concurrent edits commute by construction: every character gets a unique stable ID, and inserts say 'after character X' rather than 'at index 5', so replicas converge regardless of delivery order — ideal for offline and P2P, at the cost of metadata overhead (IDs, tombstones), which modern libraries (Yjs, Automerge) compress well. For a server-based editor either works; today CRDT via Yjs is the pragmatic default because correctness doesn't depend on hand-written transform logic, and offline editing falls out for free.",
      },
      {
        id: "q2",
        question: "How do you safely run untrusted code? Why aren't containers enough?",
        category: "security",
        hint: "Shared kernel is the problem; gVisor or microVMs",
        answer:
          "A plain container shares the host kernel — namespaces and cgroups isolate resources, but a single kernel vulnerability lets malicious code escape to the host, unacceptable for arbitrary untrusted code. Two hardened options: gVisor interposes a user-space kernel that implements syscalls itself, drastically shrinking the host-kernel attack surface (at some syscall-performance cost); Firecracker runs each workload in a microVM with hardware virtualization — a real VM boundary with ~125ms boot and ~5MB overhead (this is what AWS Lambda uses). Layer on: cgroup CPU/memory/pids limits, seccomp filters, no network by default (or an egress allowlist proxy), read-only base image with a writable overlay, and hard wall-clock timeouts. Defense in depth — assume any single layer can fail.",
      },
      {
        id: "q3",
        question: "How does LSP integration work server-side?",
        category: "optimization",
        hint: "JSON-RPC language servers co-located with the workspace",
        answer:
          "The Language Server Protocol decouples editors from language intelligence: the editor speaks JSON-RPC (textDocument/completion, /definition, /publishDiagnostics, incremental didChange syncs) to a language server — one per language (pyright, gopls, rust-analyzer). Run the language server inside or beside the user's workspace container so it sees the real files and dependencies, proxied to the browser over the session WebSocket. Keep it warm — indexing a project takes seconds to minutes, so it starts at project-open, not first keystroke. Language servers leak memory and crash; supervise and restart them transparently, replaying document state from the editor's authoritative copy.",
      },
      {
        id: "q4",
        question: "How do you get sub-5-second project boot?",
        category: "scale",
        hint: "Pre-warmed pools + overlayfs layering",
        answer:
          "Cold-starting honestly — boot VM, pull image, install dependencies — takes minutes. Three tricks: (1) pre-warmed pools of booted sandboxes per popular language template, so 'create project' just claims one (Firecracker makes idle pool members cheap); (2) layered filesystems — a read-only base image per language with common dependencies pre-installed, with the user's files mounted as a copy-on-write overlay (overlayfs); attaching a project is a mount, not an install; (3) snapshot/restore — forking a project is cloning the overlay layer, near-instant regardless of size. Result: the only real boot work is fetching the user's (usually small) file layer.",
      },
      {
        id: "q5",
        question: "The container running a session dies. What is lost?",
        category: "failure",
        hint: "Separate durable state from disposable compute",
        answer:
          "Design so the answer is 'almost nothing'. Durable state lives outside the sandbox: files are persisted to object storage continuously (on save + periodic sync of the overlay diff), and the collaborative document state is held by the collab service backed by the CRDT/op log — the sandbox is disposable compute. On death: clients' editor state is intact locally; the session service claims a fresh sandbox from the warm pool, mounts the project layer, restarts the language server, and reattaches the terminal. Users lose only unflushed terminal scrollback and any process that was running. Recovery is seconds because it's the same path as a normal cold boot.",
      },
      {
        id: "q6",
        question: "How do you stop people from mining crypto on your free tier?",
        category: "security",
        hint: "Quotas + behavioral detection + economic friction",
        answer:
          "Abuse is economic, so make it uneconomic: strict free-tier CPU quotas (throttled, burstable only briefly), sleep idle sandboxes aggressively, and require activity (an attached editor session) for sustained CPU. Block or allowlist network egress — miners need pool connections; detect mining signatures behaviorally: sustained 100% CPU with no I/O, known pool domains/ports, characteristic process names, and CPU patterns that survive renaming. Add friction at signup (verified accounts for more compute) and rate-limit account creation. Accept you won't catch everything — cap the blast radius per account so undetected abuse costs little.",
      },
    ],
    referenceAPIs: [
      {
        method: "GET",
        path: "/api/v1/projects/{projectId}",
        description: "Get project metadata and file tree",
        response: "{ projectId, name, language, fileTree, collaborators }",
      },
      {
        method: "POST",
        path: "/api/v1/projects/{projectId}/execute",
        description: "Run the project (claims a sandbox)",
        requestBody: "{ entrypoint?: string, stdin?: string, timeoutMs?: number }",
        response: "{ executionId, status, stdout, stderr, exitCode, durationMs }",
      },
      {
        method: "GET",
        path: "/api/v1/projects/{projectId}/collab",
        description: "WebSocket endpoint: CRDT/OT ops, cursor awareness, presence",
        response: "Upgrades to WebSocket; bidirectional op + awareness messages",
      },
      {
        method: "GET",
        path: "/api/v1/projects/{projectId}/terminal",
        description: "WebSocket endpoint: PTY streams for the interactive terminal",
        response: "Upgrades to WebSocket; raw PTY byte streams",
      },
      {
        method: "POST",
        path: "/api/v1/projects/{projectId}/fork",
        description: "Fork a project (copy-on-write snapshot)",
        response: "{ newProjectId, readyInMs }",
      },
    ],
    dataModel: [
      {
        name: "projects",
        type: "sql",
        fields: [
          { name: "project_id", type: "uuid" },
          { name: "owner_id", type: "string" },
          { name: "name", type: "string" },
          { name: "language", type: "string", note: "Selects base image + language server" },
          { name: "base_image_version", type: "string" },
          { name: "forked_from", type: "string", note: "Snapshot lineage" },
          { name: "updated_at", type: "datetime" },
        ],
        indexes: ["owner_id", "updated_at"],
      },
      {
        name: "file_versions",
        type: "nosql",
        fields: [
          { name: "project_id", type: "string" },
          { name: "path", type: "string" },
          { name: "version", type: "int" },
          {
            name: "blob_ref",
            type: "string",
            note: "Content-addressed object storage key (dedup across forks)",
          },
          { name: "size_bytes", type: "int" },
          { name: "updated_by", type: "string" },
          { name: "updated_at", type: "datetime" },
        ],
        partitionKey: "project_id",
        indexes: ["path + version"],
      },
      {
        name: "doc_updates",
        type: "nosql",
        fields: [
          { name: "doc_id", type: "string", note: "project_id + path" },
          { name: "seq", type: "bigint" },
          {
            name: "update",
            type: "bytes",
            note: "CRDT update / OT op batch; compacted into snapshots periodically",
          },
          { name: "author_id", type: "string" },
          { name: "timestamp", type: "datetime" },
        ],
        partitionKey: "doc_id",
        indexes: ["seq"],
      },
      {
        name: "sandbox_registry",
        type: "cache",
        fields: [
          { name: "project_id", type: "string", note: "Key" },
          { name: "sandbox_node", type: "string", note: "Host running the microVM/container" },
          { name: "status", type: "enum", note: "warming, attached, idle, sleeping, dead" },
          {
            name: "resource_usage",
            type: "json",
            note: "CPU/mem for quota enforcement + abuse detection",
          },
          { name: "last_activity_at", type: "datetime", note: "Drives idle-sleep policy" },
        ],
      },
    ],
    estimationHints: {
      dailyActiveUsers:
        "10M DAU; ~1M concurrent sessions at peak, each with a live sandbox + WebSockets",
      readWriteRatio:
        "≈1:2 reads:writes (write-heavy) — every keystroke is an edit op; file/LSP reads are fewer than the continuous op stream",
      storagePerItem:
        "~50 bytes per edit op (compacted into snapshots); average project ~10 MB with content-addressed dedup across forks making real growth far sublinear",
      peakMultiplier:
        "2x weekday daytime; 5x during education semesters and popular coding-contest events",
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 35. CI/CD PIPELINE
  // ─────────────────────────────────────────────────────────────────────────────
  {
    problemId: "cicd-pipeline",
    requirements: [
      {
        id: "r1",
        text: "Trigger workflows on push, PR, schedule, or manual dispatch",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r2",
        text: "Workflows defined as DAGs of jobs with dependency edges",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r3",
        text: "Parallel job execution on an auto-scaling runner fleet",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r4",
        text: "Dependency/build caching and artifact storage with retention",
        category: "functional",
        importance: "important",
      },
      {
        id: "r5",
        text: "Live log streaming while jobs run",
        category: "functional",
        importance: "important",
      },
      {
        id: "r6",
        text: "Deployment strategies: rolling, blue-green, canary — with automatic rollback",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r7",
        text: "Secrets injected at runtime, masked in logs, withheld from fork PRs",
        category: "functional",
        importance: "critical",
      },
      {
        id: "r8",
        text: "Queue-to-start latency < 30s at p95",
        category: "non-functional",
        importance: "important",
      },
      {
        id: "r9",
        text: "Strict isolation between tenants' jobs (untrusted PR code runs here!)",
        category: "non-functional",
        importance: "critical",
      },
      {
        id: "r10",
        text: "Every run fully auditable: who, what commit, what result",
        category: "non-functional",
        importance: "important",
      },
    ],
    followUpQuestions: [
      {
        id: "q1",
        question: "How does the scheduler execute a workflow DAG?",
        category: "optimization",
        hint: "Topological readiness — enqueue jobs whose dependencies completed",
        answer:
          "Parse the workflow file into a DAG, rejecting cycles at parse time. The scheduler tracks each job's state and maintains the classic topological-execution loop: a job becomes ready when ALL its dependencies succeeded (effectively when its remaining-dependency count hits zero); ready jobs are pushed to the work queue, and each job completion event decrements its dependents' counts, possibly making them ready. Independent branches run in parallel up to concurrency limits; matrix jobs fan out into N parallel instances at readiness time. A failed job cancels (or skips, per config) its downstream subtree while unrelated branches continue. The scheduler itself is stateless between events — all state is in the DB — so it restarts safely mid-run.",
      },
      {
        id: "q2",
        question: "Design artifact storage and build caching.",
        category: "optimization",
        hint: "Content-addressed objects + lockfile-keyed caches with fallbacks",
        answer:
          "Artifacts: store blobs content-addressed (key = SHA-256 of content) in object storage, with a metadata DB mapping run → named artifacts → blob keys. Identical outputs across runs dedupe to one blob; retention policies (age, branch, count) delete metadata while a GC reclaims unreferenced blobs. Caching is the bigger speed win: cache dependency directories keyed by hash of the lockfile (e.g., 'node-{hash(package-lock.json)}'), with prefix fallback keys so a near-miss restores a stale-but-close cache to update incrementally — 3-10x faster builds. Docker layer caching works the same way, since layers are already content-addressed. Scope caches per repo (and restrict cross-branch writes) so a malicious PR can't poison the main branch's cache.",
      },
      {
        id: "q3",
        question: "Walk me through a canary deployment with automatic rollback.",
        category: "failure",
        hint: "Small slice → bake → promote or revert; rollback must be pre-staged",
        answer:
          "Deploy the new version alongside the old and shift ~5% of traffic to it. Bake for a fixed window (e.g., 10 min) while comparing canary metrics against the baseline cohort: error rate, latency p99, and app-specific health metrics — statistically, not just thresholds, since 5% of traffic is noisy. Healthy → promote stepwise (5→25→50→100%) with a bake at each step; any breach → shift traffic back to the old version, which is still running and warm — rollback is a traffic flip taking seconds, not a redeploy. The non-obvious requirement is database compatibility: schema changes must be expand-migrate-contract (new code works with old schema and vice versa) or rollback is a lie. Record every decision for the audit trail.",
      },
      {
        id: "q4",
        question: "How do runners work, and why is isolation non-negotiable?",
        category: "security",
        hint: "Ephemeral sandboxes; PRs from forks run attacker-controlled code",
        answer:
          "Runners poll/claim jobs from the queue, execute steps, stream logs, and upload artifacts. The threat model is stark: a fork PR means arbitrary attacker code executing in your infrastructure. Therefore: every job runs in a fresh ephemeral VM or hardened container destroyed afterward — no state survives to the next job; no two tenants share a sandbox; fork-PR jobs get NO secrets and read-only tokens (secrets-dependent jobs require maintainer approval); egress is restricted. Auto-scale the fleet on queue depth with a warm pool for sub-30s starts. Runner death mid-job is detected by heartbeat timeout → job marked infrastructure-failed and retried on another runner, which is also why job steps should be idempotent.",
      },
      {
        id: "q5",
        question: "How does live log streaming work for thousands of concurrent jobs?",
        category: "scale",
        hint: "Append stream + incremental fetch; archive to object storage",
        answer:
          "Runners ship log lines in small batches (every ~1s) to a log ingestion service, which appends them to a per-job stream (Redis stream or append-only store) and fans out to live viewers over WebSocket/SSE — viewers fetch 'lines since cursor', so reconnects and late joiners are trivial. Secrets masking is applied at ingestion (the runner knows the secret values and redacts before shipping — defense in depth re-checks server-side). On job completion, the stream is compacted into a single object-storage file, the hot copy expires, and subsequent reads hit the archive. Because logs are streamed incrementally, a crashed runner still leaves everything up to its last heartbeat — crucial for debugging the crash itself.",
      },
      {
        id: "q6",
        question: "One tenant pushes 50 commits in a minute. How do you keep the queue fair?",
        category: "scale",
        hint: "Per-tenant concurrency limits + fair scheduling + dedup",
        answer:
          "Three mechanisms: (1) per-tenant concurrency caps (N concurrent jobs by plan tier) so one tenant can't drain the shared pool; (2) fair dequeueing across tenants (weighted round-robin over per-tenant queues) rather than global FIFO, so a burst queues behind itself, not behind everyone; (3) work elimination — auto-cancel superseded runs for the same branch/PR when a newer commit arrives (most CI on intermediate commits is wasted), and skip unchanged paths via path filters. Add priority lanes: deploy jobs outrank PR validation, which outranks scheduled cron jobs.",
      },
    ],
    referenceAPIs: [
      {
        method: "POST",
        path: "/api/v1/repos/{repoId}/workflows/{workflowId}/runs",
        description: "Trigger a workflow run",
        requestBody:
          "{ ref: string, commitSha: string, trigger: 'push'|'pr'|'schedule'|'manual', inputs?: object }",
        response: "{ runId, status: 'queued', jobs: [{ jobId, name, dependsOn }] }",
      },
      {
        method: "GET",
        path: "/api/v1/runs/{runId}",
        description: "Get run status with per-job DAG state",
        response: "{ runId, status, jobs: [{ jobId, status, startedAt, durationMs }], conclusion }",
      },
      {
        method: "GET",
        path: "/api/v1/runs/{runId}/jobs/{jobId}/logs?cursor={c}",
        description: "Stream/poll job logs incrementally",
        response: "{ lines: string[], nextCursor, complete: boolean }",
      },
      {
        method: "POST",
        path: "/api/v1/runners/jobs/claim",
        description: "Runner claims the next job (long-poll)",
        requestBody: "{ runnerId, labels: string[] }",
        response: "{ jobId?, steps, secretsToken?, cacheKeys }",
      },
      {
        method: "POST",
        path: "/api/v1/deployments/{deploymentId}/rollback",
        description: "Roll back a deployment to the previous known-good version",
        response: "{ deploymentId, status: 'rolling_back', targetVersion }",
      },
    ],
    dataModel: [
      {
        name: "workflow_runs",
        type: "sql",
        fields: [
          { name: "run_id", type: "uuid" },
          { name: "repo_id", type: "string" },
          { name: "workflow_id", type: "string" },
          { name: "commit_sha", type: "string" },
          { name: "trigger", type: "enum", note: "push, pr, schedule, manual" },
          { name: "dag", type: "json", note: "Parsed job graph with dependency edges" },
          {
            name: "status",
            type: "enum",
            note: "queued, in_progress, success, failure, cancelled",
          },
          { name: "created_at", type: "datetime" },
        ],
        indexes: ["repo_id + created_at", "status"],
      },
      {
        name: "jobs",
        type: "sql",
        fields: [
          { name: "job_id", type: "uuid" },
          { name: "run_id", type: "string" },
          { name: "name", type: "string" },
          { name: "depends_on", type: "string[]", note: "DAG edges; job ready when all succeeded" },
          {
            name: "status",
            type: "enum",
            note: "pending, ready, running, success, failure, skipped",
          },
          { name: "runner_id", type: "string" },
          { name: "started_at", type: "datetime" },
          { name: "finished_at", type: "datetime" },
        ],
        indexes: ["run_id", "status", "runner_id"],
      },
      {
        name: "artifacts_and_caches",
        type: "nosql",
        fields: [
          { name: "scope", type: "string", note: "repo or run scope" },
          { name: "key", type: "string", note: "Artifact name or cache key (lockfile hash)" },
          {
            name: "blob_sha256",
            type: "string",
            note: "Content-addressed object storage key — dedups identical content",
          },
          { name: "size_bytes", type: "bigint" },
          { name: "expires_at", type: "datetime", note: "Retention policy" },
        ],
        partitionKey: "scope",
        indexes: ["key"],
      },
      {
        name: "deployments",
        type: "sql",
        fields: [
          { name: "deployment_id", type: "uuid" },
          { name: "service", type: "string" },
          { name: "version", type: "string" },
          {
            name: "previous_version",
            type: "string",
            note: "Rollback target, kept warm during bake",
          },
          { name: "strategy", type: "enum", note: "rolling, blue_green, canary" },
          {
            name: "canary_state",
            type: "json",
            note: "traffic %, bake deadline, metric baselines",
          },
          { name: "status", type: "enum", note: "deploying, baking, promoted, rolled_back" },
        ],
        indexes: ["service + status"],
      },
    ],
    estimationHints: {
      dailyActiveUsers:
        "5M DAU (developers); millions of workflow runs/day, ~10M jobs/day at GitHub Actions scale",
      readWriteRatio:
        "2:1 reads:writes on the API (status polling, log viewing) — but log ingestion is the real write volume, far exceeding control-plane writes",
      storagePerItem:
        "Logs ~5-10 MB/job and artifacts ~100 MB/run before dedup — tens of TB/day; content-addressing plus aggressive retention keeps the stored footprint a fraction of that",
      peakMultiplier:
        "3x weekday working hours, Monday morning merge rushes; near-zero weekend troughs make autoscaling pay for itself",
    },
  },
];

export function getInterviewData(problemId: string): ProblemInterviewData | undefined {
  return INTERVIEW_DATA.find((d) => d.problemId === problemId);
}
