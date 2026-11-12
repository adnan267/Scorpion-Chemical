-- Daily due-date reminders (Supabase only). 04:00 UTC = 9:00 am in Pakistan.
create extension if not exists pg_cron;
select cron.schedule('scorpion-due-reminders', '0 4 * * *', $$select app.run_due_reminders()$$);
