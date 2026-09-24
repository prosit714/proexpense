# Deploying ProExpense

Start to finish this is about twenty minutes, most of it waiting for Cosmos DB
to provision. You need an Azure subscription, a GitHub account, and the Azure
CLI signed in (`az login`).

Everything lands on free tiers. Expect **$0–2 a month**, almost all of it
blob storage for backups.

---

## 1. Put the code in a GitHub repository

```bash
git init
git add .
git commit -m "ProExpense"
git branch -M main
git remote add origin https://github.com/<you>/proexpense.git
git push -u origin main
```

It needs to be GitHub because Static Web Apps' free tier deploys through GitHub
Actions.

## 2. Provision Azure

```bash
az login
az account set --subscription "<your subscription>"
./infra/provision.sh proexpense-rg centralindia
```

Pick whichever region is closest to you. The script creates the resource group,
deploys `infra/main.bicep`, generates the secrets, and applies them to the
Static Web App for you. It prints a summary block at the end — keep that
terminal open.

What it creates:

| Resource | Tier | Why |
| --- | --- | --- |
| Cosmos DB account | Free tier, shared throughput | 1000 RU/s and 25 GB free |
| Storage account | Standard_LRS | Weekly JSON backups |
| Static Web App | Free | PWA hosting, TLS, and the managed Functions API |

One caveat the script cannot work around: **Azure allows exactly one free-tier
Cosmos account per subscription.** If you already have one, deployment fails
with a free-tier error. Re-run with `--parameters cosmosFreeTier=false` — at
this workload serverless billing is a few cents a month anyway.

## 3. Add three GitHub secrets

In the repository: **Settings → Secrets and variables → Actions → New
repository secret**. The values are all in the summary the script printed.

| Secret | Value |
| --- | --- |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | the deployment token |
| `PROEXPENSE_URL` | `https://<your-app>.azurestaticapps.net` |
| `BACKUP_SECRET` | the generated backup secret |

The first is what lets CI deploy. The other two are only used by the weekly
backup job.

## 4. Deploy

```bash
git commit --allow-empty -m "Trigger deploy"
git push
```

Watch the Actions tab. The workflow runs the tests, checks the domain copies are
in sync, typechecks both halves, then builds and deploys. First run takes about
five minutes; later ones are quicker.

## 5. First sign-in

Open your app URL. The PIN is **000000**.

The app immediately makes you set a real one and will not let you past that
screen — the auth document is created on first request with `mustChangePin`
set, and every other endpoint rejects the session until it clears.

---

## Application settings

`provision.sh` applies these. You only need this table if you are setting things
up by hand or rotating a secret (Azure portal → your Static Web App →
Configuration).

| Setting | What it is |
| --- | --- |
| `COSMOS_CONNECTION_STRING` | Primary connection string for the Cosmos account |
| `SESSION_SECRET` | 48+ random bytes signing the session cookie. Rotating it signs you out. |
| `BACKUP_SECRET` | Shared secret the backup endpoint checks |
| `BACKUP_STORAGE_CONNECTION_STRING` | Storage account connection string |
| `SECURE_COOKIES` | Only set this, to `false`, for local http development |

Static Web Apps' managed Functions do not support managed identity, which is
why these are connection strings rather than role assignments. The settings are
encrypted at rest, and the app has no other way to reach the database.

## Running it locally

```bash
npm install
npm install --prefix api
npm run sync:domain

cp api/local.settings.example.json api/local.settings.json
# fill in COSMOS_CONNECTION_STRING and SESSION_SECRET, leave SECURE_COOKIES=false

npm install -g @azure/static-web-apps-cli azure-functions-core-tools@4
swa start http://localhost:5173 --run "npm run dev" --api-location api
```

Then open <http://localhost:4280>. Use `swa start` rather than plain `vite`,
because the session cookie is `SameSite=Strict` on the same origin — the SWA CLI
fronts both halves on one port the way production does, so auth behaves
identically.

```bash
npm test          # 36 tests: balance engine + PIN and session security
npm run typecheck # web
npm --prefix api run typecheck
```

## Exporting an event

Open an event and press **Export**, or **Export as PDF** on the Settle tab. That
opens your browser's print dialog; choose "Save as PDF".

The document has expenses with original and converted amounts, totals by
category, a per-person table showing who each person settles with, every
recorded payment, and anything still outstanding. It works the same on iOS,
Android and desktop, and prints on paper properly too.

This is a print stylesheet rather than server-side PDF generation. A PDF library
would be a dependency to keep patched and a layout project to maintain, in
exchange for a worse document.

## Backups

`.github/workflows/backup.yml` runs at 03:17 UTC on Sundays and writes every
event as one JSON file to the `backups` container in your storage account.
Run it on demand from the Actions tab.

It is a cron in CI rather than a timer-triggered function because Static Web
Apps' managed Functions only support HTTP triggers. A real timer trigger needs a
separate Function App, which means leaving the free tier for a job that runs
once a week.

Cosmos also keeps its own periodic backups with seven days of retention, which
you would restore through the portal. The JSON snapshots are the ones you can
read and grep.

---

## How the security actually works

Worth understanding, because a six-digit PIN on a public URL is the weakest
thing here and it only holds up because of what surrounds it.

**The PIN is hashed with scrypt**, salted per install, at parameters costing
about 100 ms per attempt. Not argon2: that is a native module, and Static Web
Apps builds in an Oryx container where a failed node-gyp compile is both likely
and unpleasant to debug. scrypt is memory-hard, it is in the standard library,
and it has no install step.

**Lockout is what actually stops a brute force.** Three free attempts for fat
fingers, then doubling delays capped at an hour. At that cap, walking all one
million combinations takes over a century. There is a test asserting exactly
that. The counter lives in the database, so clearing cookies or switching
devices does not reset it.

**Sessions are an HS256 cookie** — httpOnly, Secure, SameSite=Strict, 30 days.
The token carries a PIN epoch that is compared against the database on every
request, so changing your PIN signs out every other device immediately. That is
the behaviour you want if you changed it because someone saw you type it.

**Changing your PIN requires the current one**, so a stolen session alone cannot
lock you out of your own app.

### If you want this genuinely locked down

Turn on the Static Web Apps built-in authentication as an outer gate and keep
the PIN as the fast in-app unlock. It costs nothing, needs no code, and puts a
real identity provider in front of everything. Add to
`staticwebapp.config.json`:

```json
"routes": [
  { "route": "/api/auth/login", "allowedRoles": ["authenticated"] },
  { "route": "/*", "allowedRoles": ["authenticated"] }
],
"responseOverrides": {
  "401": { "redirect": "/.auth/login/github", "statusCode": 302 }
}
```

You sign in with GitHub or Microsoft once per device, then the PIN is all you
touch day to day. It is one extra step the first time and invisible afterwards.

## Repository layout

```
shared/domain/     the balance engine — the only copy you edit
src/               React PWA (Vite)
  domain/            generated copy, committed, checked by CI
api/               Azure Functions, v4 programming model
  src/lib/           pin, jwt, cosmos, http, session
  src/functions/     auth, events, backup
  src/domain/        generated copy, committed, checked by CI
infra/             Bicep template and provisioning script
.github/workflows/ deploy and weekly backup
```

`shared/domain` is copied into both halves by `scripts/sync-domain.mjs` rather
than shared through a workspace package, because Static Web Apps builds `api/`
in an isolated container where a path outside it may not resolve. The copies are
committed so the build never depends on the script, and CI fails if they drift
from the original.

## Things to know

**Editing on two devices.** Every save is a whole-document replace guarded by
the Cosmos etag. If your phone and laptop both have the event open, the second
save is rejected, the app reloads and tells you your last edit was not saved.
Losing one edit you can redo is better than losing an evening's entries.

**Exchange rates are per expense.** The event-level rates only prefill the form.
Each line stores the rate it was entered with, so editing a rate later never
silently rewrites expenses you already reconciled.

**Closing an event** is only offered once every settlement group nets to zero.
The server enforces it too, so it cannot be bypassed from the client.

**Families** settle together. Individual balances stay visible, but the green
tick only cares whether each family nets out — and any family member can pay off
the whole family's share in one payment.

**Adding a home screen icon.** It is a PWA: on iOS use Share → Add to Home
Screen, on Android the install prompt appears on its own. It then opens without
browser chrome.
