// The legacy schedule is a test fixture, not a runtime pricing fallback.
export const legacyRates = {
  weekday: { day: { baseRate: 7500, addOnPerHead: 125 }, night: { baseRate: 9500, addOnPerHead: 175 }, whole_day: { baseRate: 14500, addOnPerHead: 225 } },
  weekend: { day: { baseRate: 8000, addOnPerHead: 150 }, night: { baseRate: 10000, addOnPerHead: 200 }, whole_day: { baseRate: 15000, addOnPerHead: 250 } },
};
