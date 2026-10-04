# Google Drive for sync: the app's sign-in client

For maintainers. Memora for your computer can sync through Google Drive ([DESKTOP.md](DESKTOP.md#sync-your-computers), [ADR 0006](adr/0006-sync-through-a-cloud-folder.md)). To sign people in to Google, the app needs an **OAuth client** of the project's own: a Google Cloud project with a consent screen, and a client of type "Desktop app". Its id and secret are added to release builds by CI.

Until that is set up, release builds offer Google Drive only with a client of the person's own (Settings → Sync → Advanced), and the other ways to sync work as they are.

## What Memora asks Google for

- **One scope: `https://www.googleapis.com/auth/drive.file`.** It lets an app see and change only the files it created, or that the person opened with it. Google classes it as non-sensitive: it needs no security assessment and no scope review.
- **OAuth for installed apps**: the person signs in in their own browser, with PKCE, and Google redirects to Memora on `http://127.0.0.1:<port>/api/v1/sync/google/callback`. Google allows any port on the loopback address for desktop clients.
- **The client secret isn't secret.** Every copy of the app has it, and Google says a desktop client's secret can't be kept confidential. The person's consent, PKCE and the loopback redirect protect the sign-in. The secret is still kept out of the repository (secretlint and gitleaks would flag it) and added by CI.

## Setting it up

With the Google account that should own the project (the maintainer's):

1. In the [Google Cloud console](https://console.cloud.google.com/), make a project, for example "Memora".
2. **APIs & Services → Library:** enable the **Google Drive API**.
3. **Google Auth Platform → Branding:**
   - **App name:** Memora. Add a support e-mail address.
   - **App home page:** `https://dreamtheater484.github.io/memora/`
   - **Privacy policy:** `https://dreamtheater484.github.io/memora/privacy.html` (`site/privacy.html`)
   - **Authorised domain:** `dreamtheater484.github.io`. Google wants proof of it in [Search Console](https://search.google.com/search-console): add the site as a URL-prefix property, and verify it with the HTML file Google gives, put in `site/`.
   - A logo is optional. Adding one makes Google check the branding before it shows the logo.
4. **Google Auth Platform → Audience:** user type **External**. Then **Publish app**, to "In production".
   - In "Testing", only listed test users can sign in, and their sign-ins expire after 7 days.
   - With only non-sensitive scopes, publishing needs no review.
5. **Google Auth Platform → Data access:** add the one scope `…/auth/drive.file`. Nothing else.
6. **Google Auth Platform → Clients → Create client:** type **Desktop app**, named for example "Memora desktop". Copy the **client ID** and the **client secret**.
7. In GitHub, **Settings → Secrets and variables → Actions**:
   - variable **`MEMORA_GOOGLE_CLIENT_ID`**: the client ID;
   - secret **`MEMORA_GOOGLE_CLIENT_SECRET`**: the client secret.

The next release's desktop apps sign in to Google Drive by themselves. Pull requests' builds don't get the secret.

## Trying it locally

Build the desktop app with the two values in the environment (`apps/desktop/build.mjs` puts them in the main process, which passes them to the server):

```bash
MEMORA_GOOGLE_CLIENT_ID=… MEMORA_GOOGLE_CLIENT_SECRET=… pnpm --filter @memora/desktop build
```

Or run the server by hand in desktop mode with `MEMORA_GOOGLE_CLIENT_ID` and `MEMORA_GOOGLE_CLIENT_SECRET` set.

## If something goes wrong

| What you see                                                               | Why                                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| "Access blocked: Memora has not completed the Google verification process" | The consent screen is in "Testing" and the account isn't a test user. Publish it (step 4).             |
| People must sign in again every week                                       | The consent screen is still in "Testing".                                                              |
| "Google doesn't accept this Memora build's sign-in client"                 | The client was deleted, or the id and secret don't belong together. Check the variable and the secret. |
| Memora's folder can't be found on a second computer                        | That computer's build uses another client: `drive.file` access belongs to a client's project.          |
