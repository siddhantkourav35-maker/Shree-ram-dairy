# Shree Ram Dairy — Production Setup (100% free: Firebase Spark plan)

Stack: Firebase Hosting + Authentication (Email/Password) + Realtime Database. No Cloud Functions (they need the paid Blaze plan);
the "backend" is `public/js/api.js` (transactions) + `database.rules.json` (server-enforced security).

## Deploy
1. `npm i -g firebase-tools && firebase login`
2. In this folder: `firebase use shree-ram-dairy-3a2b8`
3. `firebase deploy --only hosting,database`
4. Console → Authentication → add Owner and staff users (Email/Password).
5. Console → Realtime Database → Data → create for each user (their UID from Authentication):
   - Owner: `admins/<UID> = true`
   - Staff: `staff/<UID> = true`
   (Rules block clients from writing these, so only you can grant access.)
6. Console → Authentication → Settings → Authorized domains: keep only your hosting domain.
7. Google Cloud → APIs & Services → Credentials → restrict the browser API key to your hosting domain.
8. Old data: customers need a `token` field. Re-create customers or run a one-time migration in the console.

## Structure
customers/{id} • tokens/{token}→id • portal/{token} (public read-only balance) • logs/{id}/{pushId} (immutable audit)
bills/{no} • stock/{item} • expenses/{id} (owner only) • settings/products (owner only) • meta/billCounter
