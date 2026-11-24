# diary

A daily photo diary. Many photos a day, a note on each photo, and a film-camera date stamp on each print.

- **Today** page: today's photos and note.
- **Archive** page: every month as a contact sheet. Tap a day to open it.
- Works on phone, tablet and computer.
- Saved in the browser on each device.
- **Automatic backup** (Chrome/Edge on a computer): choose a folder once on the Archive page. Every photo is copied there as a JPEG, with all writing in `diary.json`, as you add things.
- On iPhone/iPad: **Save backup** sends a backup file to Files or iCloud Drive.
- **Take a photo** opens the camera directly on phones.
- New code on GitHub swaps into an open page by itself (checks every 30 seconds), no reload.

Files: `index.html` (loader), `app.js` (app), `style.css` (look).

On iPhone: open in Safari → Share → Add to Home Screen. This also keeps Safari from clearing the data.

## Cloud account (Firebase)

Sign in with Google on the Archive page to keep the diary in your own account and sync it between devices.
The browser keeps working offline; changes sync when you're back online.

Setup (once):
1. https://console.firebase.google.com → Add project.
2. Authentication → Sign-in method → Google → Enable. Settings → Authorized domains → add `michellejnoh.github.io`.
3. Firestore Database → Create database (Seoul, production mode) → Rules → paste `firestore.rules` → Publish.
4. Project settings → Your apps → Web → register → copy the config into `firebase-config.js`.

Photos are stored resized inside Firestore (free tier, no card needed).
