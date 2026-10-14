# Gym Management PWA — urcod

Phases 1–2: the app shell and all role screens (Phase 1), plus real sign-in, roles, member and staff
accounts, blocks, licence, gym identity and the audit log on Firebase's free plan (Phase 2).
Screens that belong to later phases still run on sample data and say so.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # domain unit tests + security-rules scenarios on the in-repo simulator
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ locally (service worker active here)
```

Node 20+ is required.

## What is in Phase 1

| Area | Screens |
| --- | --- |
| Public | Sign-in (phone + password), install guide, "contact management" recovery, About (urcod, version, contact) |
| Hidden entrances | 3 taps on the gym logo → cashier sign-in, 5 taps → admin sign-in, 10 taps on urcod → developer gate (shortcuts only; access is enforced by sign-in and the security rules) |
| Member | Home (active / scheduled / expired), membership card, banners, today's workout, week plan, entry code (illustrative), progress chart, more |
| Cashier | Reception search, member file, quick registration with live price and date summary, renewal, pending payments, check-in results |
| Coach | Own trainees only, published plan view |
| Admin | Dashboard (KPIs, alerts, 30-day collections, expiring soon, peak hours), members with search + filters + paging, plans catalogue; other sections are placeholders for their phases |

Arabic RTL by default, English LTR switch, light and dark themes, phone → desktop layouts,
lazy-loaded role bundles, PWA manifest + shell-only service worker with an "update available" prompt.

## Project layout

```
src/
  domain/      pure logic + tests (dates.ts is the membership date rulebook)
  i18n/        Arabic and English strings
  app/         language, theme, toasts
  components/  shell, brand (logos + tap gates), UI kit, charts, icons
  pages/       public, member, staff (cashier, coach, admin)
  mock/        DEMO data — replaced by Firestore in Phase 2
public/        manifest, service worker, icons, urcod logo (dark + light variants)
```

## Date rules (src/domain/dates.ts)

- Timezone `Africa/Cairo`; instants stored as UTC.
- A membership starts at 00:00 on its start date; the end is exclusive.
- Month/year plans keep the day of month; if it does not exist (31 Jan + 1 month), the end rolls to the 1st of the next month.
- Day and week plans add calendar days, so Egyptian summer time never shifts them.
- Early renewal appends after the current end; a lapsed membership renews from today (no retroactive days).

From Phase 3, membership writes are validated by the security rules against these same rules.

## Phase 2 — Firebase on the free Spark plan: sign-in, roles, security rules

Setup and deployment (Arabic): **[SETUP-AR.md](SETUP-AR.md)**.

No Cloud Functions, no Storage, no billing. Firestore security rules are the only guard, so every
write the app makes is built in one place and tested against those rules.

```
src/domain/identity.ts   phone → sign-in alias, random internal e-mails, invite codes (SHA-256 ids)
src/domain/writes.ts     every write set (register member, invites, redeem, blocks, staff, licence, branding)
src/firebase/commit.ts   write sets → atomic Firestore batches/transactions (shared with the rules tests)
src/firebase/data.ts     sign-in, invites, live lists, licence, branding
firestore.rules          roles from users/{uid}; audit entry required with every sensitive change;
                         licence needed for staff writes; second factor needed for developer writes
tests/rules/scenarios.ts security scenarios, written once and run on:
  tests/rules-sim/       an in-repo rules simulator (Firebase's own ANTLR grammar) — part of `npm test`
  tests/rules/           the official Firestore emulator — `npm run test:rules` (Java 21, also in CI)
.github/workflows/ci.yml typecheck, tests, rules lint, emulator rules tests, build
```

| Command | What it runs |
| --- | --- |
| `npm test` | domain tests + rules scenarios on the simulator |
| `npm run typecheck` | app and tests |
| `npm run lint:rules` | syntax check of firestore.rules with the official grammar |
| `npm run test:rules` | rules scenarios on the official emulator (Java 21) |
| `npm run deploy` | build + `firebase deploy --only firestore,hosting` |

How sign-in works: everyone except the developer signs in with an Egyptian mobile number and a
password. Firebase Auth only knows e-mail accounts, so each person gets a random internal address on
the reserved `.invalid` domain (it can never receive mail). `loginAliases/{m|s}+20…` maps the phone to
that address and can only be written while redeeming an invite. Invites are 256-bit codes sent on
WhatsApp; Firestore stores only their SHA-256. Redeeming creates the person's own account and, in one
atomic batch, marks the invite used, creates `users/{uid}` with exactly the invited roles, points the
phone at the new account and (for resets) retires the old one. Nobody ever sees another person's
password, and there is no self-service reset: recovery is a new link from management.

Known trade-off: a single `loginAliases` document is readable by id, so someone who already knows a
phone number can tell whether it is registered at this gym (lists are refused).

Without `VITE_FIREBASE_API_KEY` the app runs in demo mode and never loads the Firebase SDK.
