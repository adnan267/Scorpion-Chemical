# Scorpion Chemical App — Build Status

Last updated: 13 Nov 2026. Scope is in `v1-scope.md`.

## Where things stand

- **Database is live** on the owner's new Supabase account (organization "scorpion chemical"), project `scorpion-chemicals`, ref `bmjvyivglnjgofpntqan`, region ap-southeast-1, created 13 Nov 2026. Applied: schema, all server functions, storage buckets and rules, daily reminder job (pg_cron 04:00 UTC), the 19 products, and a search_path fix. Edge function `admin-users` deployed (JWT verification off).
- Smoke test on the live database (rolled back): store price 54 for Spirit 30 ml at 10% off, order total 540, opening balance 500, 16 products visible, direct table reads refused.
- A one-time setup code is stored in `app_settings` (key `setup_code`); it is deleted automatically once the first admin is created through First-time setup. The code was given to the owner in chat.
- **Web panel is live** at https://scorpion-chemical-app.vercel.app (owner's existing Vercel account, imported from the GitHub repo with root directory `app`; the Vercel connector in chat had no permission to create projects, so the owner imported it).
- **Admin account created** (0300-7334811) on 13 Nov 2026; setup code used and removed. The admin password was reset once via SQL at the owner's request; owner was advised to change it. Owner confirmed the app runs.
- Product photos: all 18 uploaded by the owner to bucket `product-images`, folder `seed`, and checked against the products.
- Code is in the owner's private GitHub repo `adnan267/Scorpion-Chemical` (branch `main`). Every push to `main` that touches `app/` builds an APK on GitHub Actions and publishes it with the build log to branch `apk-build`.
- First APK built 13 Nov 2026 (run 1, 14 min, 55 MB, arm64-v8a + armeabi-v7a, debug-key signed, package `pk.scorpionchemical.app`) and sent to the owner. Not yet tested on a phone.
- The owner's other Supabase account ("Muhammad Adnan's projects", project `supabase-cerise-helmet`) belongs to other work and must not be used.

## Added after v1 (13 Nov 2026, app version 1.1.0)

- **Live location of order takers**: order taker taps "Start duty"; the Android app then sends location every ~2 minutes or 30 m (expo-location background updates with a foreground-service notification; works with "while in use" permission, "Allow all the time" is optional). Points are queued on the phone when offline. Nothing is recorded off duty. Admin sees a live map (web and app, Leaflet + OpenStreetMap tiles, bundled Leaflet, refresh every 30 s) and any day's route with distance and orders. Database: `duty_sessions`, `location_points` (migration 0006), cron jobs to keep 90 days and to close duty after 12 hours without location (0008).
- **Customer types**: medical store, distributor, wholesaler, retailer, clinic, hospital (0007). Login role is `distributor` for distributors and `store` for every other type.
- APK run 3 built and sent (18m 55s). Not yet tested on a real phone, including background tracking and battery-saver behaviour on Xiaomi/Oppo/Vivo.

## What was built

- One Expo (SDK 58, React Native 0.88, TypeScript) codebase in `app/` for both the Android app and the web panel. All four roles have the same features on both.
- Database in `supabase/migrations/`: `0001_schema.sql` (tables, all locked with RLS and no policies), `0002_functions.sql` (the whole API as security-definer functions that check the caller's role; internal helpers in schema `app`), `0003_storage.sql` (buckets `product-images` public, `payment-proofs` private), `0004_reminders_schedule.sql` (pg_cron, 04:00 UTC daily).
- Edge function `admin-users` (create login, set password, change login number, one-time admin bootstrap with a setup code). Deploy with JWT verification off; it authenticates the caller itself.
- Logins are mobile numbers stored in Supabase Auth as `<number>@login.scorpionchemical.app`. This synthetic-email approach still has to be confirmed against a real Supabase project.
- Push notifications: app-side token registration and a `send-push` function are written but not enabled (needs Firebase). In-app notifications and due-date reminders work without it.
- Product list: 16 products from the printed rate list are active. Three are loaded hidden with rate 0 because the rate list gives no net rate: White Phenyl 50 ml (retail Rs. 300 only), White Phenyl 3 litre, White Phenyl Concentrate 100 ml.
- Logo and icons were cropped from the catalog image; replace when the owner sends the original logo file.

## Decisions made during the build

- App and web panel are the same code (the owner asked for every admin feature in both).
- Every payment, including cash entered by an order taker, waits for admin approval. Order-taker cash in hand = their unapproved cash entries.
- Orders are charged to the ledger at Delivered. Payments settle the opening balance and debit adjustments first, then delivered orders oldest first.
- Batch number and expiry date are recorded on stock entries for reference only.
- Customers see "in stock / out of stock", not quantities. Order takers and admin see quantities.
- Order takers see and serve only customers assigned to them.

## Tested

- Server logic: 97 checks on local PostgreSQL 16 (`tests/flow_test.sql`), all passing.
- Web build clicked through in headless Chrome for all four roles: 51 steps (`tests/run_admin.mjs`, `run_roles.mjs`, `run_more.mjs`, `run_last.mjs`), all passing. These ran against a local stand-in for Supabase (`tests/gateway.mjs`), not a real project.

## Not done yet

2. Test login, receipt upload and the `admin-users` function end to end on the live project (only the database part has been checked live).
3. Deploy the web panel (Vercel; which account is still to be confirmed).
4. Test the APK on an Android phone (camera, receipt upload, PDF sharing). For a Play Store release later, a proper signing key is needed (current APK uses the debug key).
5. Firebase project, then enable push (`supabase/later/0005_push_trigger.sql`).
6. Net rates for the three White Phenyl products.
