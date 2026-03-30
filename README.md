# RoundU Backend

Node.js + Express + TypeScript API for the RoundU platform.

## Tech Stack

- **Runtime**: Node.js 20 + Express 4 + TypeScript
- **Database**: PostgreSQL 16 + PostGIS
- **Cache/Queue**: Redis 7 + BullMQ
- **Real-time**: Socket.io 4
- **Payments**: Stripe
- **Voice calls**: ElevenLabs Conversational AI
- **AI inference**: vLLM (OpenAI-compatible)
- **OTP**: MSG91
- **Push**: Firebase FCM
- **Storage**: AWS S3
- **Maps/ETA**: Google Directions API

## Setup

1. Clone the repo
2. Copy env: `cp .env.example .env` and fill in values
3. Start services: `docker-compose up -d postgres redis`
4. Install deps: `npm install`
5. Run migrations: `npm run migrate`
6. Start dev server: `npm run dev`

Server runs on http://localhost:3000

## Team ownership

| Dev | Domain | Key files |
|-----|--------|-----------|
| Lead | Config, middleware, socket, utils, migrations | src/config/*, src/middleware/* |
| Dev 1 | Wallet + Stripe + Cashback | wallet.*, payment.*, stripe.*, cashback.* |
| Dev 2 | Subscriptions + ElevenLabs + Notifications | subscription.*, elevenlabs.*, auto-call.*, reminder.* |
| Dev 3 | GPS + vLLM + AI + Recommendations | gps.*, vllm.*, service-report.*, recommendation.* |
| Dev 4 | Referrals + Offers + Portfolio + Tracking | referral.*, offer.*, portfolio.*, tracking.*, preference.* |

## Git workflow

- `main` — production, always deployable
- `develop` — integration, all features merge here first
- `feat/*` — individual feature branches

No direct pushes. PRs only. CI must pass before merge.

## API base

All endpoints: `http://localhost:3000/api/v1/...`

Response format: `{ success: boolean, data: any, message: string, error: string | null }`
```

---

**Now create all the placeholder source files.** Open the VS Code terminal (Ctrl+`) and paste the entire PowerShell block from Step 5 in my previous message. It creates all 138 files with owner comments.

After all files are created, do the first commit:
```
git add -A
git commit -m "chore: initial project structure — 138 files with ownership tags"
git branch -M main
git remote add origin https://github.com/arjun-30/roundu-backend.git
git push -u origin main
git checkout -b develop
git push -u origin develop