You are working on a resort reservation system for a small resort.

I need you to review and implement a robust reservation system that prevents race conditions, duplicate reservations, and abuse through unpaid reservation requests.

Business Rules

A user can have only ONE active reservation for a specific reservation date.

Multiple users may be allowed to reserve the same date because this is a small resort's booking model.

A reservation is NOT immediately confirmed after the user submits it.

The user must submit a downpayment/payment proof.

An administrator manually reviews and approves or rejects the payment.

An unpaid reservation must NOT permanently block the user's ability to make reservations or allow someone to hold dates indefinitely.

A reservation request should have a payment deadline/expiration period.

Once the payment deadline expires without payment, the reservation should automatically become EXPIRED.

Once a reservation is EXPIRED, the user should be able to make another reservation for that date.

A user must not be able to create multiple simultaneous active reservations for the same date by rapidly clicking/submitting multiple requests.

The backend/database must be the final authority for these rules. Do NOT rely solely on frontend validation.

Required Reservation States

Use a state machine similar to:

PENDING_PAYMENT ↓ PAYMENT_SUBMITTED ↓ CONFIRMED

Possible alternative paths:

PENDING_PAYMENT → EXPIRED

PAYMENT_SUBMITTED → REJECTED

Do not allow invalid state transitions.

For example:

CONFIRMED cannot become PENDING_PAYMENT.

EXPIRED cannot be approved directly.

REJECTED cannot be treated as an active reservation.

An already CONFIRMED reservation cannot be approved twice.

Race Condition Requirement

Handle this scenario correctly:

User A rapidly submits two reservation requests for:

userId = 123 reservationDate = 2026-10-15

Request A and Request B may reach the server at nearly the exact same time.

Both requests must NOT be allowed to pass an ordinary:

check if reservation exists → create reservation

sequence independently.

Implement an atomic/database-level mechanism that guarantees:

(userId, reservationDate)

cannot have more than one active reservation.

The solution must remain safe even if requests arrive concurrently.

If the database supports a unique constraint/index, use it where appropriate.

Active Reservation Definition

Clearly define which statuses count as active.

At minimum, these should normally block another reservation for the same user/date:

PENDING_PAYMENT

PAYMENT_SUBMITTED

CONFIRMED

These should normally NOT block another reservation:

EXPIRED

REJECTED

CANCELLED

However, inspect the existing business logic before implementing this and preserve any intentional existing behavior.

Payment Deadline

When a reservation enters PENDING_PAYMENT, create a payment deadline.

Example:

Reservation created: 2026-10-15 14:00

Payment deadline: 2026-10-15 14:30

If no payment/downpayment is submitted before the deadline:

PENDING_PAYMENT → EXPIRED

Do not depend on the user opening the app for expiration to occur.

Implement expiration using an appropriate backend mechanism such as a scheduled job, cron job, worker, queue, or database-supported mechanism depending on the existing stack.

Also make expiration idempotent so running the expiration process multiple times does not cause problems.

Payment Submission Race Condition

Handle the case where:

the payment deadline is almost reached

the customer submits payment

the expiration process runs at approximately the same time

The system must determine the reservation's state atomically and must not accidentally mark a valid payment submission as expired after it has been accepted.

Do not solve this with frontend timestamps alone.

Admin Approval

The admin manually reviews payment submissions.

Admin approval should:

Verify the reservation is in a valid state.

Verify the payment submission exists.

Atomically transition:

PAYMENT_SUBMITTED → CONFIRMED

Prevent duplicate approval operations.

Prevent two admins from successfully processing the same state transition twice.

Preserve an audit trail of who approved/rejected the payment and when.

If admin rejects the payment:

PAYMENT_SUBMITTED → REJECTED

Make the behavior after rejection explicit and consistent with the active-reservation rules.

Abuse Prevention

A malicious user should not be able to continuously reserve dates without paying and permanently block the system.

Implement reasonable safeguards such as:

automatic expiration of unpaid reservations

one active reservation per user/date

optional limit on the number of simultaneous unpaid reservations per user

optional handling for repeated expired reservations

server-side validation

rate limiting if supported by the existing architecture

Do NOT build an unnecessarily complicated anti-abuse system. This is a small resort and the solution should remain maintainable.

Important

Before changing code:

Inspect the existing reservation model/schema.

Inspect the existing reservation creation endpoint/service.

Inspect availability checking.

Inspect payment submission.

Inspect admin approval/rejection.

Inspect authentication/user identification.

Inspect existing database constraints/indexes.

Identify where concurrent requests could currently create duplicate reservations.

Identify how dates and time zones are currently handled.

Do not blindly rewrite the existing system.

Use the project's existing architecture and technologies whenever possible.

Date Handling

Reservation dates must be handled consistently.

Do not accidentally allow:

2026-10-15 23:59

to be interpreted as:

2026-10-16

because of timezone conversion.

Use the resort's intended timezone consistently for reservation-date calculations and payment deadlines.

Expected Result

The final system should behave like this:

Customer requests Oct 15 ↓ PENDING_PAYMENT ↓ Payment deadline starts │ ├── Payment submitted │ ↓ │ PAYMENT_SUBMITTED │ ↓ │ Admin approves │ ↓ │ CONFIRMED │ └── No payment before deadline ↓ EXPIRED ↓ User can reserve again

If the same user sends two requests for Oct 15 simultaneously:

Request A ──→ SUCCESS Request B ──→ REJECTED AS DUPLICATE

There must never be two active reservations for the same:

userId + reservationDate

Deliverables

After inspecting the project, provide:

A short explanation of the current race-condition vulnerability.

The proposed solution.

The database constraints/indexes required.

The reservation state-transition rules.

The changes needed to the backend.

The changes needed to the frontend, if any.

The expiration mechanism.

The admin approval/rejection logic.

Error responses/messages for duplicate or expired reservations.

Tests for concurrent reservation requests.

Tests for payment deadline expiration.

Tests for simultaneous payment submission and expiration.

Tests for duplicate admin approval.

Tests confirming that rejected/expired reservations no longer block future reservations.

Prioritize correctness, atomicity, and prevention of overbooking/abuse over adding unnecessary features.

KEY NOTE: Only admin and cashier can review and approve/reject payments. The customer cannot approve their own payment.