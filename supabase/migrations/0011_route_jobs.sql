-- Tomorrow's route reminder for order takers, every evening at 8 pm PKT (Supabase only, needs pg_cron).
select cron.schedule('scorpion-route-reminders', '0 15 * * *', $$select app.route_reminders()$$);
