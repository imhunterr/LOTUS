# LOTUS web application setup and verification

FireFly contract APIs and durable commit events, Caliper Fabric measurements, Brownie Solidity regression/gas reference and encrypted IPFS document storage are now available. See [toolchain setup and synopsis mapping](TOOLCHAIN_MIGRATION.md). The operator/auditor Integrations workspace reports selected services and recorded measurement evidence.

The revamp is a responsive web application. Patients use a phone-oriented, installable web interface; manufacturers, distributors, pharmacies, prescribers, regulators, operators and auditors use authorized web workspaces. Guardians have a separate browser vault for one recovery share. There is no native mobile application.

## Run the application

Browser tests use Playwright's bundled Chromium by default. Install it with `npx playwright install chromium` (Linux: `npx playwright install --with-deps chromium`). Set `PLAYWRIGHT_CHANNEL` only to explicitly select another installed browser.

The anonymous bulletin and public verification share an explicit field allow-list for medicine identity, expiry, manufacturer name and recall instructions. Internal manufacturer IDs, issuance/dispense totals and adverse-event counters remain in authenticated snapshots. Broad commitment leaves are still published for local matching and proof generation, so their number reveals record cardinality; this change does not establish confidentiality against consortium peer administrators or remove the production feed-publication gates below.

From the repository root, use Node 22.13 or newer. Node 22 is the recommended runtime for the retained Hardhat reference tests. The application uses Node's SQLite API; some Node releases display an experimental API notice.

```powershell
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:8787`. Patient entry is `/patient`, public verification is `/verify`, guardian entry is `/guardian`, and staff access is `/login`.

The default start command uses the prepared Fabric, FireFly and IPFS operational profile. A fresh checkout must prepare its runtimes/profile using `TOOLCHAIN_MIGRATION.md` first. The first staff sign-in opens operator setup: choose your own name, email and password. Setup is restricted to this computer and, in Fabric mode, to the pre-enrolled operator on an empty business profile. The client cannot choose its role or Fabric identity. There are no hard-coded staff passwords or pre-populated business inventory.

The operator approves organizations and creates private staff invitation links. Share a link with its intended person; the application does not send email. Each person chooses a password and sees only the authorized workspace. Create an auditor organization to invite a read-only auditor.

For development, `npm run dev` runs the API and Vite with API forwarding. Use the built application for offline and service-worker tests.

## Ledger modes

`npm start` / `npm run start:fabric` selects the operational Fabric/FireFly/IPFS profile. `npm run start:local` explicitly selects local mode in the separate `.lotus-local-data/` directory. Local mode executes the same domain engine and stores state/journal in SQLite. The interface labels it “Local durable ledger”; it is a development authority, not a distributed blockchain. A stored profile marker blocks changing a directory's ledger/network silently. Development uses `.lotus-dev-data/` and sandbox uses `.lotus-sandbox-data/`.

The standard Fabric launcher selects `.fabric-network/gateway.json`, the separate `.tooling/firefly/operations/client.json` profile on port 5300, and loopback IPFS on port 15001. Ordinary commands use FireFly; permit secrets use Fabric Gateway transient data. Failed services never trigger local fallback.

### Local Fabric network without Docker

The prepared runtime is under ignored `.fabric-runtime/`. Fabric 3.1.5 and portable Linux Node 22.22.2 were downloaded from official releases and checked against their published SHA-256 digests. Ubuntu WSL runs the binaries directly; Docker and Go installations are not required for this integration environment.

```powershell
wsl -d Ubuntu -- bash /mnt/d/Projects/LOTUS/scripts/fabric-native.sh
```

This creates two peer organizations, TLS identities, a Raft orderer and the `lotus-operations` channel. Both organizations must endorse the installed LOTUS chaincode. The external chaincode service uses the same tested domain rules as the local ledger. Initial startup can take a few minutes when loading dependencies from the Windows filesystem.

The local network is an integration environment. Its organizations run on one machine and do not demonstrate independent administration, production availability, or the final consortium privacy topology.

The normal web/API profile also has a separately verified Fabric HTTP acceptance flow: staff sign-in, private invitation, distinct certificate enrollment, committed lot creation and scoped inventory reads. That test uses the isolated `lotus-api-acceptance` channel and temporary application storage.

### Enable Fabric for a new web profile

The delivered operational profile is already bootstrapped and ready for operator setup in the web interface. For a fresh profile, create the operational channel, bootstrap its fixed server operator identity before creating any business data, then configure its separate FireFly runtime using `TOOLCHAIN_MIGRATION.md`. The first browser setup binds to that already enrolled identity; the person chooses their own credentials.

An alternative for an existing local **operator-only** profile is to stop its API and run:

```powershell
node scripts/fabric-config.mjs
$env:LOTUS_LEDGER = 'fabric'
$env:LOTUS_FABRIC_CONFIG = 'D:\Projects\LOTUS\.fabric-network\gateway.json'
npm start
```

Configure the operational FireFly runtime before this first Fabric start. Bootstrap/enrollment records are immutable; reuse an existing gateway configuration. The configuration script updates the profile marker only for the validated operator-only transition. It rejects a profile containing business state.

The configuration script enrolls the operator and anonymous relay on the fresh operational channel. Operator invitations in Fabric mode allocate and enroll a distinct unused local certificate for each staff actor. The supplied integration pool is finite; configure separately issued identities when it is exhausted. Manufacturing and distribution clients use Org2; care and safety clients use Org1 in this local environment.

Do not switch an already used local business profile to an empty Fabric channel. Existing local inventory, prescription balances and patient network domains require an explicit migration. The local development database and Fabric world state are separate authorities, and no automatic dual-writing or implicit import occurs.

Stop only this project's local Fabric processes with:

```powershell
wsl -d Ubuntu -- bash /mnt/d/Projects/LOTUS/scripts/fabric-stop.sh
```

The script checks process executable paths before stopping them. It does not delete ledger history or credentials.

## Complete a medicine workflow

1. Manufacturer staff register a product namespace/code, lot, expiry, initial base units and optional certificate. The certificate stores actual bytes with a verified content digest. The lot workspace produces a pack identification QR.
2. Manufacturer staff create a shipment to an approved distributor. Distributor staff accept or reject it. Acceptance is required before the distributor can forward stock.
3. Distributor staff dispatch stock to a pharmacy. Pharmacy staff accept the shipment. Inventory distinguishes available, in transit, quarantined, dispensed, returned and shrinkage quantities.
4. A prescriber issues an expiring quantity permit with a fresh holder credential and hands its QR to the patient. The patient's browser imports it into an encrypted local vault.
5. The patient creates a one-time counter code. Its allocated index is saved before display. The pharmacy scans that code and the shelf pack, confirms quantity and submits a fill.
6. The shared domain engine checks the product, accepted stock, expiry, recall state, remaining permit balance, pharmacy binding and unique commitment. Only a valid committed result permits handover. The patient imports the signed receipt; altered receipt content fails verification.
7. The regulator issues a lot-scoped recall with classification, reason and instructions. Further dispensing is blocked in the ledger. The patient downloads a broad bulletin and matches commitments locally.
8. The patient can acknowledge a recall or encrypt a side-effect narrative to the safety recipient before upload. Real Groth16 proofs are generated in the browser and verified by the selected ledger, including inside Fabric chaincode. Topic and network domains prevent cross-topic or cross-network replay; consumed nullifiers block repeated signals.

The same workspaces expose batch fills, return shipments, rejected returns, quarantine, documented losses and patient-credential-authorized pharmacy transfers. Draft batches are encrypted and stored durably. They are not successful dispenses; a single invalid fill causes the entire batch to fail.

## Patient privacy and recovery

The root secret and prescription credentials stay in an AES-GCM encrypted IndexedDB vault. A PBKDF2-derived passphrase key lives in memory while the vault is unlocked. Storage errors propagate instead of silently creating a code without saving its index. The interface locks after five minutes of inactivity.

A two-of-three guardian arrangement restores the secret. The encrypted backup package restores receipts, active permits, acknowledgement state and issued-code allocation history. It deliberately excludes the complete guardian share set. Save a new backup after new prescriptions and fills. A stale package cannot restore credentials created after it was downloaded.

Each guardian uses a separate encrypted browser vault for one share. Renaming a guardian does not rotate a share; replacement creates a new sharing arrangement. An old compromised device or colluding guardians cannot be made to forget a secret they already learned.

Public commitment feeds omit pharmacy, exact counter time, regional mapping and individual quantity. Matching is local, with explicit issued indices rather than a fixed 20-index gap scan. Staff and safety APIs do not expose a patient medicine directory. Free-text reports can still identify their author if the author types identifying information; the submission screen explains this.

Patient alerts retain English, Hindi, Kannada and Telugu translations. Complete localization and independent native-speaker review remain deployment work.

## Phone access and offline behavior

The interface fits phone screens and can be installed as a PWA through a supporting browser. The built service worker caches the application shell, route assets and proof files. Encrypted vault data and the last completed bulletin are stored locally. Staff sessions, protected API responses and documents are not cached by the worker.

Offline matching uses the saved bulletin and clearly states that a fresh check could not complete. It never labels an incomplete check as a current safety result. New transactions and report uploads require a connection.

Private recall checks run while the web app is open and unlocked. Opted-in system notifications use generic wording. Guaranteed private matching while the browser is closed is not available in this implementation. Conventional recall channels should continue. Production Web Push broadcast delivery, notification job infrastructure and service-level monitoring remain separate work.

Use HTTPS for a real phone deployment. Browser cryptography, cameras and service workers require a secure origin; localhost is accepted for development. The default loopback address is accessible only from this computer. Reverse-proxy deployment and trusted certificates are required before exposing a phone-accessible endpoint.

## Source imports and the replay sandbox

Safety staff can fetch official openFDA notices or import saved JSON records. The import retains source records and digests, resolves exact product/lot candidates and leaves ambiguous or unparseable scope unresolved. An import alone does not issue a recall. Network failures do not create sample data or substitute an unrelated lot.

Run a separate local sandbox with:

```powershell
npm run sandbox
```

It serves at `http://127.0.0.1:8789`, stores its data under `.lotus-sandbox-data/`, uses a distinct proof network domain and requires its own operator setup. The regulator's replay lab is enabled only in this profile. Stage the source notice's exact product and lot through the normal manufacturer and custody workflows before replaying it. The comparison counts product-code dispense records versus exact-lot dispense records, not unique people. Live profiles reject the replay endpoint.

The original research tools remain under `pipeline/`, `redteam/`, `circuits/`, and `contracts/`. Their reports and synthetic evaluation are historical/research evidence. The new application's delivery and load measurements must not be replaced by those synthetic statistics. The old Hardhat walkthrough and browser scripts describe the previous UI and are retained as reference, not the new entry point.

## Verification commands

```powershell
npm test
npm run test:browser
```

The contract and SDK tests retain the original behavioral and cryptographic reference. The new API suite checks authenticated actors, documents, atomic inventory/permit updates, failed-batch rollback, idempotency, custody resolution, returns, shrinkage, real anonymous reports, encrypted narrative retrieval, recalls, replay prevention, transfer and scoped drafts. Browser tests use isolated temporary data and independent contexts; they do not seed the normal profile.

For the real Fabric acceptance channel:

```powershell
wsl -d Ubuntu -- bash -c 'LOTUS_FABRIC_CHANNEL=lotus-acceptance bash /mnt/d/Projects/LOTUS/scripts/fabric-native.sh'
node scripts/fabric-config.mjs channel=lotus-acceptance operator=fabric-test-operator output=.fabric-network/acceptance-gateway.json
npm run test:fabric
```

Bootstrap a channel only once. Subsequent runs use its existing configuration and enrolled acceptance actors. The acceptance channel is separate from `lotus-operations`; its test stock never enters the normal application's operational channel. Machine-readable acceptance output is saved under ignored `.fabric-network/acceptance-result.json`.

## Remaining production deployment work

The application and local Fabric flow are implemented and tested. A production consortium still needs independently managed peers/orderers, CA enrollment and key custody, separate safety/anonymous services, reviewed production proof setup, signed broad feeds with privacy-preserving publication timing, regulator access policies that hold beyond the API, a trusted time policy, scalable projections and pagination, managed storage/retention/backups, full localization, notification delivery jobs and real integrations/load measurements.

The supplied network's static two-organization endorsement rule and pre-generated certificate pool are integration settings. They are not the state-based, collection-specific governance model proposed for an independent production consortium. Browser vault backups are downloaded encrypted packages, not an unattended cloud recovery service. Current expiry checks use the service/Fabric proposal timestamp, not the planned independently attested time protocol. These limits belong in deployment acceptance decisions; they are not hidden by the interface.

Keep `.lotus-data/`, `.lotus-sandbox-data/`, `.fabric-network/` and `.fabric-runtime/` out of source control. Preserve database, document ciphertext and key files together when backing up a local profile. Never copy integration administrator keys into a public deployment.
