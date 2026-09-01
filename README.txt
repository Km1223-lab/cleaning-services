KM CLEANING SERVICES — FILE PACKAGE
====================================

WHAT'S IN HERE
--------------
1. km-cleaning-services.html   -> Your main website (upload this to your web host)
2. km-chat-worker.js           -> Cloudflare Worker code (paste into Cloudflare, not your web host)
3. admin.html                  -> Staff dashboard for viewing/managing booking requests
4. manifest.json + service-worker.js + icons/  -> Makes the site installable as an app (see PART C)

SETUP ORDER
-----------
Do these in order — the Worker needs to exist before the website/dashboard can use it.

STEP 1 — Deploy the Worker
  a. Cloudflare dashboard -> Workers & Pages -> Create -> Create Worker
  b. Name it (e.g. km-cleaning-chat-proxy) -> Deploy
  c. Click "Edit code" -> delete the default code -> paste in the FULL contents
     of km-chat-worker.js -> Deploy
  d. Create storage for bookings:
     Workers & Pages -> KV -> Create namespace -> name it e.g. km_bookings
     Then on your Worker: Settings -> Bindings -> Add -> KV Namespace
       Variable name: BOOKINGS_KV   Namespace: km_bookings
  e. Add two secrets: Settings -> Variables and Secrets -> Add
       ANTHROPIC_API_KEY = your key from console.anthropic.com
       ADMIN_KEY         = a password you make up, for logging into admin.html
     Mark both as "Secret", then Save + Deploy.
  f. In the Worker code, edit the ALLOWED_ORIGINS list near the top to include
     your real website's URL (and wherever you host admin.html), then Deploy again.
  g. Copy your Worker's URL — looks like:
     https://km-cleaning-chat-proxy.YOUR-SUBDOMAIN.workers.dev

STEP 2 — Connect the website
  Open km-cleaning-services.html in a text editor and find:
     const WORKER_URL = "https://km-cleaning-chat-proxy.YOUR-SUBDOMAIN.workers.dev";
  Replace it with the real Worker URL from Step 1g.
  Also update:
     const BUSINESS_PHONE = "254700000000";  -> your real WhatsApp number, format 2547XXXXXXXX
  Then upload the WHOLE FOLDER (keeping the icons/ subfolder and manifest.json,
  service-worker.js alongside km-cleaning-services.html) to your web host, so the
  file structure on your host looks like:
     yoursite.com/km-cleaning-services.html
     yoursite.com/manifest.json
     yoursite.com/service-worker.js
     yoursite.com/icons/icon-192.png (etc.)

STEP 3 — Use the admin dashboard
  Host admin.html on the same site/domain as your website (or add its URL to
  ALLOWED_ORIGINS in Step 1f). Open it in a browser, enter:
     Worker URL: the same URL from Step 1g
     Admin key:  the ADMIN_KEY password you set in Step 1e
  and sign in.

PART C — TURNING THIS INTO AN "APP" (no APK build tools needed)
-----------------------------------------------------------------
manifest.json, service-worker.js and icons/ turn the website into a Progressive
Web App (PWA). Once it's live on your domain (Step 2), any visitor on Android
Chrome can tap the browser menu -> "Add to Home screen" / "Install app", and it
installs like a real app: its own icon, opens full-screen with no browser bar,
and works offline for browsing. No app store, no APK, no waiting for review.

If you specifically want an installable .apk file (e.g. to share the file
directly, or list it on the Play Store), the easiest path once the site is
live is PWABuilder (pwabuilder.com, a free tool by Microsoft):
  1. Go to pwabuilder.com and enter your live website's URL
  2. It reads your manifest.json automatically and scores your PWA
  3. Click "Package for stores" -> "Android" to generate a signed .apk / .aab
  4. Download the package — that's your installable Android app

This isn't something that can be produced directly in this chat: generating a
real .apk needs the Android build toolchain (Android SDK, Gradle, a signing
key) which isn't available here, and your site needs to be live at a real URL
first anyway since the app just wraps that URL. PWABuilder is the standard
free way to do this last step once you're hosted.

NOTES
-----
- The admin key is only kept in the browser tab's memory — refreshing the page
  signs you out again. This is intentional (keeps the key off disk).
- Set a spending cap on your Anthropic account as a backstop, since the AI
  chat endpoint is public-facing.
- Still to personalize: WhatsApp number and email in the website's contact
  section and footer, and the gallery photos (currently styled placeholders).
