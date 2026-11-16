# Scorpion Chemical App — Build Status

Last updated: 16 Nov 2026. Scope is in `v1-scope.md`.

## Where things stand

- **Database is live** on the owner's new Supabase account (organization "scorpion chemical"), project `scorpion-chemicals`, ref `bmjvyivglnjgofpntqan`, region ap-southeast-1, created 13 Nov 2026. Applied: schema, all server functions, storage buckets and rules, daily reminder job (pg_cron 04:00 UTC), the 19 products, and a search_path fix. Edge function `admin-users` deployed (JWT verification off).
- Smoke test on the live database (rolled back): store price 54 for Spirit 30 ml at 10% off, order total 540, opening balance 500, 16 products visible, direct table reads refused.
- A one-time setup code is stored in `app_settings` (key `setup_code`); it is deleted automatically once the first admin is created through First-time setup. The code was given to the owner in chat.
- **Web panel is live** at https://scorpion-chemical-app.vercel.app (owner's existing Vercel account, imported from the GitHub repo with root directory `app`; the Vercel connector in chat had no permission to create projects, so the owner imported it).
- **Admin account created** (0300-7334811) on 13 Nov 2026; setup code used and removed. The admin password was reset once via SQL at the owner's request; owner was advised to change it. Owner confirmed the app runs.
- Product photos: all 18 uploaded by the owner to bucket `product-images`, folder `seed`, and checked against the products.
- Code is in the owner's private GitHub repo `adnan267/Scorpion-Chemical` (branch `main`). Every push to `main` that touches `app/` builds an APK on GitHub Actions and publishes it with the build log to the git ref `refs/apk/latest` (not a branch, so Vercel ignores it; fetch with `git fetch origin refs/apk/latest`). The old `apk-build` branch caused failed Vercel preview deployments; the owner was asked to delete it (branch deletion is blocked from the Claude session).
- First APK built 13 Nov 2026 (run 1, 14 min, 55 MB, arm64-v8a + armeabi-v7a, debug-key signed, package `pk.scorpionchemical.app`) and sent to the owner. Not yet tested on a phone.
- The owner's other Supabase account ("Muhammad Adnan's projects", project `supabase-cerise-helmet`) belongs to other work and must not be used.

## Added after v1 (13 Nov 2026, app version 1.1.0)

- **Live location of order takers**: order taker taps "Start duty"; the Android app then sends location every ~2 minutes or 30 m (expo-location background updates with a foreground-service notification; works with "while in use" permission, "Allow all the time" is optional). Points are queued on the phone when offline. Nothing is recorded off duty. Admin sees a live map (web and app, Leaflet + OpenStreetMap tiles, bundled Leaflet, refresh every 30 s) and any day's route with distance and orders. Database: `duty_sessions`, `location_points` (migration 0006), cron jobs to keep 90 days and to close duty after 12 hours without location (0008).
- **Customer types**: medical store, distributor, wholesaler, retailer, clinic, hospital (0007). Login role is `distributor` for distributors and `store` for every other type.
- APK run 3 built and sent (18m 55s). Not yet tested on a real phone, including background tracking and battery-saver behaviour on Xiaomi/Oppo/Vivo.

## Version 2.4 (16 Nov 2026 evening, app version 1.5.0, migration 0015_v24.sql applied live)

From the owner's voice notes after using 1.4.0:
- **Admin dashboard**: three big tiles on top: Total balance in market (with overdue), Today's recovery (all payments dated today, any method; tap for the day's recovery by who collected and by method, any day, printable), Today's expenses (office + order takers; tap for the expenses report on Today).
- **Office expenses** (Expenses, Add office expense): electricity bill, rent, salary (needs a name), kitchen/tea/water, gas/phone/internet, other; any past date. The expenses report shows office and order taker tours separately and prints. `expenses.kind` is 'tour' or 'office'.
- **Recovery sheet** (dashboard balance tile, More): customers of one city, or of one order taker for local Multan areas, with balance and overdue and empty dotted Received / Remaining columns, printed on A4 with signature lines. Order takers can print their own.
- **Printing**: loading sheet ("Print loading sheet" prints the take-out summary; bills are a separate button "Print all bills"; the toggle is now "Also show orders already delivered"), recovery, recovery sheet, expenses, customer statement. Web prints through a hidden frame, Android through the print dialog (which can also save a PDF). Helper `app/src/lib/report.ts`.
- **Delete customer** (admin, customer page): the admin types the name; removes the customer with orders, returns, payments, statement (ledger purge allowed only inside this function), and its app logins (auth users too). Stock of orders not delivered goes back. Logged in activity_log. Making a customer inactive is still the way to keep history.
- **Customers cannot send cash** (removed from their payment form and refused by the database).
- Tests: 293 database checks (`tests/v24_test.sql`) and `tests/run_v24.mjs`; all earlier walkthroughs rerun, passing.

## Version 2.3 (16 Nov 2026, also app version 1.4.0; migrations 0013_colours_lots_cities.sql and 0014_licence_storage.sql applied live)

From the owner's voice notes after testing the invoice:
- **Invoice**: Lot no. column (each order line takes the latest lot number entered when stock was received; old orders were filled in the same way). Warranty and signature now sit at the bottom of the page, signature under the warranty. Free pieces show under the quantity.
- **Colours** (face mask boxes and pouches: Black, Blue, Green, White): product form, Colours, "Add colours". Each colour becomes its own product row with its own stock (current stock stays with the first colour, others start at 0), linked by `group_id`; rate, name, picture, scheme and customer discounts stay the same for all colours. Ordering shows one card with a row per colour. Invoice lines say e.g. "Face Mask (Adult) Pouch of 10 (Blue)". Not switched on for any live product yet; the owner adds the colours and stock.
- **Bonus / free goods schemes** like 100+2: on the product (for everyone) and per customer on the Discounts page (blank = product's scheme, 0 = none). Free pieces are worked out by the server, come out of stock, are not charged, show in the cart, order, loading sheet and invoice. Returns cover paid pieces only.
- **Licence photo** for customers (camera or gallery) on the customer form, private bucket `licence-photos` (`<customer id>/<file>`; admin, the customer's order taker and the customer can see it).
- **Customers by city** for order takers (Home "Your customers owe" card, More, My cities; admin via Staff logins): each city's balance, collections this month and today, and every customer with what they owe, overdue and last payment.
- Tests: 266 database checks (`tests/v23_test.sql`) and `tests/run_v23.mjs`; all earlier walkthroughs rerun, passing.

## Version 2.2 (16 Nov 2026, app version 1.4.0, migration 0012_expenses.sql applied live)

- **Order taker expenses**: Home card "Today's expenses" and More, Today's expenses. The order taker writes the city of the day's tour once, then adds each expense: Wagon/van, Bus, Rickshaw, Chingchi, Bike petrol, Food, Stock carriage (cartons or an extra seat for stock), Other (needs a note). Only today's entries are shown to them; they can remove a wrong entry the same day.
- **Admin report** (More, Order taker expenses; or Staff logins, order taker, Expenses): this week / this month / last month, filter by order taker, totals by type, by order taker, average cost of one tour to each city, and every tour (order taker, day, city) with its entries and the orders taken that day. Admin can delete an entry.
- Tests: 238 database checks (`tests/expenses_test.sql`) and `tests/run_expenses.mjs`, passing locally.

## Version 2.1 (16 Nov 2026, app version 1.3.0, migrations 0010_routes.sql and 0011_route_jobs.sql applied live)

Asked for by the owner after the first phone test (voice notes).
- **Order takers add customers** themselves (Customers, + button). The customer is theirs straight away, no approval; discount, credit days and opening balance stay 0 until the admin sets them; admins get a "New customer" notification. Order takers can edit details of their own customers. A duplicate name in the same city is refused.
- **Shop location** on customers: "I am at the shop: save location" on the customer form and page (phone GPS), "Open in Google Maps".
- **Route plan** per order taker (Staff logins, order taker, Route plan): Day 1 date, number of days (default 30, then it repeats), optional off day (Friday or Sunday; not counted). Each day has an area name and customers in visiting order. Customers with no order taker are given to that order taker when added to a day; another order taker's customers are refused.
- Order taker Home shows **Today's route** with each customer marked ordered, visited (live location within about 120 m of the saved shop location) or not yet. More, My route plan shows the whole plan.
- **Tomorrow's route** reminder: in-app notification at 8 pm PKT (pg_cron job `scorpion-route-reminders`), plus a phone notification at 8 pm scheduled on the phone itself whenever the order taker opens Home (works without Firebase).
- Admin route screen (Live map, order taker) shows the day's plan with visit status and numbered shop pins (green ordered, blue visited, red not visited).
- Owner's question on 16 Nov: "Take an order" opens the customer list first; tapping the customer opens the products. A hint was added on that screen. Order takers only see customers assigned to them.
- Tests: 222 database checks (`tests/routes_test.sql` added) and the browser walkthroughs incl. `tests/run_routes.mjs`, all passing locally.

## Version 2 (16 Nov 2026, app version 1.2.0, migration 0009_v2.sql applied live in 6 parts)

- **Orders**: no Pending or Dispatched any more. An order is Confirmed when placed and its stock is taken then (not enough stock = the order is refused). Admin, the order taker or a stock keeper marks it Delivered. Admin can change quantities until delivery. Old pending orders without stock taken stay "pending" and are treated as to-deliver.
- **Returns**: from a delivered order, by admin, the customer's order taker, or the customer. No approval. Goods go back into stock and the value comes off the account (ledger kind `return`). By default only from the due date onwards; admin setting "Allow returns before the due date".
- **Stock keeper**: new login role `stock_keeper` (Staff logins). Home is the loading sheet: the day's orders by booker, product totals to take out, print all invoices or one booker's. Can mark delivered; sees no payments or balances. Admin has the same sheet (More, Loading sheet).
- **Customers**: label "Medical store" is now **Consumer** (database value still `store`); new type **Dawakhana**. Credit days (due date = delivery + credit days, can be changed when delivering). Optional drug licence number, issue and expiry date, printed on invoices; an expired licence only shows a warning.
- **Invoices**: new numbers start with INV- (old ORD- stay). Preview screen with Print (and Share PDF on the phone) wherever an invoice opens. Footer has the owner's warranty text and his digital signature (no stamp), editable in More, Company and invoice. Signature in use: the clean photo the owner sent on 16 Nov, made transparent (`docs/signature.png`, 420 px).
- Stock entries say **Lot no.** instead of Batch no. (database column is still `batch_no`).
- **Admin home**: Take an order / Record payment buttons, orders today / this week / this month, licence warnings. Orders screen: period chips (today, week, month, last month, all), totals, and who booked how many for how much.
- **Opening data** (More, Opening data): customer opening balance, old unpaid bills (amount only, with due date and reminders, numbered by the owner or OB-), stock count, and an Excel import on the web panel (template with sheets Customers, Old bills, Stock, Help; every row is checked and nothing is saved until Import). Dates in the file are read day/month/year.
- Tests: 187 database checks and 16 v2 browser steps (`tests/v2_test.sql`, `tests/run_v2.mjs`) plus the earlier walkthroughs, all passing locally.

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
