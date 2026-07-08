# Gift Derby — TikTok LIVE Horse Race

Each horse is locked to one TikTok gift. When someone sends that gift, the horse moves forward by **how many they sent** (not the gift's diamond value). First horse to cross the finish line wins.

## How it works

- `config/horses.json` — edit this to set how many horses you have and which gift each one is assigned to.
- `server.js` — connects to your TikTok LIVE using [`tiktok-live-connector`](https://github.com/zerodytrash/TikTok-Live-Connector), listens for `gift` events, and moves the matching horse.
- `public/index.html` — the race track page (open this in a browser, or add it as an OBS Browser Source later).

Movement is **live/twitchy**: if someone holds down a gift for a combo (e.g. sends Rose x10 in one long press), the horse jumps forward a little on every tick as the combo count increases, not just once at the end.

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000` in your browser.

### Testing without going live

You don't need an active TikTok LIVE stream to test the race. Use the **Debug: Simulate Gifts** panel on the page — click +1 / +5 / +10 under any gift to simulate that gift being sent and watch the matching horse move.

### Connecting to a real TikTok LIVE

1. Start a TikTok LIVE broadcast from your TikTok account.
2. On the page, type your TikTok username (no `@`) into the box at the top and click **Connect**.
3. Alternatively, set an environment variable so it connects automatically on server start:
   ```bash
   TIKTOK_USERNAME=yourusername npm start
   ```

### Getting a free sign-server API key (recommended)

`tiktok-live-connector` doesn't talk to TikTok directly — it goes through a "sign server" called Euler Stream that generates the security tokens TikTok requires. It works on a shared/free tier without an account, but that shared tier gets rate-limited when a lot of people are using it at once, which can cause connection failures.

For a more reliable connection:
1. Create a free account at [eulerstream.com](https://www.eulerstream.com)
2. Generate an API key from their dashboard
3. Set it as an environment variable: `EULER_API_KEY=your-key-here`

The server automatically uses it if present — no code changes needed.

## ⚠️ Important: verify your gift names

TikTok gift names in `horses.json` must match the exact string TikTok's servers report (e.g. `"Rose"`, `"GG"`, `"Finger Heart"`). Gift names, availability, and pricing change over time and vary by region, so before your first real stream:

1. Set `TIKTOK_USERNAME` and go live (or connect to a friend's test live).
2. Watch the server console — every gift event is available via `data.giftName`. Add a quick `console.log(data.giftName)` inside `handleGiftEvent` in `server.js` temporarily if you want to confirm names as they arrive.
3. Update `config/horses.json` with the exact names you see.

## Deploying to Render

1. Push this folder to a GitHub repo.
2. On Render, create a **Web Service** from that repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables (both optional, but recommended):
   - `TIKTOK_USERNAME` — your TikTok username, so it auto-connects on start
   - `EULER_API_KEY` — your free Euler Stream key, for a more reliable connection (see above)
6. Render usually auto-detects a modern Node version, but if you hit Node-related errors, add a `NODE_VERSION` env var set to `20` or newer.

**Note on Render's free tier:** free web services spin down after inactivity, which will drop the TikTok connection. For a live-streaming tool you'll likely want a paid instance type that stays running for the duration of your stream, or manually hit "Connect" on the page each time you go live.

## Editing horses / gifts

Open `config/horses.json`:

```json
{
  "trackLength": 40,
  "horses": [
    { "id": 1, "name": "Rose Runner", "giftName": "Rose", "emoji": "🌹", "color": "#e8546b" }
  ]
}
```

- `trackLength` — how many total steps a horse needs to win. Raise it for longer races.
- Add or remove horse objects freely (works for 8, 10, 12+ horses).
- `giftName` must exactly match the real TikTok gift name (see verification step above).

## Notes on the unofficial TikTok connector

`tiktok-live-connector` connects to TikTok's live signaling the same way the TikTok web client does. It's not an official public API, so it can occasionally need updates if TikTok changes something on their end. If gifts stop coming through after a TikTok update, check the library's GitHub repo for a newer version.
