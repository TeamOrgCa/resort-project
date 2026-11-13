-- Apply after the existing catalog, guest registration and booking migrations.
-- Published legal versions reuse reservation_policies. No new table is created.
begin;

alter table public.reservation_policies
  add column if not exists document_type text not null default 'general',
  add column if not exists version integer not null default 1,
  add column if not exists published_at timestamptz not null default now(),
  add column if not exists published_by uuid references public.staff_users(id),
  add column if not exists change_note text not null default '';
alter table public.reservation_policies drop constraint if exists legal_policy_document_type_check;
alter table public.reservation_policies add constraint legal_policy_document_type_check check(document_type in ('general','terms','privacy') and version between 1 and 999999999);
create unique index if not exists legal_policy_version_unique on public.reservation_policies(document_type,version) where document_type in ('terms','privacy');
create unique index if not exists legal_policy_current_unique on public.reservation_policies(document_type) where document_type in ('terms','privacy') and is_active;

-- Import the exact existing website documents as version 1. Existing general
-- catalog policy records are retained and never overwrite either document.
insert into public.reservation_policies(title,content,document_type,version,change_note,is_active)
select 'Terms and Conditions', $baseline_terms$# 1. Reservations and payment

A booking request is subject to availability. A reservation is saved when you submit it, and payment proof remains pending until resort staff verifies the actual transaction. A submitted screenshot or reference number does not by itself confirm payment.

You may pay a 20% down payment or the full amount shown at checkout. Any remaining balance must be paid upon arrival before swimming. Keep your booking reference and payment confirmation for check-in.

# 2. Package rates and guest count

The displayed booking quote shows the applicable package rate, selected services, and additional guest charges. Packages include up to 20 guests; up to 10 additional guests may be added at the per-head rate shown at checkout, for a maximum of 30 guests in total. Adults and children both count toward this limit.

The booking summary is the amount to review before saving. Ask the resort about holiday rates or special arrangements before paying if the displayed quote does not match your expected rate.

# 3. Changes and cancellation

The cancellation notice and refund rules for your reservation are the booking policy version displayed above and saved with your reservation. Standard rescheduling notice is 14 Philippine calendar days for an original swimming date in March-May or September-December, or 7 days in other months. Guests with confirmed reservations who have not checked in may also submit shorter-notice, same-day or past-date requests through Manage Booking. Available future dates are approved automatically without staff review; the new start must be at least 30 minutes away. The booked package, original start time and duration remain fixed.

Change fees are ₱50 for six or more calendar days' notice, ₱100 for three to five days, ₱300 for one to two days, and ₱500 on or after the original swimming date. On-time reschedules carry the ₱50 fee plus any higher-date-rate adjustment. Saving a valid reschedule immediately updates the schedule and adds the displayed charges to your bill, including for short-notice changes. A cheaper date does not automatically reduce the bill.

# 4. Included amenities and optional charges

The private pool package lists a cottage, two air-conditioned rooms with beds and private toilets, videoke, griller, parking, and the food inclusions shown in the booking offer. Availability and any selected add-ons appear in the booking summary.

Listed optional charges include ₱200 corkage for outside food and drinks, additional rooms at the regular rate, extra mattress foam at ₱300, cooking from ₱150, swimming extension at ₱500 per hour per 20 guests, and an electricity charge for appliances. Confirm any optional charge and availability with staff before use.

# 5. Guest safety and conduct

Children should be accompanied by adults, especially near the pool. Follow lifeguard and staff instructions. Do not swim while intoxicated. Report hazards or emergencies to staff immediately. Fake or prank drowning may result in removal from the resort; emergency responders may be contacted when needed.

Please keep personal belongings attended and report lost or damaged items promptly. Guests are responsible for their own conduct and for following posted resort rules. Nothing in these terms removes rights or responsibilities that cannot legally be excluded.

# 6. Contact

For a booking, payment, schedule change, or special arrangement, contact MarVille Resort Complex at emailmarvilleresort@gmail.com or 09172796592 / 82360633. The resort is at Cabrera Road, Hapay na Mangga, Brgy. Dolores, Taytay, Rizal 1920.$baseline_terms$,'terms',1,'Imported from website legal version 2026-10',true
where not exists(select 1 from public.reservation_policies where document_type='terms');
insert into public.reservation_policies(title,content,document_type,version,change_note,is_active)
select 'Privacy Policy', $baseline_privacy$# 1. Information we collect

When you create an account, book, pay, or contact us, we may collect:

- Name, email address, phone number, and address
- Account and authentication information
- Reservation dates, guest counts, selected packages, services, and requests
- Payment details and proof of payment, including information visible in an uploaded image
- Transaction history and messages sent to the resort

# 2. Why and how we use it

We use this information to create and manage reservations, check availability, verify payments, send confirmations and billing documents, assist guests, maintain accounts, prevent unauthorized activity, and keep operational and accounting records. We process information needed to provide the service you request and to meet applicable legal obligations. We do not use booking information for unrelated marketing without a separate basis.

Passwords are handled by our authentication provider; the resort does not store them in plain text. We do not ask for or store your GCash password or PIN.

# 3. Who may receive it

Authorized resort administrators, managers, and cashiers may access information needed for their duties. Service providers supporting website hosting, authentication, database storage, email delivery, and payments may process the information needed to provide those services. Payment providers, including GCash when used, have their own privacy practices. We may disclose information when required by law or a lawful request. We do not sell or rent guest information.

# 4. Security and retention

We use access controls, authentication, and other reasonable safeguards to protect guest information. No electronic system can guarantee absolute security.

We retain account, reservation, payment, and communication records while needed to provide services and meet operational, accounting, security, and legal requirements. When those purposes end, we take reasonable steps to delete, anonymize, or securely dispose of information, subject to any required retention. Contact us for details about the period applicable to your records.

# 5. Cookies and sessions

The website uses essential cookies or similar technology to maintain signed-in sessions, protect accounts, and provide core website functions.

# 6. Your rights

Under applicable Philippine data privacy law, you may ask to be informed about processing, access or correct your information, object to certain processing, and request erasure or blocking where allowed. You may also raise a privacy complaint with the National Privacy Commission. We may need to verify your identity and retain records where the law or an ongoing transaction requires it.

# 7. Updates and contact

We may update this policy when our services or practices change. The current version will be available on this website with its revision date.

For privacy questions or requests, contact MarVille Resort Complex at emailmarvilleresort@gmail.com or 09172796592 / 82360633, or visit Cabrera Road, Hapay na Mangga, Brgy. Dolores, Taytay, Rizal 1920.$baseline_privacy$,'privacy',1,'Imported from website legal version 2026-10',true
where not exists(select 1 from public.reservation_policies where document_type='privacy');

create or replace function public.protect_published_legal_policy()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then
    if old.document_type in ('terms','privacy') then raise exception 'Published policy versions cannot be deleted' using errcode='42501'; end if;
    return old;
  end if;
  if tg_op='UPDATE' and old.document_type in ('terms','privacy') then
    if row(new.policy_id,new.document_type,new.version,new.title,new.content,new.published_at,new.published_by,new.change_note)
      is distinct from row(old.policy_id,old.document_type,old.version,old.title,old.content,old.published_at,old.published_by,old.change_note) then
      raise exception 'Published policy text is immutable. Publish a new version' using errcode='42501';
    end if;
    if new.is_active is distinct from old.is_active and current_setting('app.legal_policy_publish',true) is distinct from 'true' then
      raise exception 'Publish a new policy version instead of archiving or restoring it' using errcode='42501'; end if;
  elsif new.document_type in ('terms','privacy') and current_setting('app.legal_policy_publish',true) is distinct from 'true' then
    raise exception 'Use the legal policy publisher to create legal versions' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.protect_published_legal_policy() from public,anon,authenticated;
drop trigger if exists protect_published_legal_policy on public.reservation_policies;
create trigger protect_published_legal_policy before insert or update or delete on public.reservation_policies
for each row execute function public.protect_published_legal_policy();

alter table public.reservation_policies enable row level security;
drop policy if exists "Read general catalog policies" on public.reservation_policies;
create policy "Read general catalog policies" on public.reservation_policies for select to anon,authenticated using(document_type='general');
drop policy if exists "Legal history is administrator only" on public.reservation_policies;
create policy "Legal history is administrator only" on public.reservation_policies as restrictive for select to anon,authenticated
using(document_type='general' or exists(select 1 from public.staff_users where id=auth.uid() and is_active and role='admin'));
drop policy if exists "Administrators manage legal policies" on public.reservation_policies;
create policy "Administrators manage legal policies" on public.reservation_policies for all to authenticated
using(exists(select 1 from public.staff_users where id=auth.uid() and is_active and role='admin'))
with check(exists(select 1 from public.staff_users where id=auth.uid() and is_active and role='admin'));

create or replace function public.get_legal_policies(p_terms_id uuid default null,p_privacy_id uuid default null)
returns table(policy_id uuid,document_type text,version integer,title text,content text,published_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
  select p.policy_id,p.document_type,p.version,p.title,p.content,p.published_at from public.reservation_policies p
  where (p.document_type='terms' and case when p_terms_id is null then p.is_active else p.policy_id=p_terms_id end)
    or (p.document_type='privacy' and case when p_privacy_id is null then p.is_active else p.policy_id=p_privacy_id end);
$$;
revoke all on function public.get_legal_policies(uuid,uuid) from public;
grant execute on function public.get_legal_policies(uuid,uuid) to anon,authenticated,service_role;

create or replace function public.get_baseline_legal_policies()
returns table(policy_id uuid,document_type text) language sql stable security definer set search_path=public,pg_temp as $$
  select p.policy_id,p.document_type from public.reservation_policies p where p.document_type in ('terms','privacy') and p.version=1;
$$;
revoke all on function public.get_baseline_legal_policies() from public;
grant execute on function public.get_baseline_legal_policies() to anon,authenticated,service_role;

create or replace function public.publish_legal_policy(p_document_type text,p_title text,p_content text,p_change_note text,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_previous public.reservation_policies%rowtype; v_next public.reservation_policies%rowtype;
  v_actor uuid:=auth.uid(); v_setting text:=current_setting('app.legal_policy_publish',true);
begin
  if not exists(select 1 from public.staff_users where id=v_actor and is_active and role='admin') then raise exception 'Admin access required' using errcode='42501'; end if;
  if p_document_type not in ('terms','privacy') or p_document_type is null or p_expected_version is null
    or length(btrim(coalesce(p_title,''))) not between 3 and 200 or length(btrim(coalesce(p_content,''))) not between 20 and 50000
    or length(btrim(coalesce(p_change_note,''))) not between 1 and 1000 then raise exception 'Enter valid policy text and a reason for the revision' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(82453197);
  select * into v_previous from public.reservation_policies where document_type=p_document_type and is_active for update;
  if not found or v_previous.version<>p_expected_version then raise exception 'This policy changed. Reload the current version before publishing' using errcode='40001'; end if;
  if v_previous.title=btrim(p_title) and v_previous.content=btrim(p_content) then raise exception 'No policy text changed' using errcode='22023'; end if;
  perform set_config('app.legal_policy_publish','true',true);
  update public.reservation_policies set is_active=false where policy_id=v_previous.policy_id;
  insert into public.reservation_policies(title,content,document_type,version,published_by,change_note,is_active)
  values(btrim(p_title),btrim(p_content),p_document_type,v_previous.version+1,v_actor,btrim(p_change_note),true) returning * into v_next;
  insert into public.audit_logs(user_id,auth_user_id,action,entity_type,entity_id,details)
  values(v_actor,v_actor,'Published legal policy version','reservation_policies',v_next.policy_id,
    jsonb_build_object('document_type',p_document_type,'previous_policy_id',v_previous.policy_id,'previous_version',v_previous.version,'new_version',v_next.version,'change_note',v_next.change_note));
  perform set_config('app.legal_policy_publish',coalesce(v_setting,''),true);
  return to_jsonb(v_next);
end $$;
revoke all on function public.publish_legal_policy(text,text,text,text,integer) from public,anon;
grant execute on function public.publish_legal_policy(text,text,text,text,integer) to authenticated;

alter table public.reservations
  add column if not exists terms_policy_id uuid references public.reservation_policies(policy_id),
  add column if not exists privacy_policy_id uuid references public.reservation_policies(policy_id),
  add column if not exists legal_accepted_at timestamptz;
alter table public.guests
  add column if not exists terms_policy_id uuid references public.reservation_policies(policy_id),
  add column if not exists privacy_policy_id uuid references public.reservation_policies(policy_id),
  add column if not exists legal_accepted_at timestamptz;

create or replace function public.validate_current_legal_pair(p_terms uuid,p_privacy uuid)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_terms integer; v_privacy integer;
begin
  select version into v_terms from public.reservation_policies where policy_id=p_terms and document_type='terms' and is_active for share;
  select version into v_privacy from public.reservation_policies where policy_id=p_privacy and document_type='privacy' and is_active for share;
  if v_terms is null or v_privacy is null then raise exception 'The legal policies changed. Reload, read and agree again' using errcode='40001'; end if;
  return format('terms:%s;privacy:%s',v_terms,v_privacy);
end $$;
revoke all on function public.validate_current_legal_pair(uuid,uuid) from public,anon,authenticated;

create or replace function public.stamp_reservation_legal_consent()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' then
    if row(new.terms_policy_id,new.privacy_policy_id,new.legal_accepted_at) is distinct from row(old.terms_policy_id,old.privacy_policy_id,old.legal_accepted_at) then
      raise exception 'The legal versions accepted for a booking cannot be changed' using errcode='42501'; end if;
  elsif new.terms_policy_id is not null or new.privacy_policy_id is not null then
    perform public.validate_current_legal_pair(new.terms_policy_id,new.privacy_policy_id);
    new.legal_accepted_at:=clock_timestamp();
  elsif new.legal_accepted_at is not null then
    raise exception 'Policy versions are required for legal acceptance' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function public.stamp_reservation_legal_consent() from public,anon,authenticated;
drop trigger if exists stamp_reservation_legal_consent on public.reservations;
create trigger stamp_reservation_legal_consent before insert or update of terms_policy_id,privacy_policy_id,legal_accepted_at
on public.reservations for each row execute function public.stamp_reservation_legal_consent();

create or replace function public.stamp_guest_legal_consent()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_consent jsonb; v_token text;
begin
  if tg_op='UPDATE' then
    if row(new.terms_policy_id,new.privacy_policy_id,new.legal_accepted_at) is distinct from row(old.terms_policy_id,old.privacy_policy_id,old.legal_accepted_at) then
      raise exception 'Registration legal acceptance cannot be changed' using errcode='42501'; end if;
    return new;
  end if;
  new.terms_policy_id:=null; new.privacy_policy_id:=null; new.legal_accepted_at:=null;
  select raw_user_meta_data->'legal_consent' into v_consent from auth.users where id=new.id;
  -- Staff provisioning and historical accounts may have no registration consent.
  if v_consent is null then return new; end if;
  if v_consent->>'terms_accepted' is distinct from 'true' or v_consent->>'privacy_acknowledged' is distinct from 'true' then
    raise exception 'Explicit legal acceptance is required' using errcode='22023'; end if;
  new.terms_policy_id:=(v_consent->>'terms_policy_id')::uuid;
  new.privacy_policy_id:=(v_consent->>'privacy_policy_id')::uuid;
  v_token:=public.validate_current_legal_pair(new.terms_policy_id,new.privacy_policy_id);
  if v_token is distinct from v_consent->>'policy_version' then raise exception 'Invalid legal acceptance version' using errcode='22023'; end if;
  new.legal_accepted_at:=clock_timestamp();
  return new;
end $$;
revoke all on function public.stamp_guest_legal_consent() from public,anon,authenticated;
drop trigger if exists stamp_guest_legal_consent on public.guests;
create trigger stamp_guest_legal_consent before insert or update of terms_policy_id,privacy_policy_id,legal_accepted_at
on public.guests for each row execute function public.stamp_guest_legal_consent();

commit;
