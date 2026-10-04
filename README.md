# ArcadeX (Solana)

Multi-game arcade on Solana — web backend + **native Android shell** for Solana Mobile / Seeker.

## Clock In hackathon entry

The submission app lives in **[`arcadex-mobile/`](arcadex-mobile/)**.

Judges: start there for clone-and-run instructions and APK build steps.

```bash
cd arcadex-mobile
npm ci
npx expo start
# or: npx eas-cli build --platform android --profile preview
```

What the mobile app includes:

- Native home, wallet (Mobile Wallet Adapter), and Sparks shop
- Mainnet USDC payments for refill / infinite sparks / score submit
- WebView only for Unity game sessions

## Repo layout

| Path | Role |
|------|------|
| `arcadex-mobile/` | Expo Android shell (Clock In APK) |
| `app/` | Next.js web + API (Cloudflare) |
| `components/` | Web UI |
| `lib/` | Shared server/client logic |

## Web (developers)

```bash
npm ci
npm run dev
```

Production web: `https://arcadexseeker.trenchverse.com`
