const DAY_MS = 86_400_000;

export function rescheduleNoticeFee(originalStart: string, now = Date.now()): number {
  const daysNotice = (new Date(originalStart).getTime() - now) / DAY_MS;
  return daysNotice >= 6 ? 50 : daysNotice >= 3 ? 100 : daysNotice >= 1 ? 300 : 500;
}

export function positiveRateAdjustment(oldPrice: number, newPrice: number): number {
  return Math.max(0, Math.round((newPrice - oldPrice) * 100) / 100);
}
