# ArcadeX Mobile (Solana Clock In)

Native Android shell for ArcadeX on Solana Mobile. Built with Expo + Mobile Wallet Adapter.

This is **not** a full-site WebView wrapper:

- Native home (game grid)
- Native wallet connect / disconnect (MWA)
- Native Sparks shop (mainnet USDC fees)
- WebView only for Unity game pages (`/game/{id}`)

## Requirements

- Node 20+
- Android device or emulator
- Phantom (or Seed Vault on Seeker) for wallet flows
- Expo account (for EAS APK builds)

## Clone and run (judges)

Defaults point at the live backend: `https://arcadexseeker.trenchverse.com`  
You do **not** need Cloudflare / Firebase secrets to run the mobile app against production.

```bash
git clone https://github.com/Legend-KP/arcadex-solana.git
cd arcadex-solana/arcadex-mobile
npm ci
npx expo start
```

Then press `a` for Android, or scan the QR code with Expo Go / a dev client.

Optional overrides:

```bash
# .env (optional)
EXPO_PUBLIC_ARCADEX_URL=https://arcadexseeker.trenchverse.com
EXPO_PUBLIC_SOLANA_RPC_URL=https://your-private-rpc.example
```

## Build submission APK

```bash
cd arcadex-solana/arcadex-mobile
npm ci
npx eas-cli build --platform android --profile preview
```

Download the finished APK from the Expo dashboard link printed by the build.

dApp Store profile (post-win publish path):

```bash
npm run build:dapp-store
```

## Solana integration

| Action | Amount | Memo |
|--------|--------|------|
| Spark refill | $0.05 USDC | `arcadex:spark_refill` |
| Infinite Spark (24h) | $0.10 USDC | `arcadex:infinite_spark` |
| Score submit | $0.05 USDC | `arcadex:score_submit` |

- Chain: Solana mainnet (`solana:mainnet`)
- Protocol: Mobile Wallet Adapter (`@solana-mobile/mobile-wallet-adapter-protocol-web3js`)
- Payments: SPL USDC/USDT transfer to treasury + on-chain memo, confirmed via `/api/solana/payments/confirm`

## Project layout

```
arcadex-mobile/
  App.js                 # Native shell navigation
  mwa.js                 # MWA connect / sign / pay
  solana-pay.js          # SPL fee tx build + broadcast
  src/
    api.js               # Live ArcadeX HTTP API
    session.js           # Wallet JWT + address storage
    sparks.js            # Local spark state
    screens/
      HomeScreen.js      # Native game grid
      WalletSheet.js     # Connect / disconnect
      SparksSheet.js     # Refill / infinite shop
      GameScreen.js      # Game-only WebView
```

## Clock In notes

- Android APK required for submission
- Demo video should show: open app → connect wallet → play a game → Sparks purchase
- Pitch deck + Align portal submit are separate from this package
