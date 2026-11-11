export function getUserTimezone(): string {
  return process.env.USER_TIMEZONE || "UTC";
}

export function getDateStringWithOffset(offsetDays = 0, timeZone = getUserTimezone()): string {
  const now = new Date();
  // Format in target timezone to get accurate local year/month/day
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const localTodayParts = formatter.formatToParts(now);
  const year = Number(localTodayParts.find((p) => p.type === "year")?.value);
  const month = Number(localTodayParts.find((p) => p.type === "month")?.value);
  const day = Number(localTodayParts.find((p) => p.type === "day")?.value);

  const utcAnchor = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return utcAnchor.toISOString().slice(0, 10);
}

export function getTodayDateStr(): string {
  return getDateStringWithOffset(0);
}

export function getTomorrowDateStr(): string {
  return getDateStringWithOffset(1);
}

export function getYesterdayDateStr(): string {
  return getDateStringWithOffset(-1);
}

export function formatReadableDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDate);
}
