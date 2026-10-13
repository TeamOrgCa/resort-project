/** Supabase/PostgREST limits each response; collect every page for range totals. */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ;) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) return rows;
    rows.push(...data);
    from += data.length;
  }
}

/** Keep profile/reference lookups within URL and response limits as well. */
export async function fetchByIds<T>(
  ids: readonly string[],
  fetchPage: (batch: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const unique = [...new Set(ids)];
  const rows: T[] = [];
  for (let i = 0; i < unique.length; i += 200) {
    const batch = unique.slice(i, i + 200);
    rows.push(...await fetchAllPages<T>((from, to) => fetchPage(batch, from, to)));
  }
  return rows;
}
