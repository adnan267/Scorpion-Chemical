# Scorpion Chemical — Distribution App: v1 Scope

Agreed with the owner on 13 Nov 2026. This replaces the long "Medical & Chemical Distribution Management System" brief for the first version. Anything not listed under "In v1" is deliberately left for later.

Business: Scorpion Chemical, Khanewal Road, Multan (brands: Blue Guard, Cyclone, FLO.B, Senza). App language: English only. Currency: PKR.

## Platforms

- One codebase (React Native / Expo) that produces both the **Android app** and the **web panel**. Every role, including Admin, has the same features in the app and on the web.
- Backend: Supabase (Postgres database, login, file storage). All reads and writes go through database functions that check the caller's role.
- Web panel hosting: Vercel.

## Roles

| Role | What they do |
|---|---|
| Admin | Everything: products, rates, stock, customers, discounts, users, orders, payment approval, ledgers, announcements |
| Order Taker | Takes orders for assigned customers, records payments received, sees own sales and cash in hand |
| Medical Store | Orders for itself, sees own prices, orders, payments and balance, submits payment with receipt |
| Distributor | Same as a medical store: a customer that orders goods and has its own discounts and ledger |

Login is mobile number + password. Only Admin creates accounts. A store or distributor can never see another customer's prices, orders or money.

## In v1

### Products and stock
- Product: name, pack size, category, retail price (optional), net rate, packing, image, low-stock level, active/inactive.
- Admin adds stock (quantity, optional batch number, expiry date and note). Batch and expiry are recorded for reference only; stock is counted per product.
- Stock reduces when an order is **confirmed** and comes back if a confirmed order is cancelled. An order cannot be confirmed if stock is short; admin first adds stock or edits the order quantities.
- Low-stock notification to admin.

### Discounts
- Every customer has a default discount % and can have a different % on any individual product (the product-level % wins).
- Price = net rate − discount %. The server calculates it; order takers and customers cannot change it.
- Each order line stores the rate and discount used, so old orders never change when rates change.

### Orders
- Stores and distributors order for themselves; order takers (and admin) order on behalf of a customer. The order records who created it.
- Statuses: Pending → Confirmed → Dispatched → Delivered, or Cancelled (before delivery only).
- Admin can edit quantities while an order is Pending.
- **Due date is set manually by admin** on the order.
- Invoice as PDF (share / print).

### Payments and ledger
- Methods: Cash, Bank Transfer, JazzCash, EasyPaisa, Other.
- Store / distributor submits a payment with a **receipt photo (required)**.
- Order taker records payments collected. **Cash needs no receipt**; other methods need one.
- Every payment stays Pending until Admin approves or rejects it (with remarks). Only an approved payment changes the balance. Admin can also enter a payment directly.
- Order taker **cash in hand** = cash payments he has entered that admin has not yet approved (i.e. not yet handed over).
- Ledger for every store **and distributor**: opening balance, delivered orders (debit), approved payments (credit), manual adjustments by admin. Entries are never edited or deleted; corrections are new entries.
- An order is charged to the ledger when it is **Delivered**. Payments are applied to the oldest delivered orders first to show each order as Unpaid / Partly paid / Paid.

### Notifications and reminders
- In-app notification center for every user, plus Android push notifications (push needs a Firebase project).
- Automatic: new order, order status change, payment submitted, payment approved/rejected, low stock.
- Due-date reminders for unpaid delivered orders: 2 days before, on the due date, then every 3 days while overdue. Sent to the customer, the assigned order taker and admin. No duplicate reminders.
- Admin can send an announcement to everyone or to one role.

### Admin dashboard
Today's orders, this month's sales, pending orders, payments awaiting approval, total outstanding, overdue orders, low-stock products.

## Not in v1 (can be added later)
Multiple warehouses and stock transfer; batch-level stock; returns and credit notes; tax and delivery charges; category / quantity / promotional discounts; double-entry accounting; compliance module (SDS, recalls, restricted products); barcode; QR on invoice; Excel export; Urdu; dark theme; order takers registering new stores; offline order taking.

## Initial data
- Admin login number: 0300-7334811.
- 17 products from the printed catalog (masks, caps, gloves, Senza cream, Cyclone toilet cleaner, White Phenyl, Methylated Spirit 30–450 ml) with net rates.

## Still needed from the owner
- Approval to create the Supabase and Vercel projects (owner asked for code only, for now).
- A GitHub repository for the code and the Android (APK) build.
- A Firebase project for push notifications.
- Net rates for White Phenyl 50 ml (catalog shows only retail Rs. 300), White Phenyl 3 L and White Phenyl Concentrate 100 ml.
