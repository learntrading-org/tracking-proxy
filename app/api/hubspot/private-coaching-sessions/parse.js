// "4 Private Coaching Sessions" → 4. Missing phrase → 0.
const PRIVATE_COACHING_COUNT = /(\d+)\s+private\s+coaching\b/i;

function countFromText(text) {
  const match = String(text).match(PRIVATE_COACHING_COUNT);
  if (!match) return 0;
  const count = Number.parseInt(match[1], 10);
  return Number.isInteger(count) ? count : 0;
}

function parseDeliverableItems(value, depth = 0) {
  if (value == null || value === "") return [];

  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value !== "string") {
    return parseDeliverableItems(JSON.stringify(value), depth + 1);
  }

  const trimmed = value.trim();
  if (!trimmed) return [];

  if (depth < 3 && (trimmed.startsWith("[") || trimmed.startsWith("\""))) {
    try {
      return parseDeliverableItems(JSON.parse(trimmed), depth + 1);
    } catch {
      if (trimmed.startsWith("[")) return [];
    }
  }

  return trimmed
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// coaching_sessions_only is true when the list has a single item and that
// item is the Private Coaching line (upgrade purchase, add to existing count).
export function parsePrivateCoaching(value) {
  const items = parseDeliverableItems(value);
  const coachingItems = items.filter((item) => PRIVATE_COACHING_COUNT.test(item));

  if (!items.length) {
    return {
      private_coaching_sessions:
        typeof value === "string" ? countFromText(value) : 0,
      coaching_sessions_only: false,
    };
  }

  return {
    private_coaching_sessions: coachingItems.length
      ? countFromText(coachingItems[0])
      : 0,
    coaching_sessions_only: items.length === 1 && coachingItems.length === 1,
  };
}
