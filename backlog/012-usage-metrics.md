# Usage Metrics & Cost Tracking

## Summary

Track Claude Code usage metrics across all agents including token consumption, costs, session statistics, and integration with tools like `ccusage` and `ccflare`. Supports subscription plans (Pro/Max), API key usage, and multi-account load balancing.

## Motivation

Running multiple agents in parallel can consume significant resources. Without visibility:
- Users don't know which agents are consuming their plan limits
- No warning before hitting subscription caps
- Can't optimize prompts/tasks for efficiency
- Hard to budget for agent operations
- No data to inform when to use cheaper models

Usage tracking enables:
- Real-time awareness of plan consumption per agent
- Aggregate usage across all agents
- Historical usage patterns
- Budget alerts and limits
- Model selection optimization

## Authentication Modes

### Mode 1: Subscription Only (Pro/Max Plans)

User has Claude Pro ($20/mo) or Claude Max ($100/mo) subscription with Claude Code included.

**Characteristics**:
- No API key needed
- Usage counted against plan limits
- Rate limits per plan tier
- `ccusage` shows plan consumption

**Tracking**:
- Monitor plan usage percentage
- Track rate limit hits
- Show remaining capacity

### Mode 2: API Key Only

User has Anthropic API key, no subscription.

**Characteristics**:
- Pay-per-token pricing
- No rate limits (within API limits)
- Billed to Anthropic account

**Tracking**:
- Token counts (input/output/cache)
- Cost calculation based on model pricing
- Running totals

### Mode 3: Subscription + API Key

User has both subscription and API key.

**Use Cases**:
- Use subscription for interactive work
- Use API for heavy batch operations
- Fallback when subscription rate-limited
- Different models per source

**Tracking**:
- Separate tracking per source
- Combined view option
- Cost comparison

### Mode 4: Multi-Account with ccflare

User has multiple Claude accounts (Free, Pro, Team) and uses [ccflare](https://github.com/snipeship/ccflare) to load balance across them.

**ccflare Features**:
- Distribute requests across multiple accounts
- Automatic failover when rate-limited
- Session-based routing (5-hour context windows)
- Per-account usage tracking
- OAuth token refresh handling
- Web dashboard at `localhost:8080/dashboard`

**Use Cases**:
- Run many agents without hitting single-account rate limits
- Mix Free + Pro accounts for cost optimization
- Team environments with multiple seats
- High-throughput batch operations

**Integration**:
- Set `ANTHROPIC_BASE_URL=http://localhost:8080`
- ccflare proxies to appropriate account
- Opus Orchestra reads ccflare's analytics API

**Tracking**:
- Per-account usage breakdown
- Rate limit status per account
- Aggregate across all accounts
- Cost distribution

## Design

### Metrics to Track

**Subscription Metrics**:
| Metric | Description |
|--------|-------------|
| Plan tier | Pro, Max, etc. |
| Usage % | Percentage of plan consumed |
| Rate limit status | Current rate limit state |
| Resets in | Time until limits reset |
| Messages today | Number of messages sent |

**API Metrics**:
| Metric | Description |
|--------|-------------|
| Input tokens | Tokens sent to Claude |
| Output tokens | Tokens received from Claude |
| Total tokens | Input + Output |
| API cost | Estimated $ based on model pricing |
| Requests | Number of API calls |
| Cache hits | Prompt cache utilization |

**Per-Agent Metrics**:
| Metric | Description |
|--------|-------------|
| Source | Subscription or API |
| Session duration | Wall clock time active |
| Model used | claude-sonnet, claude-opus, etc. |
| Task association | Which task this usage is for |

### ccusage Integration

[ccusage](https://github.com/ryoppippi/ccusage) tracks Claude Code usage and shows plan consumption.

**Output Example** (subscription):
```
Claude Usage Report
═══════════════════
Plan: Claude Max
Period: Dec 1-31, 2024

Usage: 67% of monthly limit
Messages: 2,847 / ~4,000
Opus messages: 142 / 200

Rate Status: Normal
Resets: 18 days
```

**Integration**:
- Run `ccusage` periodically
- Parse output for plan status
- Display in dashboard
- Alert on high usage

### Dashboard Integration

**Per-Agent Card** (Subscription):
```
┌───────────────────────────────────────────[×]─┐
│ Agent-1                                       │
│ Task: Fix auth bypass                         │
├───────────────────────────────────────────────┤
│ ● Working for 12m                             │
│                                               │
│ Session: 23 messages (Subscription)           │
│                                               │
│ Changes: +142 -38                             │
├───────────────────────────────────────────────┤
│ ...                                           │
└───────────────────────────────────────────────┘
```

**Per-Agent Card** (API):
```
┌───────────────────────────────────────────[×]─┐
│ Agent-2                                       │
│ Task: Add caching layer                       │
├───────────────────────────────────────────────┤
│ ● Working for 8m                              │
│                                               │
│ Session: 45K tokens ($0.32) [API]             │
│                                               │
│ Changes: +89 -12                              │
├───────────────────────────────────────────────┤
│ ...                                           │
└───────────────────────────────────────────────┘
```

**Usage Summary Panel**:
```
┌─────────────────────────────────────────────────────────┐
│ Usage Summary                                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ SUBSCRIPTION (Claude Max)                               │
│ ─────────────────────────────────────────────────────── │
│ Plan Usage: 67%  ██████████████░░░░░░░                  │
│ Messages Today: 127                                     │
│ Opus Messages: 142/200 (71%)                           │
│ Resets: 18 days                                         │
│                                                         │
│ API USAGE (This Session)                               │
│ ─────────────────────────────────────────────────────── │
│ Total Cost: $2.47                                       │
│ Total Tokens: 312,450 (In: 285K, Out: 27K)             │
│ Requests: 47                                            │
│                                                         │
│ ─────────────────────────────────────────────────────── │
│                                                         │
│ By Agent:                                               │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Agent-1  127 msgs [Sub]     ████████████░░  Plan    │ │
│ │ Agent-2  $0.89    [API]     ███████░░░░░░░  API     │ │
│ │ Agent-3  $0.72    [API]     ██████░░░░░░░░  API     │ │
│ │ Conductor 45 msgs [Sub]     ███░░░░░░░░░░░  Plan    │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ [Run ccusage]  [View History]  [Export]                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Settings UI

```
┌─────────────────────────────────────────────────────────┐
│ Usage Tracking                                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Authentication Mode:                                    │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ● Subscription only (Pro/Max plan)                  │ │
│ │ ○ API key only                                      │ │
│ │ ○ Both (subscription + API fallback)                │ │
│ │ ○ Multi-account (ccflare proxy)                     │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Subscription Settings:                                  │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Plan: [Claude Max ▼]                                │ │
│ │                                                     │ │
│ │ Alerts:                                             │ │
│ │ [✓] Warn at 80% plan usage                         │ │
│ │ [✓] Warn when rate limited                         │ │
│ │ [ ] Auto-switch to API when rate limited           │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ API Settings (if using API):                           │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Per-agent limit:    [$5.00_____] (0 = unlimited)    │ │
│ │ Per-session limit:  [$20.00____]                    │ │
│ │ Daily limit:        [$50.00____]                    │ │
│ │                                                     │ │
│ │ When limit reached:                                 │ │
│ │ ○ Warn and continue                                 │ │
│ │ ● Pause agent and notify                            │ │
│ │ ○ Stop agent immediately                            │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Display:                                                │
│ [✓] Show usage in agent cards                          │
│ [✓] Show usage in status bar                           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Status Bar

**Subscription mode**:
```
[🤖 3 agents | ⚠ 2 pending | Plan: 67%]
```

**API mode**:
```
[🤖 3 agents | ⚠ 2 pending | $2.47 today]
```

**Both modes**:
```
[🤖 3 agents | ⚠ 2 pending | Plan: 67% | API: $2.47]
```

### Plan Configuration

**Subscription Plans** (user-editable for accuracy):
```json
{
  "plans": {
    "pro": {
      "name": "Claude Pro",
      "monthlyPrice": 20,
      "approximateMessages": 1000,
      "opusLimit": null,
      "features": ["claude-sonnet", "claude-haiku"]
    },
    "max": {
      "name": "Claude Max",
      "monthlyPrice": 100,
      "approximateMessages": 4000,
      "opusLimit": 200,
      "features": ["claude-opus", "claude-sonnet", "claude-haiku"]
    }
  }
}
```

### API Pricing

```json
{
  "models": {
    "claude-sonnet-4-20250514": {
      "inputPer1M": 3.00,
      "outputPer1M": 15.00,
      "cacheWritePer1M": 3.75,
      "cacheReadPer1M": 0.30
    },
    "claude-opus-4-20250514": {
      "inputPer1M": 15.00,
      "outputPer1M": 75.00,
      "cacheWritePer1M": 18.75,
      "cacheReadPer1M": 1.50
    },
    "claude-haiku-3-5-20241022": {
      "inputPer1M": 0.80,
      "outputPer1M": 4.00,
      "cacheWritePer1M": 1.00,
      "cacheReadPer1M": 0.08
    }
  }
}
```

### Historical Data

**Storage** (`.opus-orchestra/usage/`):
```
usage/
├── sessions/
│   ├── 2024-12-10-143052.json
│   └── ...
├── daily/
│   ├── 2024-12-10.json
│   └── ...
└── ccusage-snapshots/
    ├── 2024-12-10.json
    └── ...
```

**Session File Format**:
```json
{
  "sessionId": "session-20241210-143052",
  "startTime": "2024-12-10T14:30:52Z",
  "endTime": "2024-12-10T16:45:00Z",
  "authMode": "both",
  "agents": {
    "agent-1": {
      "source": "subscription",
      "messages": 127,
      "model": "claude-sonnet-4-20250514",
      "task": "task-20241210-120000"
    },
    "agent-2": {
      "source": "api",
      "inputTokens": 45000,
      "outputTokens": 5000,
      "cost": 0.89,
      "model": "claude-sonnet-4-20250514",
      "task": "task-20241210-130000"
    }
  },
  "subscriptionSnapshot": {
    "planUsagePercent": 67,
    "opusUsed": 142,
    "opusLimit": 200
  },
  "apiTotals": {
    "inputTokens": 285000,
    "outputTokens": 27450,
    "cost": 2.47
  }
}
```

### Implementation Steps

1. **Auth Mode Detection**:
   - Detect subscription vs API usage
   - Configure in settings
   - Per-agent source tracking

2. **ccusage Integration**:
   - Run `ccusage` on demand / periodically
   - Parse plan usage output
   - Store snapshots

3. **Token Counting**:
   - Parse Claude Code logs
   - Proxy-layer counting for sandboxed agents
   - Real-time updates

4. **Dashboard Components**:
   - Plan usage display
   - API cost display
   - Per-agent breakdown
   - Combined view

5. **Alerts**:
   - Plan usage thresholds
   - Rate limit detection
   - API budget limits

6. **Status Bar**:
   - Mode-appropriate display
   - Click to expand

7. **Export**:
   - CSV/JSON export
   - Date range filtering

## Open Questions

1. **ccusage accuracy**: How reliable is the plan usage estimate?
2. **Rate limit detection**: How to detect when rate limited?
3. **Subscription + API switching**: Automatic or manual?
4. **Message counting**: How to count for subscription mode?

## Dependencies

- ccusage for subscription tracking
- Claude Code logs
- Proxy layer for sandboxed API tracking

## Risks

- ccusage format changes → abstract parsing
- Plan limits change → user-editable config
- Inaccurate estimates → show as estimates, not exact
