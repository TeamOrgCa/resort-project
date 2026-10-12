export const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;

// An in-memory PostgREST substitute for exercising the route lifecycle.
export function catalogDatabase(seed = {}) {
  const tables = structuredClone(seed);
  const writes = [];
  let nextId = 100;
  let nextError = null;
  const ids = { services: "service_id", units: "unit_id", unit_rates: "unit_rate_id", guest_rates: "rate_id", payment_methods: "payment_method_id", payment_accounts: "account_id", reservation_policies: "policy_id", ocular_time_slots: "slot_id" };
  const client = {
    tables, writes,
    failNextWrite(error = { code: "XX000", message: "Database failure" }) { nextError = error; },
    from(table) {
      const filters = []; const orders = [];
      let operation = "select"; let values; let range; let head = false;
      const query = {
        select(_columns, options) { head = options?.head ?? false; return query; },
        eq(key, value) { filters.push((row) => row[key] === value); return query; },
        is(key, value) { filters.push((row) => (row[key] ?? null) === value); return query; },
        or(expression) { filters.push((row) => row.is_active !== true || (expression.includes("archived_at") && Boolean(row.archived_at))); return query; },
        ilike(key, pattern) { const term = pattern.slice(1, -1).replace(/\\(.)/g, "$1").toLowerCase(); filters.push((row) => String(row[key] ?? "").toLowerCase().includes(term)); return query; },
        order(key, options) { orders.push({ key, ascending: options?.ascending ?? true }); return query; },
        range(from, to) { range = [from, to]; return query; },
        insert(record) { operation = "insert"; values = record; return query; },
        update(record) { operation = "update"; values = record; return query; },
        async maybeSingle() { const result = await execute(); return { ...result, data: result.data?.[0] ?? null }; },
        single() { return query.maybeSingle(); },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      async function execute() {
        if (operation !== "select" && nextError) { const error = nextError; nextError = null; return { data: null, error }; }
        const rows = tables[table] ?? (tables[table] = []);
        let selected = rows.filter((row) => filters.every((filter) => filter(row)));
        if (operation === "insert") {
          const record = { [ids[table]]: uuid(nextId++), is_active: true, ...(table === "units" ? { archived_at: null } : {}), ...values };
          rows.push(record); selected = [record]; writes.push({ table, operation, values: structuredClone(values) });
        } else if (operation === "update") {
          selected.forEach((row) => Object.assign(row, values));
          writes.push({ table, operation, values: structuredClone(values) });
        }
        selected.sort((left, right) => {
          for (const { key, ascending } of orders) {
            const result = String(left[key] ?? "").localeCompare(String(right[key] ?? ""));
            if (result) return ascending ? result : -result;
          }
          return 0;
        });
        const count = selected.length;
        if (range) selected = selected.slice(range[0], range[1] + 1);
        return { data: head ? null : structuredClone(selected), error: null, count };
      }
      return query;
    },
  };
  return client;
}
