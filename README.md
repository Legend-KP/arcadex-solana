# ArcadeX (Solana)

Multi-game arcade on Solana — web backend + **native Android shell** for Solana Mobile / Seeker.

## Problem (Seeker retention)

Seeker users get wallets and dApps, but few **daily consumer reasons** to reopen the phone. DeFi and one-shot mint apps do not create a habit loop. ArcadeX targets that gap: short arcade sessions, regenerating Sparks, streaks, contests, and USDC micro-payments so players return every day—not only when there is a new airdrop.

**Initial audience:** Seeker / Solana Mobile players who already hold USDC and want quick play + on-chain competition.  
**Retention proof:** day-1 → day-7 return via streak check-ins, Sparks spend/refill, and contest score submits (wallet-tied leaderboards).

## X-factor (beyond “arcade + payments”)

- **Native Android shell + MWA** — home, wallet, Sparks shop are native; WebView is only for Unity play  
- **Wallet-gated economy** — Sparks refill, infinite Sparks, and score submit are mainnet USDC/USDT with on-chain memo + server confirmation  
- **Verifiable competition** — contest/leaderboard submits tied to paid Solana txs, not honor-system web scores  
- **Daily habit stack** — streaks, daily shuffle, weekly XP board, rotating games for Seeker session length  

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
