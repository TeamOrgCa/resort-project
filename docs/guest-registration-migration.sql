-- Apply to an existing Supabase project before deploying the registration change.
-- The trigger already exists; replacing its function preserves its attachment.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.guests (id, email, first_name, last_name, middle_name, phone_number, address)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', 'Unknown'),
    coalesce(new.raw_user_meta_data->>'last_name', 'Unknown'),
    new.raw_user_meta_data->>'middle_name',
    coalesce(new.raw_user_meta_data->>'phone_number', 'Unknown'),
    coalesce(new.raw_user_meta_data->>'address', 'Unknown')
  );
  return new;
end;
$$;
