-- PUSH NOTIFICATIONS (apply only after the Firebase project exists and the `send-push`
-- function is deployed with its two secrets). Replace the two placeholders first.
create extension if not exists pg_net;

create or replace function app.push_notification() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  perform net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', 'YOUR-PUSH-WEBHOOK-SECRET'),
    body := jsonb_build_object('notification_id', new.id));
  return new;
exception when others then
  return new;  -- never let a push problem block an order or a payment
end $$;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row execute function app.push_notification();
