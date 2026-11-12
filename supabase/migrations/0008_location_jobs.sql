-- Daily housekeeping for live location (Supabase only, needs pg_cron).
select cron.schedule('scorpion-location-prune', '30 21 * * *', $$select app.prune_locations()$$);   -- 2:30 am PKT
select cron.schedule('scorpion-close-stale-duty', '*/30 * * * *', $$select app.close_stale_duty()$$);
