import { formatManilaDate, isValidManilaDate, manilaDateKey } from "./manila-date";

function matchesRecordSearch(reference: string, firstDate: string, lastDate: string, search: string, date: string): boolean {
  const includesDate = (value: string) => firstDate <= value && value <= lastDate;
  if (date && !includesDate(date)) return false;
  const query = search.trim().toLowerCase();
  if (!query || reference.toLowerCase().includes(query)) return true;
  if (isValidManilaDate(query)) return includesDate(query);
  return [firstDate, lastDate, formatManilaDate(firstDate), formatManilaDate(lastDate)]
    .some(value => value.toLowerCase().includes(query));
}

/** Search occupied Philippine dates; checkout at midnight belongs to the preceding stay. */
export function matchesBookingSearch(record: { reference: string; startDatetime: string; endDatetime: string }, search: string, date = ""): boolean {
  return matchesRecordSearch(record.reference, manilaDateKey(record.startDatetime), manilaDateKey(new Date(new Date(record.endDatetime).getTime() - 1)), search, date);
}

export function matchesOcularSearch(record: { reference: string; scheduledDate: string }, search: string, date = ""): boolean {
  return matchesRecordSearch(record.reference, record.scheduledDate, record.scheduledDate, search, date);
}
