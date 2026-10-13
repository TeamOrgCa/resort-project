// Model PostgREST filters, ordering and its 1,000-row response cap without a live database.
export function dashboardDatabase(tables = {}, errors = {}) {
  const compare = (left, right) => typeof left === "string" && typeof right === "string" && left.includes("T") && right.includes("T")
    ? Date.parse(left) - Date.parse(right) : String(left).localeCompare(String(right));
  const calls = [];
  const client = { auth: { getUser: async () => ({ data: { user: { id: "staff" } } }) }, from(table) {
    const filters = [], ordering = []; let selected = "*", head = false, size = 1000;
    let verifiedRange = null, batches = [];
    const result = (from = 0, to = from + size - 1) => {
      calls.push({ table, from, to, selected, head, batches });
      const rows = (tables[table] ?? []).filter(row => filters.every(fn => fn(row)) && (!verifiedRange || compare(row.verified_at ?? row.created_at, verifiedRange[0]) >= 0 && compare(row.verified_at ?? row.created_at, verifiedRange[1]) < 0));
      rows.sort((a, b) => {
        for (const [key, ascending] of ordering) {
          const comparison = String(a[key] ?? "").localeCompare(String(b[key] ?? ""));
          if (comparison) return ascending ? comparison : -comparison;
        }
        return 0;
      });
      return { data: head ? null : rows.slice(from, Math.min(to + 1, from + 1000)), count: head ? rows.length : null, error: errors[table] ? { message: errors[table] } : null };
    };
    const query = {
      select: (columns, options) => { selected = columns; head = Boolean(options?.head); return query; },
      order: (key, options = {}) => { ordering.push([key, options.ascending !== false]); return query; },
      eq: (key, value) => { filters.push(row => row[key] === value); return query; },
      in: (key, values) => { batches.push([...values]); filters.push(row => values.includes(row[key])); return query; },
      gte: (key, value) => { filters.push(row => compare(row[key], value) >= 0); return query; },
      gt: (key, value) => { filters.push(row => compare(row[key], value) > 0); return query; },
      lt: (key, value) => { filters.push(row => compare(row[key], value) < 0); return query; },
      or: value => { verifiedRange = [value.match(/verified_at.gte.([^,]+)/)[1], value.match(/verified_at.lt.([^,)]+)/)[1]]; return query; },
      limit: value => { size = value; return query; },
      range: async (from, to) => result(from, to),
      maybeSingle: async () => { const response = result(); return { ...response, data: response.data[0] ?? null }; },
      then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
    };
    return query;
  } };
  return { client, calls };
}
