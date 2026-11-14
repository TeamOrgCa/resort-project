# Supabase entity relationship diagram

Open [SUPABASE_ERD.pdf](SUPABASE_ERD.pdf) for the eight-page vector PDF, or
[SUPABASE_ERD.html](SUPABASE_ERD.html) for a self-contained browser viewer with
fit-to-window and full-size modes. The PDF contains an A1 overview, four A2
detail diagrams, a dedicated A3 public-access collections diagram, and two A3 relationship reference pages. Print with “fit to
page” when using smaller paper; use the detail pages for readable columns.

The snapshot was captured on **14 November 2026, Asia/Manila** from the configured
Supabase project's live public PostgREST metadata. It contains **34 tables,
367 columns, 49 verified live foreign-key links, and 7 separately marked logical
links**. Every table has a full-column card on a detail page. Supabase-managed
`auth`, `storage`, and extension schemas are outside this public-schema export.

The updated schema includes the deployed `public_access_sales` table, its
`payment_method_id → payment_methods` and `cashier_id → staff_users` foreign keys,
and the legal-policy version/acceptance columns and links. Public sale guest/contact
and method-name snapshots are values, with no private reservation or guest-profile
foreign key. The public receipt identity is stored on the sale itself.

Preview: [complete ERD](previews/page-1.png) · [public-access detail](previews/page-4.png).

## Evidence and notation

- `PK`: live primary-key annotation.
- `FK` and solid line: live foreign-key annotation.
- `LK` and dashed amber line: a relationship declared in repository SQL, but not
  exposed as a foreign key in the current live API schema cache. Each of the
  seven links was checked with a zero-row embedding, which returned `PGRST200`.
- `*`: NOT NULL according to the live API schema.
- Circle: optional; bar: one; crow's foot: many.

The seven logical links are `receipts.payment_id`, `transactions.reservation_id`,
`invoices.reservation_id`, `reservation_reschedules.reservation_id`,
`reservation_services.reservation_id`, `reservation_units.reservation_id`, and
`reviews.reservation_id` to the corresponding payment or reservation primary key.

No direct PostgreSQL catalog connection was available. Missing API relationships
can reflect either absent constraints or schema-cache differences; the export
does not claim these links are physically enforced. Live FK child multiplicity
is shown with a conservative 0..many bound because this metadata does not expose
all unique constraints. The three logical receipt/transaction/invoice links use
the 0..1 child bound declared in repository SQL, explicitly unverified in the
live catalog. Expression and partial unique indexes are outside this export.

Notification recipient/actor/entity IDs, audit entity IDs, JSON snapshots and
other identifier-like fields are not presented as physical foreign keys without
metadata evidence. Repository-only `auth.users` links are mentioned in the PDF
notes; they are outside the live public-schema snapshot.

## Regenerate

Use the project's installed dependencies. Run from the repository root:

```powershell
# Optional: refresh live schema metadata using the existing local environment.
node --env-file=.env docs/erd/capture-supabase-schema.mjs

# Build offline from the captured metadata.
node docs/erd/build-erd.mjs
```

The capture script reads schema metadata and validates relationships using
zero-row queries. It does not read customer records or change the database.
Credentials remain in the environment and are not copied into these artifacts.

`SUPABASE_ERD.mmd` is editable Mermaid source. `diagram-*.svg` files are vector
page exports. `supabase-schema.json` preserves the metadata evidence;
`validation.json` records table/column coverage, relationship counts, layout
checks and PDF page count. `previews/` contains raster layout previews.
