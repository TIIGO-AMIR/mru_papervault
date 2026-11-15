# PaperVault Web (iPhone and Android)

The same PaperVault features as the Android app, as a web app that runs in Safari on iPhone and Chrome on Android.
It uses the same Supabase project, accounts and shared library.

## 1. Supabase (same as the Android app)

1. In **SQL Editor**, run `supabase_setup.sql` from the Android project. It is the same script.
2. **Authentication → Sign In / Providers → Email**:
   - Turn **off** "Confirm email" (no confirmation step).
   - Set **Minimum password length** to 8.
3. Confirm the storage bucket named `papers` exists and is private.

## 2. Connect the app

Open `config.js` and paste your Supabase values:

```js
supabaseUrl: "https://YOUR-PROJECT.supabase.co",
supabaseAnonKey: "your-anon-key",
```

Use the anon / publishable key only.

## 3. Put it online (HTTPS is required)

Web apps that work offline must be served over HTTPS. Any free static host works:

- **Netlify Drop**: go to app.netlify.com/drop and drag the whole `PaperVault_Web` folder onto the page.
- **GitHub Pages** or **Cloudflare Pages**: upload the folder to a repository and turn on Pages.

You get a web address such as `https://papervault-mru.netlify.app`. Test it in Safari and in Chrome.

## 4. Install on iPhone

1. Open the web address in **Safari** (not Chrome, which cannot install web apps on iPhone).
2. Tap the **Share** button, then **Add to Home Screen**.
3. Open PaperVault from the home screen.
4. The first login needs internet. After that the app opens and works offline.

On Android: open the address in Chrome, then choose **Install app** or **Add to Home screen**.

## How it works

| Feature | Behaviour |
|---|---|
| Accounts | Email and password. The first login needs internet. |
| Saving a file | Stored on the phone in the browser's offline storage, private to the account. |
| Sharing | Uploaded to the shared library when online. Queued while offline and sent when the phone reconnects. |
| Browse papers | Shows your files and shared papers. Works offline from the saved list. |
| View (eye icon) | Opens PDFs and photos inside the app. Shared papers download first if needed. |
| Download (arrow icon) | Saves a copy. On iPhone, choose **Save to Files**. |
| More (three dots) | On your own files: share, rename, edit details, delete. |

## Limits to know about

- **Uploads send only while the app is open** on iPhone. Web apps cannot send in the background there.
- **iPhone may clear offline files** for home-screen web apps that have not been opened for about a week. Ask students to open the app regularly.
- **Login tokens are stored in the browser** (localStorage). Anyone with the unlocked phone and the app open can use the account, the same as any web login.
- **Viewing is simple.** PDFs scroll one page after another. There is no zoom or search inside the document yet.

## Files

- `index.html`: the page shell.
- `app.js`: all screens and logic.
- `db.js`: offline storage.
- `sw.js`: the service worker that makes it work offline.
- `styles.css`: MRU colours and layout.
- `config.js`: your Supabase settings.
- `manifest.webmanifest` and `icons/`: home-screen install.
