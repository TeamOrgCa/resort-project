# Development

The developers built the MarVille Resort Management System as a web application that connects guest reservations with the resort's operational records. The system brings together online booking, ocular visit scheduling, payment recording, billing, reservation management, guest feedback, reporting, and account administration. Its development emphasized functional correctness, data integrity, controlled access, usability, and maintainability.

This section describes the development practices reflected in the project's source code, configuration, database scripts, tests, and documentation. References to standards concern the engineering practices implemented in the project; they do not represent formal certification or an independent compliance assessment.

## Development Approach

The implementation reflects an iterative and incremental development approach. The developers divided the system into related modules and extended them through application changes, database migrations, and regression tests. This allowed individual workflows to be refined while retaining the reservation, payment, and audit records on which other modules depended.

For example, payment handling was extended to include receipt screening, authorized cash recording, billing emails, and PDF attachments. Reservation management was expanded to cover actual check-in and checkout, guest edits, rescheduling charges, and timed maintenance. Separate migration files document these changes and their prerequisites. This approach supports controlled improvements without requiring the entire system to be rebuilt for each change.

## Requirements Analysis and Business Rules

The developers used the project's resort and system context documents to translate business requirements into application behavior. These documents describe resort packages, guest information, booking schedules, payments, services, and the responsibilities of authorized personnel. Later workflow documents and implementation changes refine the initial requirements.

The requirements were organized around two connected areas. The guest website provides registration, booking, payment submission, booking management, reviews, and assistance. The management portal provides reservation calendars, manual booking, payment and refund processing, records, reports, analytics, account management, configuration, and audit logs.

Business rules were implemented as explicit conditions. Online bookings require a future package start with the required lead time. Guest counts must satisfy capacity rules, and Philippine mobile numbers are normalized and validated. Booking changes depend on ownership, reservation status, attendance, and unresolved financial reviews. Checkout requires recorded check-in and full settlement using verified payments less completed refunds.

The developers also distinguished business events that must remain separate. Recording arrival does not settle a bill, submitting payment evidence does not always verify payment, and reaching a scheduled departure time does not automatically complete a stay. These distinctions help keep operational records consistent with actual events.

## Technology Selection and Development Environment

The system uses the following technologies, as declared in the project configuration:

| Technology | Use in development |
| --- | --- |
| Next.js 16 and React 19 | Application pages, routing, reusable interfaces, and server API handlers |
| TypeScript | Typed application models, function contracts, and compile-time checks |
| Tailwind CSS | Shared styling and responsive layouts |
| Supabase | PostgreSQL database access, authentication, and file storage |
| Zustand | Booking draft state across guest booking steps |
| Tesseract.js and Sharp | Receipt text recognition and image inspection |
| Nodemailer | Application-generated transactional emails |
| pdf-lib and fontkit | PDF invoices and receipts with embedded fonts |
| Google Generative AI SDK | AI-assisted chatbot responses |
| ESLint, Node.js test runner, JSDOM, and PGlite | Static analysis and automated verification |

The dependency manifest and lockfile record the application dependencies. Development settings are supplied through environment variables, while `.gitignore` excludes environment files, installed dependencies, and generated build output. Privileged database credentials and external service credentials are read by server code.

## System Architecture and Coding Standards

The developers separated page presentation, reusable components, business logic, and database operations. The `app/` directory contains pages and API routes, `components/` contains shared interfaces, and `lib/` contains authentication helpers, validation, booking calculations, reports, and server services. Database changes and workflow explanations are maintained separately in SQL and Markdown files.

This organization applies separation of concerns. A booking page handles interaction, a shared pricing function calculates charges, an API validates the request, and database functions enforce the relevant persistence rules. Shared dialogs, phone inputs, calendars, pagination controls, and status filters reduce duplicated interface behavior.

TypeScript strict mode is enabled to help detect incompatible values and missing cases during development. Interfaces and type definitions describe reservation payloads, roles, permissions, billing results, and other records. ESLint uses the Next.js Core Web Vitals and TypeScript configurations to check code against the configured framework rules.

Business rules that appear in several workflows are placed in shared modules where practical. Centralized date handling, phone validation, package pricing, and billing breakdowns help prevent different screens from interpreting the same data differently.

## Database Design and Data Integrity

The developers used a relational PostgreSQL database to connect guests, staff, reservations, payments, invoices, receipts, services, ocular visits, notifications, and audit records. Registered guests and walk-in guests have separate records so staff can encode offline bookings without treating them as registered accounts.

Primary keys identify individual records, foreign keys maintain relationships, and check constraints restrict allowed values and invalid combinations. For example, reservation records require an end time later than the start time. Row Level Security policies restrict access to protected data according to the authenticated identity and applicable rules.

Critical workflows use database functions and transactions to update related records together. Verified payment processing can update payment status, booking confirmation, financial totals, receipt issuance, and audit history in one committed operation. This reduces the risk of saving only part of a financial change.

Timed maintenance and ocular scheduling use database locks and overlap checks to coordinate competing requests. Availability is therefore checked beyond the calendar interface, where simultaneous submissions could otherwise bypass a displayed availability result.

The developers also preserved historical values. Booked package rates, service prices, issued receipt amounts, and relevant policy versions are retained so later catalog or policy changes do not silently rewrite the basis of earlier transactions. Schema and workflow updates are supplied through migration scripts with documented dependencies.

## User Interface Development

The guest interface was organized around a staged booking process: choosing a package and schedule, entering guest details and services, reviewing the reservation, and submitting payment. A shared booking state carries the draft between steps. Validation and navigation guards prevent progression when required information or a saved reservation is missing.

The management interface uses reusable navigation, calendars, tables, record dialogs, and action menus. Search, filters, sorting, and pagination help staff locate records. Calendar labels distinguish reservation status, maintenance closures, and items needing attention. Loading, success, and error messages explain the result of an action.

Responsive layouts accommodate desktop and mobile screens. Keyboard interactions, descriptive labels, visible status text, focus handling, and reduced-motion behavior support usability. Unsaved-change prompts protect edited forms from accidental dismissal. These are implemented usability measures; full accessibility conformance would require a separate assessment.

## Authentication, Authorization, and Input Validation

The developers used Supabase authentication to establish user identity and added application checks for account status, guest ownership, staff roles, and granted permissions. Protected actions validate access on the server, while navigation and interface controls reflect the same restrictions.

Role-based access follows the principle of least privilege. Administrators manage users, configuration, and the business catalog, with defined viewing and export access elsewhere. Operational permissions are assigned to managers and cashiers. Refund requests go directly to authorized managers for approval or rejection. Cashiers record approved transfers, and managers verify them before completion. No initial cashier review is required, and the payout submitter cannot verify the same transfer. Timed maintenance has an explicit administrator exception to the general operational restrictions.

Input validation is applied at several levels. Form checks provide immediate feedback, API checks validate submitted payloads, and database rules protect stored data. Validation covers names, email addresses, Philippine mobile numbers, guest counts, dates, amounts, uploaded images, and required reasons for sensitive actions.

Payment proof handling checks file ownership, allowed image formats, actual image content, and size limits. Server services use privileged database access only within their intended workflows. Public availability responses provide aggregate availability without exposing guest identities or private maintenance reasons.

## Booking, Payment, and Billing Implementation

The developers implemented pricing through shared calculations using the selected package, guest count, services, and stored rate information. Reservation edits update the current bill while preserving existing payments and historical receipts. Rescheduling charges and cancellation deductions are represented explicitly so their effect can be explained and audited.

Online payment handling uses GCash payment evidence. When enabled, OCR inspects receipt information such as amount, reference, recipient, and transaction time. Eligible consistent results use a restricted server workflow for automatic approval; the manual-review path keeps submissions pending until authorized staff verifies them. Staff can also record cash received at the resort through an authorized workflow.

The current source includes a beta receipt-reuse flag that relaxes selected reference and date checks for testing. Consequently, the development configuration should not be described as enforcing every normal payment validation rule. OCR consistency is also distinct from independent confirmation by a payment provider.

Invoices show the current bill and verified payment position, while receipts preserve the values recorded when issued. Billing emails include PDF attachments with itemized charges, references, balances, and Philippine booking times. Delivery flags help prevent repeated document emails during normal replays, and failed delivery can remain retryable without reversing a successfully recorded payment.

## Time Handling, Reports, and Supporting Features

The developers centralized date and time handling around `Asia/Manila`. Calendars, package schedules, booking lead times, report periods, emails, and receipt dates use Philippine time. Database timestamps preserve absolute instants rather than being manually shifted by eight hours. This avoids differing results when a guest device and the application server use different timezones.

Reports and analytics derive their results from stored operational data and the selected reporting period. Shared period calculations help align displayed summaries and exported reports. Database pagination helpers retrieve complete matching datasets where needed, rather than relying on a single limited response. Printed report charts use SVG graphics for clearer output.

Notifications communicate booking and transaction events with explicit read and unread states. The chatbot uses approved FAQ content, current configuration, and authorized own-booking information where applicable. Rate limits and input/output controls constrain chatbot requests. These supporting features complement the reservation and billing workflows.

## Testing and Quality Assurance

The repository contains automated tests for business calculations, validation, API authorization, interface behavior, SQL workflows, and generated billing documents. The developers used different verification methods according to the behavior being checked:

| Verification method | Purpose and examples |
| --- | --- |
| Unit tests | Check pricing, phone validation, guest counts, date handling, and reschedule charges |
| API tests | Check request validation, ownership, permissions, and allowed workflow transitions |
| JSDOM interface tests | Exercise forms, dialogs, input feedback, menus, and other component behavior |
| PGlite database tests | Execute selected SQL migrations and verify constraints, permissions, and transactional outcomes |
| Document tests | Check PDF contents, references, money values, page boundaries, and long-invoice pagination |
| Browser layout script | Check selected interface fixtures in an installed Chromium browser |
| Optional integration tests | Exercise selected configured external-service workflows when explicitly enabled |

Static verification is supported by `npm run lint` and `npx tsc --noEmit`, while `npm run build` checks production compilation. Regression tests provide repeatable checks when a workflow changes.

The presence of these tests does not establish that every test or live workflow has passed in a deployed environment. Actual email delivery, live authentication configuration, payment review, and complete guest-to-staff workflows require execution against a suitably configured test installation. Verification results should record what was run, its outcome, and any remaining limits.

## Deployment Preparation and Maintenance

Deployment preparation involves matching the application version with its required database migrations, configuring authentication redirects and external services, and supplying the required environment variables. Migration prerequisites must be reviewed because newer functions can depend on earlier schema or permission changes.

The Next.js configuration includes runtime assets needed by OCR and billing documents, including language data, the email logo, and the PDF font. Packaging these assets helps server routes work consistently outside the local development environment.

Maintenance is supported by workflow documentation, user manuals, SQL migration notes, reusable components, and audit records. Changes to booking rules or financial behavior can be reviewed against their effects on stored records and relevant regression tests. The repository documents deployment preparation but does not, by itself, establish that a particular production deployment or acceptance exercise has occurred.

## Application of Development Standards

The following practices connect the implementation to the quality standards used during development:

| Engineering principle | Application in the system |
| --- | --- |
| Functional correctness | Explicit booking rules, validated state transitions, and shared billing calculations |
| Maintainability | Modular directories, reusable components, strict typing, and workflow documentation |
| Data integrity | Relational constraints, transactional updates, historical snapshots, and database locks |
| Access control | Authentication, ownership checks, role permissions, and Row Level Security |
| Accountability | Audit entries for sensitive reservation, payment, refund, and account actions |
| Usability | Responsive layouts, readable status labels, validation feedback, and guarded forms |
| Consistency | Shared Philippine time handling, input normalization, and centralized business rules |
| Verifiability | Automated tests, static checks, migration tests, and documented validation limits |
| Controlled change | Dependency lockfile, migration prerequisites, preserved financial history, and regression checks |

These practices provide concrete evidence of how the developers addressed software quality within the implemented system. Claims of formal security certification, legal compliance, accessibility certification, or complete production readiness require separate evidence and assessment.

## Project References

- [Resort context and current workflow updates](../RESORT_CONTEXT.md)
- [Technology dependencies and development commands](../package.json)
- [TypeScript configuration](../tsconfig.json) and [ESLint configuration](../eslint.config.mjs)
- [Database schema](../updated-schema.sql) and [timed maintenance migration](timed-maintenance-auto-ocular-migration.sql)
- [Role and permission implementation](../lib/auth/role-access.ts)
- [Receipt OCR implementation and testing flags](../lib/server/gcash-ocr.ts)
- [Billing email implementation](../lib/server/billing-email.ts) and [PDF generation](../lib/server/billing-pdf.ts)
- [Philippine timezone conventions](TIMEZONE.md)
- [Automated tests](../tests/) and [mobile layout verification script](../scripts/check-mobile-layout.mjs)
- [User manual overview](USER_MANUAL.md)
