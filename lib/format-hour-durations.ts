/** Remove decimal padding from hour durations without rounding fractional stays. */
export function formatHourDurations(value: string): string {
  return value.replace(/\b(\d+)\.(\d+)(?=\s+hours?\b)/gi, (_match, whole: string, fraction: string) => {
    const significant = fraction.replace(/0+$/, "");
    return significant ? `${whole}.${significant}` : whole;
  });
}
