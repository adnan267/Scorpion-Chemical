# Scorpion Chemical — Distribution App (v1)

One codebase that gives an **Android app** and a **web panel** for four roles: Admin, Order Taker, Medical Store and Distributor. The agreed scope is in `docs/v1-scope.md`.

## What is in this folder

| Folder | What it is |
|---|---|
| `app/` | The app (React Native / Expo SDK 58, TypeScript). Screens are in `app/src/app/`. |
| `supabase/migrations/` | The database: tables (0001), all server logic and permissions (0002), file storage rules (0003), daily reminder schedule (0004). |
| `supabase/functions/admin-users/` | Server function that creates logins, resets passwords and changes login numbers. |
| `supabase/functions/send-push/`, `supabase/later/` | Push notifications. Not switched on yet (needs Firebase). |
| `supabase/seed_products.sql`, `seed/product-images/` | The 19 products from the printed rate list and their photos. |
| `tests/` | Local tests: server logic (`flow_test.sql`) and browser walkthroughs of the built web app. |
| `.github/workflows/android-apk.yml` | Builds the Android APK on GitHub. |

## How it is built

- The app never reads or writes database tables directly. Every screen calls a database function (for example `order_place`, `payment_review`), and each function checks who is calling. Tables are locked to everyone else.
- Login is a mobile number and password. Behind the scenes Supabase stores it as `<number>@login.scorpionchemical.app`.
- Prices are calculated by the server: net rate minus the customer's discount (product-level discount first, otherwise the customer's default).
- A delivered order is added to the customer's ledger. A payment changes the balance only after the admin approves it. Ledger rows cannot be edited or deleted.

## Going live (one time)

### 1. Database (Supabase)
1. Create a Supabase project.
2. In the SQL Editor run, in this order: `0001_schema.sql`, `0002_functions.sql`, `0003_storage.sql`, `0004_reminders_schedule.sql`, `0005_fix_search_path.sql`, then `seed_products.sql`.
   (Already done on 13 Nov 2026 for project `scorpion-chemicals`, ref `bmjvyivglnjgofpntqan`.)
3. Upload the files in `seed/product-images/seed/` to the storage bucket `product-images`, inside a folder named `seed`.
4. Deploy the function `admin-users` with "Verify JWT" turned **off** (the function checks the caller itself).
5. Choose a setup code and save it:
   `insert into app_settings(key, value) values ('setup_code', to_jsonb('YOUR-CODE'::text));`
6. Open the app, tap **First-time setup**, enter the code, your name, mobile number and a password. This creates the admin and removes the code.

### 2. App settings
Copy `app/.env.example` to `app/.env` and fill in the project URL and the publishable (anon) key from Supabase.

### 3. Web panel (Vercel)
Import the repository in Vercel with root directory `app`, and add the same two `EXPO_PUBLIC_...` values as environment variables. `app/vercel.json` already has the build settings.

### 4. Android APK
Either:
- **GitHub Actions**: add the two `EXPO_PUBLIC_...` values as repository secrets, then run the "Build Android APK" workflow and download the APK from the run; or
- **Expo EAS**: `cd app && npx eas-cli@latest build -p android --profile preview` (needs an Expo account).

### 5. Push notifications (later)
Create a Firebase project, add an Android app with package `pk.scorpionchemical.app`, put `google-services.json` in `app/`, deploy `send-push` with its two secrets, then apply `supabase/later/0005_push_trigger.sql`. Until then, notifications show inside the app only.

## Running it on your computer
```
cd app
npm install
npx expo start        # press w for web, or scan the QR code with a development build
npx tsc --noEmit      # type check
```

## What has been tested, and what has not
Tested on 13 Nov 2026:
- Server logic on a local PostgreSQL 16 database: 97 checks covering permissions between roles, pricing and discounts, stock, order statuses, payment approval, ledger arithmetic and due-date reminders (`tests/flow_test.sql`).
- The built web app, clicked through in headless Chrome for all four roles against that database: 51 steps (`tests/run_*.mjs`).

Not tested yet:
- Against a real Supabase project (the tests used a local stand-in for login, storage and the `admin-users` function).
- On an Android phone. The APK has not been built.
- Push notifications and the `send-push` function.
