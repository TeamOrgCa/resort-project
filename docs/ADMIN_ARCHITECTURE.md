# Admin Architecture

This document describes the admin authentication route and static admin UI structure.

## Goals

- Keep authentication logic clean and isolated.
- Ensure only valid `staff_users` can access admin workflows.
- Keep admin UI modular, readable, and easy to extend.
- Ship static module pages first, then connect each module to backend endpoints incrementally.

## Route Groups

Admin routes are organized with Next.js route groups:

- `app/admin/(auth)/login/page.tsx`
  - Public admin login page.
- `app/admin/(portal)/layout.tsx`
  - Shared admin portal shell with sidebar.
- `app/admin/(portal)/**/page.tsx`
  - Static pages for dashboard and modules.

This keeps the login page separate from portal layout concerns.

## Staff Authentication API

- Endpoint: `POST /api/admin/auth/login`
- File: `app/api/admin/auth/login/route.ts`

### Request Body

```json
{
  "email": "staff@marville.example",
  "password": "your-password"
}
```

### Behavior

1. Validates payload shape (`email`, `password`) using `parseStaffLoginPayload`.
2. Signs in with Supabase Auth via `signInWithPassword`.
3. Looks up authenticated user in `public.staff_users`.
4. Verifies `is_active = true`.
5. Returns normalized success payload with staff profile subset.
6. Signs out and returns `403` if auth user is not a valid/active staff user.

### Response Examples

Success (`200`):

```json
{
  "success": true,
  "message": "Staff authentication successful.",
  "staffUser": {
    "id": "uuid",
    "fullName": "Alex Mendoza",
    "email": "alex@marville.example",
    "role": "admin"
  }
}
```

Error (`400`, `401`, `403`, `500`):

```json
{
  "success": false,
  "message": "Invalid credentials."
}
```

## Auth Utility Layer

- File: `lib/auth/staff-auth.ts`
- Responsibilities:
  - Shared payload parsing and validation.
  - Shared TypeScript types for request/response/profile contracts.

This keeps API handlers focused on flow control and Supabase interactions.

## Admin UI Structure

### Reusable Components

- `components/admin/AdminSidebar.tsx` — navigation shell.
- `components/admin/AdminSectionHeader.tsx` — consistent page heading block.
- `components/admin/AdminMetricCard.tsx` — KPI card for dashboard.
- `components/admin/AdminModuleCard.tsx` — module tiles with links.
- `components/admin/AdminTablePreview.tsx` — static table snapshots.

### Login Components

- `components/admin/auth/AdminLoginPage.tsx` — login screen layout.
- `components/admin/auth/AdminLoginForm.tsx` — client form + API integration.

### Configuration-Driven Content

- `components/admin/content.ts` holds static datasets for navigation, dashboard metrics, modules, and table preview rows.

Keeping static data centralized improves maintainability and avoids hardcoding page-level content repeatedly.

## Implemented Static Module Pages

- `/admin` — dashboard overview.
- `/admin/reservations`
- `/admin/schedules`
- `/admin/transactions`
- `/admin/reports`
- `/admin/analytics`
- `/admin/users`
- `/admin/audit`

All pages are currently static UI placeholders aligned with `SYSTEM_CONTEXT.md` requirements.

## Extension Plan

Recommended incremental next steps:

1. Add server-side route protection for `/admin/(portal)` routes.
2. Add logout endpoint and button for admin sessions.
3. Replace static page datasets with Supabase queries per module.
4. Add action logging inserts into `public.audit_logs`.
5. Add pagination/filter components where records become large.
