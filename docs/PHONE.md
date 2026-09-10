# Getting this onto a phone

Everything between a fresh clone and an icon on a Home Screen that opens the
journal, in the order you actually do it.

There are four ways to end up with this app on a phone, and they are not
alternatives so much as a staircase — each one builds on the one before it.
You do not have to climb all of it. Most people should stop after step one.

| | Path | What you need | Who can install it | Cost | Expires |
|---|---|---|---|---|---|
| **A** | [Home Screen web app](#path-a--the-home-screen-app-no-mac-no-apple-account) | A browser | Anyone with the link | Nothing | Never |
| **B** | [Native app on your own iPhone](#path-b--the-native-app-on-your-own-iphone) | A Mac, Xcode, an Apple ID | Only you, on devices you plug in | Nothing | Rebuild every 7 days |
| **C** | [TestFlight](#path-c--other-peoples-phones-testflight) | Path B + $99/yr | Up to 10,000 people via a link | $99/yr | Each build after 90 days |
| **D** | [The App Store](#path-d--the-app-store) | Path C + review | Everyone | $99/yr | Never |

**Start with Path A.** It is already wired up, it costs nothing, it works on
iPhone and Android alike, it is offline-capable, and it is a real Home Screen
icon rather than a bookmark. Go further only when you want one of the four
things Path A cannot give you:

| Only on the native app (B and up) | Why the web cannot do it |
|---|---|
| **Reminders that fire with the app closed** | `src/lib/nativeReminders.ts` — the phone's own scheduler. In a browser there is no notification while the page is dead; inside the packaged app there is no `Notification` global at all, so this layer replaces it rather than improving it. |
| **A Home Screen widget** | `ios/BellwetherWidget/` — WidgetKit reads an on-device App Group. No web equivalent exists. |
| **Exports that actually leave** | `src/lib/saveFile.ts` — the anchor-click download does nothing inside a WKWebView. Native routes the file to the share sheet instead. |
| **Haptics** | `src/lib/feedback.ts` — the Taptic Engine, rather than the blunt `navigator.vibrate`. |

Nothing on either path sends your journal anywhere. The three optional
features that can talk to a network (sync, AI analysis, the update check) are
off until you switch them on, on every path equally.

---

## Path A — the Home Screen app (no Mac, no Apple account)

About fifteen minutes, most of it waiting for a deploy.

### A1. Build it once, locally

```bash
npm ci          # exact dependency versions from package-lock.json
npm run check   # typecheck + the full test suite + a production build
```

`npm run check` is the gate everything else assumes. It should end with a
`dist/` listing and a `PWA v1.3.0 … files generated` block naming `dist/sw.js`
— that service worker is what makes the installed app work offline. If the
check fails, fix that before deploying; nothing downstream gets easier.

### A2. Look at it on your phone before you deploy anything

Worth doing first, because it costs one command and tells you whether the
thing is actually usable in a hand.

```bash
npm run dev -- --host
```

Vite prints a **Network** address (`http://192.168.x.x:5173`). Open that on a
phone on the same Wi-Fi. This is the real app on real glass — but over plain
HTTP, so the install prompt, offline mode and the camera will not work. Those
need HTTPS, which is the next step.

### A3. Deploy it

The app is entirely static. "Deploying" is uploading a folder; there is no
server, no database and no secret involved.

**GitHub Pages — already wired up.** `.github/workflows/pages.yml` builds and
publishes on every push to `main`, and it reads the real Pages base path, so a
project site at `youruser.github.io/bellwether/` works with nothing edited.

It needs **one manual switch, once**: repository **Settings → Pages → Source →
GitHub Actions**. Creating a Pages site needs admin rights the workflow's
built-in token does not have, so until a human flips this the deploy fails with
*"Resource not accessible by integration"*. After that, re-run the failed job
or push anything to `main`, and your URL appears at the top of the workflow's
`deploy` job.

**Anywhere else** (Netlify, Vercel, Cloudflare Pages, your own box):

```bash
npm run build                                  # -> dist/, for a domain root
BASE_PATH=/sub/path/ npm run build             # if it won't sit at the root
SITE_URL=https://example.com npm run build     # absolute URLs in link previews
```

Then serve `dist/`. Two rules, both of which the Pages workflow already handles
and a hand-rolled host will not:

- **Serve it over HTTPS.** Without it there is no install prompt, no service
  worker, no offline, and no camera.
- **Send unknown paths to `index.html`** (an SPA rewrite, or copy `index.html`
  to `404.html`). Otherwise a reload on any screen 404s.

### A4. Install it

**iPhone / iPad — Safari only.** Chrome and Firefox on iOS cannot install a web
app; they will offer a bookmark that is not the same thing.

1. Open the deployed URL in **Safari**.
2. Tap **Share** (the square with the arrow, in the bottom bar).
3. Scroll to **Add to Home Screen** → **Add**.

**Android — Chrome.** A banner offers **Install app**; if you dismissed it, the
⋮ menu → **Install app** / **Add to Home screen** does the same.

### A5. Check that it actually installed

Not ceremony — an installed app and a bookmark to the same URL look identical
on the Home Screen and behave completely differently.

1. **It launches full-screen.** No Safari address bar at the top. If you can
   see one, you added a bookmark.
2. **It works in Airplane Mode.** Turn Wi-Fi and cellular off, force-quit,
   reopen. The journal should load. This is the service worker doing its job.
3. **The shortcuts exist.** Long-press the icon: *Log today*, *This week's
   report*, *Search your journal*.
4. **Storage is persistent.** Settings → Backup & storage tells you whether the
   browser granted it, with a button if it did not.

### A6. Then protect the journal, immediately

This matters more on Path A than anywhere else, and it is the one step people
skip.

Your journal lives in this browser's IndexedDB. Nobody can recover it for you —
there is no server holding a copy. Three things help, in order:

1. **Save a backup file.** Settings → Backup & storage → *Full backup*. An
   ordinary `.json`, photos included, that restores anywhere.
2. **Install to the Home Screen** (you just did). Installed apps are exempt from
   the idle-eviction rule that clears ordinary sites — iOS Safari drops storage
   for sites unvisited for about a week.
3. **Grant persistent storage** when asked.

Clearing site data by hand still erases everything. Export first.

---

## Path B — the native app on your own iPhone

A real `.app`, signed by you, with the widget and the phone-scheduled
reminders. This is the first step that requires a **Mac**.

### B1. What you need

- A Mac.
- **Xcode**, free from the Mac App Store. Large; start the download early.
- An **Apple ID**. A free one is enough to build onto your own device — Xcode
  re-signs the app each time you run it, and the signature lasts **7 days**,
  after which the app refuses to launch until you plug in and hit Run again.
  It also caps you at 3 sideloaded apps. The $99/yr Apple Developer Program
  removes both limits and is required for Paths C and D.
- **CocoaPods**: `sudo gem install cocoapods`.

### B2. Build the web bundle and sync it into the native project

In the repo root, on the Mac:

```bash
npm ci
npm run build
npx cap sync ios
```

`cap sync` does two things: copies `dist/` into `ios/App/App/public`, and runs
`pod install`. **Re-run these three lines after every web-side change you want
to see in the native app** — the native project does not read `src/`, it reads
the built copy of it.

### B3. Open the workspace

```bash
open ios/App/App.xcworkspace
```

The **`.xcworkspace`**, not the `.xcodeproj`. CocoaPods only wires the pods into
the workspace; opening the project directly gives you a build that cannot find
Capacitor.

### B4. Sign it

Select the **App** target → **Signing & Capabilities** → **Team**: your Apple
ID. If `com.cvree.bellwether` is taken, change the Bundle Identifier here *and*
in `capacitor.config.ts`'s `appId` so they stay in step.

### B5. Run it on the phone

Plug the iPhone in, trust the computer, pick it as the destination at the top
of the Xcode window, and hit **Run** (⌘R).

The first run on a device signed with a free Apple ID stops with *"Untrusted
Developer"*. On the phone: **Settings → General → VPN & Device Management** →
your Apple ID → **Trust**. Then Run again.

At this point you have the app, the native reminders and the native share-sheet
exports. **The widget needs three more steps**, and they cannot be scripted.

### B6. Add the widget (optional)

The Swift source is written and sitting in `ios/BellwetherWidget/`, but the
Xcode *target* that compiles it does not exist yet — target creation is not
something anything outside Xcode can do to a `project.pbxproj` safely, so it is
genuinely yours to click through once.

1. **App Groups on the app target.** App target → *Signing & Capabilities* →
   **+ Capability** → *App Groups* → **+** → `group.com.cvree.bellwether`. It
   must match `ios/App/App/App.entitlements` exactly.
2. **Add the bridge plugin to the target.** `WidgetBridgePlugin.swift` is on
   disk in `ios/App/App/` but not in the project. Right-click the `App` group in
   the Project Navigator → *Add Files to "App"…* → select it → **Target: App**
   checked.
3. **Create the extension.** *File → New → Target… → Widget Extension*, named
   `BellwetherWidget`, **uncheck** "Include Configuration Intent". Delete the
   `.swift` files Xcode generates and add `BellwetherWidget.swift` and
   `BellwetherWidgetBundle.swift` from `ios/BellwetherWidget/` with **Target:
   BellwetherWidget** checked.
4. **App Groups on the widget target too** — tick the *same* group, do not
   create a second one.

Run again, then long-press the Home Screen → **+** → search *Bellwether*.

**Verify the loop:** log an entry, background the app, and the widget should
update within seconds — the JS side calls `WidgetCenter.reloadAllTimelines()`
on every save rather than waiting for WidgetKit's own budget. Tapping the
widget should open today's Quick Log.

`docs/WIDGET_SETUP.md` has the full detail, including which three files to edit
together if you change what the widget shows.

### B7. The iteration loop, once it is running

```bash
npm run build && npx cap sync ios     # then ⌘R in Xcode
```

If you are changing the UI a lot, you can skip that round-trip: add a
`server: { url: "http://192.168.x.x:5173", cleartext: true }` block to
`capacitor.config.ts`, run `npm run dev -- --host`, and the native shell will
load from your Mac live. **Delete that block before you archive anything** — a
shipped app pointing at your laptop is a broken app.

---

## Path C — other people's phones (TestFlight)

The honest recommendation for family and friends. One link, they install one
app, nobody gets added to anything, and there is no full App Review.

### C1. Enrol

Apple Developer Program, $99/yr, at developer.apple.com. As an individual you
can enrol with just your Apple ID; enrolling as an organisation needs a legal
entity and a D-U-N-S number, which takes weeks. **`docs/SHIPPING.md` §2** walks
through whether an entity should come first at all — it is a real decision for
a health-adjacent app and not one to make in passing.

Your **legal name is published** as the seller if you enrol as an individual.
That is the usual reason people form an entity first.

### C2. Create the app record

App Store Connect → **My Apps → +** → New App. Bundle ID must match B4 exactly.
The name must be unique across the whole App Store — if *Bellwether* is taken,
`docs/SHIPPING.md` §6 has five alternatives and how to check.

### C3. Version the build

```bash
npm run version:ios
```

This sets `MARKETING_VERSION` from `package.json` and `CURRENT_PROJECT_VERSION`
from the commit count. The build number only has to strictly increase per
upload, and a commit count cannot forget to — a hand-typed counter fails the
first evening you archive twice.

### C4. Archive and upload

```bash
npm run check && npm run check:store
npm run build && npx cap sync ios
```

Then in Xcode: destination **Any iOS Device (arm64)** → **Product → Archive** →
**Distribute App → TestFlight & App Store → Upload**.

Archiving with a Simulator destination selected produces an archive Xcode will
not let you distribute. That is the most common ten-minute mistake here.

### C5. Answer export compliance

Asked on the first upload of every version. Sync encrypts before it uploads
(`src/lib/sync/`), so the answer is not a reflexive "no". **`docs/APP_STORE.md`
§Export compliance** has the exact answers and why.

### C6. Invite people

- **Internal testers** — up to 100 people who are users on your App Store
  Connect team. No review, available minutes after processing.
- **External testers** — up to 10,000 via a public link. Needs **Beta App
  Review**, once per version, usually about a day.

Every build expires **90 days** after upload. Ship a new one or your testers
lose the app.

---

## Path D — the App Store

Everything in Path C, plus a listing and a full review.

### D1. Clear the preflight

```bash
npm run check:store
```

Right now it reports **two things left**, both yours to fill in:

```
✗  public/privacy.html still contains PUBLISHER_NAME, CONTACT_EMAIL, EFFECTIVE_DATE
✗  public/support.html still contains CONTACT_EMAIL
```

Those two pages are the privacy-policy URL and support URL App Store Connect
requires, and a reviewer who clicks one and finds a placeholder is a rejection.
Edit them, delete the yellow "Before you publish" box in each, re-run until it
prints `Ready to archive.`

The other six checks already pass — camera usage description, privacy manifest
wired into the Resources phase, version match, deployment target 15, a
1024×1024 icon with no alpha, and no key-shaped strings anywhere.

### D2. Fill in the listing

`docs/APP_STORE.md` is the mechanical half, written to be pasted: the listing
copy, the App Privacy questionnaire answered field by field, the age rating,
the review notes, and the screenshot sizes.

The privacy questionnaire is **not a row of zeroes** and answering it as one is
a false statement to Apple. Sync sends an email address and encrypted blobs;
the optional AI analysis sends daily numeric answers to whichever provider the
user brought a key for. Both are off until switched on — which is a good answer,
but it has to be *given*.

### D3. Submit

Attach the build, submit for review. Days rather than weeks, usually. If it
comes back, the rejection names a guideline number; `docs/SHIPPING.md` §4 lists
the ones that specifically bite a health journal — 1.4.1 (no diagnosis claims),
2.1 (a reviewer must be able to see the whole app without an account), 5.1.1
(data collection).

---

## Android

**Path A already works on Android** and is the whole story for most people —
Chrome's install is closer to a native app than iOS Safari's, and the offline
behaviour is better.

A native Android build is not set up in this repo — there is no `android/`
directory and `@capacitor/android` is not a dependency. Adding it is the
standard Capacitor route:

```bash
npm i -D @capacitor/android
npx cap add android
npm run build && npx cap sync android
npx cap open android          # then Run, from Android Studio
```

Be aware that nothing native here has been built or tested against it: the
widget is WidgetKit (iOS-only, and would need a separate App Widget written in
Kotlin), and the notification, haptic and share paths are written against
Capacitor plugins that do support Android but have never been run there.

---

## Keeping it updated

The update model is the sharpest practical difference between the paths.

- **Path A** — push to `main`. The service worker is `registerType: "autoUpdate"`,
  so installed phones pick the new version up on their next launch. No store, no
  approval, no action from anyone.
- **Paths B–D** — every web change needs `npm run build && npx cap sync ios` and
  a new binary. Nothing in `src/` reaches an installed native app on its own.

---

## When it goes wrong

| What you see | What it is |
|---|---|
| Added to Home Screen, but it opens in Safari with an address bar | A bookmark, not an install. Re-do A4 in Safari itself, not Chrome. |
| No offline, no install prompt | Not HTTPS, or the service worker did not register. Check DevTools → Application → Service Workers. |
| Deployed to Pages, everything 404s | The one manual switch in A3 (Settings → Pages → Source: GitHub Actions) hasn't been flipped, or the base path is wrong — the workflow derives it, a hand-rolled deploy does not. |
| Reload on a sub-screen 404s | No SPA fallback. Copy `index.html` to `404.html`, or configure a rewrite. |
| `privacy.html` opens the app instead of the page | Something is bypassing `navigateFallbackDenylist` in `vite.config.ts`. Those two URLs are what a reviewer clicks; fix before submitting. |
| Xcode: "No such module 'Capacitor'" | You opened `.xcodeproj`. Open `App.xcworkspace`. |
| Xcode: pods out of date after a dependency change | `npx cap sync ios` again — it runs `pod install`. |
| The app on the phone won't launch after a week | Free Apple ID signing expired. Plug in, hit Run. |
| "Untrusted Developer" on first install | Settings → General → VPN & Device Management → trust your Apple ID. |
| The web app updated but the native app didn't | You skipped `npx cap sync ios`. The native project reads `dist/`, not `src/`. |
| Camera does nothing in the native app | Needs iOS 14.3+ inside a WKWebView; the project targets 15, so check the usage description survived — `npm run check:store` asserts both. |
| Widget shows placeholder data forever | The App Group string does not match across the app target, the widget target and both `.entitlements` files. All four must be `group.com.cvree.bellwether`. |
| Upload rejected as ITMS-91053 | The privacy manifest is not in the Resources build phase. `npm run check:store` catches this before you spend the upload. |
| Archive is greyed out in Distribute | It was built for the Simulator. Destination: *Any iOS Device (arm64)*. |

---

## The other documents

- **`docs/WIDGET_SETUP.md`** — Path B in full, plus what to edit if you change
  what the widget displays.
- **`docs/SHIPPING.md`** — the *decisions* behind Paths C and D: which
  distribution route suits which audience, whether an entity comes first, and
  what "legally covered" does and does not mean for a health app that gives no
  advice.
- **`docs/APP_STORE.md`** — the paste-ready half: listing copy, App Privacy
  answers, review notes, screenshots.
