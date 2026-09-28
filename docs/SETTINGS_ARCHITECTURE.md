# Configuration Management

## Recommendation

Use **Option A: one row per setting**. Each key is stable and namespaced, for example `reservation.downpayment_percentage` or `payments.receipt_settings`. The JSONB value supports strings, numbers, booleans, arrays, and small structured objects without requiring a migration for every business change.

Grouped JSON would reduce row count, but makes partial updates, auditing, concurrent edits, validation, and future permissions harder. One row per setting also supports indexed lookups and a single batch query. Keep values small; large templates or media belong in dedicated tables/storage.

## Runtime architecture

- `lib/settings/catalog.ts` is the typed catalog of supported keys, defaults, input types, and descriptions.
- `lib/settings/settingsService.ts` is the server-side source of truth for batch reads and upserts.
- `app/api/admin/settings/route.ts` exposes one admin-only `GET` and one batch `PATCH` endpoint and writes an audit event.
- `components/settings/SettingsProvider.tsx` loads settings once for the admin shell and exposes `useSettings()` to child components.
- `app/admin/(portal)/configuration/page.tsx` is schema-driven. Adding a new business value means adding a catalog definition, not duplicating form or API code.

Business-rule consumers should receive settings as an input rather than importing constants. Server workflows should call `getAllSettings()` once per request and pass the resulting map into pricing, booking-policy, notification, or payment functions. The next migration step is replacing existing literals in those consumers with namespaced keys from this catalog.

## API contract

`GET /api/admin/settings` returns one object containing all persisted settings plus catalog defaults for keys not yet seeded:

```json
{ "success": true, "settings": { "reservation.downpayment_percentage": 20 } }
```

`PATCH /api/admin/settings` accepts a batch and returns the complete post-save map:

```json
{
  "updates": [
    { "key": "reservation.downpayment_percentage", "value": 25 },
    { "key": "payments.accepted_methods", "value": ["GCash"] }
  ]
}
```

Unknown keys are rejected. The route requires an active admin session; database RLS provides a second authorization boundary.

## Caching and refresh

1. On mount, `SettingsProvider` reads a five-minute browser cache and renders it immediately when available.
2. It performs one stale-while-revalidate request to `GET /api/admin/settings`.
3. A successful read replaces the context and local cache in one operation.
4. A save uses one batch `PATCH`, then replaces the cache with the server response.
5. A `storage` event broadcasts the change marker to other open tabs. They refresh only after a settings update, not on a polling interval.

For changes made outside the portal, enable Supabase Realtime for `business_settings` and call the provider's `refresh()` from a subscription. This is intentionally a deployment-level opt-in because it requires adding the table to the project's realtime publication. Until enabled, the five-minute stale window is the fallback.

## Supabase operations

```ts
const { data, error } = await supabase
  .from("business_settings")
  .select("setting_key, setting_value, description, updated_at")
  .order("setting_key");

await supabase.from("business_settings").upsert(
  updates.map(({ key, value }) => ({
    setting_key: key,
    setting_value: value,
    updated_at: new Date().toISOString(),
  })),
  { onConflict: "setting_key" }
);
```

## Folder structure

```text
lib/settings/
  catalog.ts
  settingsService.ts
  types.ts
components/settings/
  SettingsProvider.tsx
app/api/admin/settings/route.ts
app/admin/(portal)/configuration/page.tsx
docs/SETTINGS_ARCHITECTURE.md
```

## UI design

The configuration page uses category tabs for Resort Information, Reservation Settings, Ocular Visit Settings, Payment Settings, and Notification Settings. Each field displays its description, uses an appropriate control, and saves only the active category as one batch. JSON fields cover extensible contact lists, social links, templates, payment rules, and alert preferences while keeping the first version compact.

Before production rollout, add field-level validation for numeric ranges and JSON schemas, a change-history table or audit payload containing before/after values, and a confirmation dialog for high-impact settings such as cancellation and payment rules.