// Firestore timestamp helpers shared by selectors and analytics.
//
// Firestore Timestamp values carry nanosecond precision. Comparing only
// `.seconds` makes two submissions inside the same second nondeterministic, so
// every "latest" selector should use compareTimestampValues().

function timestampParts(value) {
  if (value == null) return { seconds: 0, nanoseconds: 0 };
  if (typeof value?.seconds === 'number') {
    return {
      seconds: value.seconds,
      nanoseconds: typeof value.nanoseconds === 'number'
        ? value.nanoseconds
        : typeof value._nanoseconds === 'number'
          ? value._nanoseconds
          : 0,
    };
  }
  let millis = 0;
  if (typeof value === 'number') millis = Math.abs(value) < 1e12 ? value * 1000 : value;
  else if (value instanceof Date) millis = value.getTime();
  else if (typeof value.toMillis === 'function') millis = value.toMillis();
  else if (typeof value.toDate === 'function') millis = value.toDate().getTime();
  const seconds = Math.floor(millis / 1000);
  return { seconds, nanoseconds: Math.round((millis - (seconds * 1000)) * 1e6) };
}

/**
 * Convert a Date, Firestore Timestamp-like value, or epoch number to millis.
 * Numeric inputs are treated as milliseconds unless they look like epoch
 * seconds (keeps legacy test fixtures and API payloads convenient).
 */
export function timestampMillis(value) {
  if (value == null) return 0;
  const { seconds, nanoseconds } = timestampParts(value);
  return (seconds * 1000) + (nanoseconds / 1e6);
}

/** Exact chronological comparison for Firestore Timestamp-like values. */
export function compareTimestampValues(left, right) {
  const a = timestampParts(left);
  const b = timestampParts(right);
  if (a.seconds !== b.seconds) return a.seconds < b.seconds ? -1 : 1;
  if (a.nanoseconds === b.nanoseconds) return 0;
  return a.nanoseconds < b.nanoseconds ? -1 : 1;
}

/** Sort callback for timestamp-bearing objects (oldest to newest). */
export function compareTimestampAsc(a, b, field) {
  return compareTimestampValues(a?.[field], b?.[field]);
}

/** Sort callback for timestamp-bearing objects (newest to oldest). */
export function compareTimestampDesc(a, b, field) {
  return compareTimestampValues(b?.[field], a?.[field]);
}

/** Timestamp-like value for optimistic local UI state, including sub-second precision. */
export function clientTimestamp(now = Date.now()) {
  const seconds = Math.floor(now / 1000);
  return { seconds, nanoseconds: (now - (seconds * 1000)) * 1e6 };
}
