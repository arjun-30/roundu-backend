# Roundu Backend — API Contract

**Base URL:** `https://your-domain.com/api`  
**Auth:** `Authorization: Bearer <accessToken>` (unless marked `public`)  
**Pagination:** All list endpoints accept `?page=&limit=` and return `{ data, total, page, limit }`

---

## Auth Roles

| Badge | Middleware |
|---|---|
| `public` | No auth required |
| `bearer` | Any authenticated user |
| `provider` | Authenticated + role: provider |
| `admin` | Authenticated + role: admin |
| `stripe-sig` | Stripe webhook signature |
| `digilocker-sig` | DigiLocker webhook signature |

---

## 1. Auth — `/api/auth`

### POST /api/auth/register
Register a new user and trigger OTP.

**Auth:** public

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| phone | string | ✅ | Phone number |
| name | string | ✅ | Full name |
| role | enum | — | `user` \| `provider` (default: `user`) |

**Responses:**
- `201` — OTP sent
- `400` — Validation error
- `409` — Already registered

---

### POST /api/auth/login
Send OTP for login.

**Auth:** public

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| phone | string | ✅ | Registered phone |

**Responses:**
- `200` — OTP sent
- `404` — User not found

---

### POST /api/auth/verify-otp
Verify OTP and receive tokens.

**Auth:** public

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| phone | string | ✅ | Phone number |
| otp | string | ✅ | 6-digit OTP |

**Responses:**
- `200` — `{ accessToken, refreshToken, user }`
- `401` — Invalid or expired OTP

---

### POST /api/auth/refresh
Refresh access token.

**Auth:** public

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| refreshToken | string | ✅ | Valid refresh token |

**Responses:**
- `200` — `{ accessToken }`
- `401` — Invalid token

---

### POST /api/auth/logout
Invalidate refresh token.

**Auth:** bearer

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| refreshToken | string | ✅ | Token to revoke |

**Responses:**
- `200` — Logged out

---

## 2. Users — `/api/users`

### GET /api/users/me
Get current user profile.

**Auth:** bearer

**Responses:**
- `200` — User object
- `401` — Unauthorized

---

### PATCH /api/users/me
Update user profile.

**Auth:** bearer

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| name | string | — | Display name |
| email | string | — | Email address |
| avatar | string | — | S3 URL |

**Responses:**
- `200` — Updated user
- `400` — Validation error

---

### DELETE /api/users/me
Delete account.

**Auth:** bearer

**Responses:**
- `204` — Account deleted

---

### GET /api/users/me/preferences
Get user preferences.

**Auth:** bearer

**Responses:**
- `200` — Preferences object

---

### PUT /api/users/me/preferences
Update user preferences.

**Auth:** bearer

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| notifications | boolean | — | Push enabled |
| language | string | — | Locale code |

**Responses:**
- `200` — Updated preferences

---

## 3. Services — `/api/services`

### GET /api/services
List all active services.

**Auth:** public

**Query params:** `category`, `search`

**Responses:**
- `200` — Array of services

---

### GET /api/services/:id
Get service details.

**Auth:** public

**Responses:**
- `200` — Service object
- `404` — Not found

---

### POST /api/services
Create a service. *(admin only)*

**Auth:** admin

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| name | string | ✅ | Service name |
| category | string | ✅ | Category |
| basePrice | number | ✅ | Base price |
| durationMinutes | number | — | Estimated duration |

**Responses:**
- `201` — Created service
- `403` — Admin only

---

### PUT /api/services/:id
Update a service. *(admin only)*

**Auth:** admin

**Body:** `name`, `basePrice`, `isActive` (all optional)

**Responses:**
- `200` — Updated service
- `404` — Not found

---

### DELETE /api/services/:id
Delete a service. *(admin only)*

**Auth:** admin

**Responses:**
- `204` — Deleted

---

## 4. Providers — `/api/providers`

### GET /api/providers
List available providers.

**Auth:** bearer

**Query params:**
| Param | Type | Description |
|---|---|---|
| serviceId | string | Filter by service |
| lat | number | User latitude |
| lng | number | User longitude |
| radius | number | Search radius (km) |

**Responses:**
- `200` — Array of providers with distance

---

### GET /api/providers/:id
Get provider profile.

**Auth:** bearer

**Responses:**
- `200` — Provider + portfolio + ratings

---

### PATCH /api/providers/me
Update provider profile.

**Auth:** provider

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| bio | string | — | About text |
| isAvailable | boolean | — | Availability toggle |
| serviceRadius | number | — | Service radius (km) |

**Responses:**
- `200` — Updated provider

---

### GET /api/providers/me/stats
Provider earnings and stats.

**Auth:** provider

**Query params:** `from` (date), `to` (date)

**Responses:**
- `200` — Stats object

---

## 5. Bookings — `/api/bookings`

### POST /api/bookings
Create a booking.

**Auth:** bearer

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| serviceId | string | ✅ | Service UUID |
| providerId | string | — | Specific provider (optional) |
| scheduledAt | datetime | ✅ | ISO 8601 datetime |
| address | object | ✅ | `{ lat, lng, line1 }` |
| notes | string | — | Special instructions |

**Responses:**
- `201` — Booking + provider match
- `400` — Validation error
- `422` — No providers available

---

### GET /api/bookings
List user bookings.

**Auth:** bearer

**Query params:** `status` (pending\|confirmed\|in_progress\|completed\|cancelled), `page`, `limit`

**Responses:**
- `200` — Paginated bookings

---

### GET /api/bookings/:id
Get booking details.

**Auth:** bearer

**Responses:**
- `200` — Full booking object
- `404` — Not found

---

### PATCH /api/bookings/:id/status
Update booking status (provider action).

**Auth:** provider

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| status | enum | ✅ | `confirmed` \| `in_progress` \| `completed` |
| note | string | — | Status note |

**Responses:**
- `200` — Updated booking

---

### POST /api/bookings/:id/cancel
Cancel a booking.

**Auth:** bearer

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| reason | string | — | Cancellation reason |

**Responses:**
- `200` — Cancellation + refund info
- `400` — Non-cancellable state

---

## 6. Payments — `/api/payments`

### POST /api/payments/intent
Create Stripe payment intent.

**Auth:** bearer

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| bookingId | string | ✅ | Booking to pay for |

**Responses:**
- `200` — `{ clientSecret, paymentIntentId }`
- `400` — Already paid

---

### GET /api/payments/history
User payment history.

**Auth:** bearer

**Query params:** `page`, `limit`

**Responses:**
- `200` — Paginated payments

---

### POST /api/payments/webhook
Stripe webhook receiver. *(internal)*

**Auth:** stripe-sig

**Responses:**
- `200` — Acknowledged

---

## 7. Wallet — `/api/wallet`

### GET /api/wallet
Get wallet balance.

**Auth:** bearer

**Responses:**
- `200` — `{ balance, currency }`

---

### GET /api/wallet/transactions
Transaction history.

**Auth:** bearer

**Query params:** `type` (credit\|debit), `page`

**Responses:**
- `200` — Paginated transactions

---

### POST /api/wallet/withdraw
Provider withdrawal request.

**Auth:** provider

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| amount | number | ✅ | Amount to withdraw |
| bankAccountId | string | ✅ | Linked bank account |

**Responses:**
- `200` — Withdrawal queued
- `400` — Insufficient balance

---

## 8. Subscriptions — `/api/subscriptions`

### GET /api/subscriptions/plans
List subscription plans.

**Auth:** public

**Responses:**
- `200` — Array of plans

---

### POST /api/subscriptions/subscribe
Subscribe to a plan.

**Auth:** bearer

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| planId | string | ✅ | Plan UUID |
| paymentMethodId | string | ✅ | Stripe PM ID |

**Responses:**
- `201` — Subscription object
- `409` — Already subscribed

---

### GET /api/subscriptions/me
Get current subscription.

**Auth:** bearer

**Responses:**
- `200` — Subscription object or `null`

---

### DELETE /api/subscriptions/me
Cancel subscription.

**Auth:** bearer

**Responses:**
- `200` — `{ cancellationDate }`

---

## 9. Ratings — `/api/ratings`

### POST /api/ratings
Submit rating for a completed booking.

**Auth:** bearer

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| bookingId | string | ✅ | Completed booking UUID |
| rating | number | ✅ | 1–5 |
| review | string | — | Text review |
| tags | array | — | String tags |

**Responses:**
- `201` — Rating created
- `409` — Already rated

---

### GET /api/ratings/provider/:id
Get provider ratings.

**Auth:** public

**Query params:** `page`, `limit`

**Responses:**
- `200` — Paginated ratings + average score

---

## 10. Tracking — `/api/tracking`

### POST /api/tracking/start
Start a tracking session.

**Auth:** provider

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| bookingId | string | ✅ | Active booking UUID |

**Responses:**
- `201` — `{ sessionId }`

---

### PATCH /api/tracking/:sessionId/location
Update provider GPS location.

**Auth:** provider

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| lat | number | ✅ | Latitude |
| lng | number | ✅ | Longitude |
| accuracy | number | — | Accuracy in meters |

**Responses:**
- `200` — Logged

---

### GET /api/tracking/:sessionId
Get tracking session.

**Auth:** bearer

**Responses:**
- `200` — Session + last known location

---

### POST /api/tracking/:sessionId/end
End tracking session.

**Auth:** provider

**Responses:**
- `200` — Session summary

---

## 11. GPS & Alerts — `/api/gps`

### GET /api/gps/logs/:bookingId
GPS log for a booking.

**Auth:** bearer

**Responses:**
- `200` — Array of GPS points

---

### GET /api/gps/alerts
Provider GPS alerts.

**Auth:** provider

**Query params:** `resolved` (boolean)

**Responses:**
- `200` — Array of alerts

---

### PATCH /api/gps/alerts/:id/resolve
Resolve a GPS alert.

**Auth:** provider

**Responses:**
- `200` — Alert resolved

---

## 12. KYC — `/api/kyc`

### POST /api/kyc/initiate
Start KYC verification via DigiLocker.

**Auth:** provider

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| aadhaarNumber | string | — | Optional pre-fill |
| panNumber | string | — | Optional pre-fill |

**Responses:**
- `200` — `{ redirectUrl }`
- `409` — Already verified

---

### GET /api/kyc/status
Get KYC verification status.

**Auth:** provider

**Responses:**
- `200` — `{ status: "pending" | "verified" | "rejected" }`

---

### POST /api/kyc/callback
DigiLocker webhook. *(internal)*

**Auth:** digilocker-sig

**Responses:**
- `200` — Acknowledged

---

### GET /api/kyc/documents
List KYC documents.

**Auth:** provider

**Responses:**
- `200` — Array of document metadata

---

## 13. Recommendations — `/api/recommendations`

### GET /api/recommendations
Personalized service recommendations.

**Auth:** bearer

**Query params:** `limit`

**Responses:**
- `200` — Array of recommendations

---

### POST /api/recommendations/feedback
Rate a recommendation.

**Auth:** bearer

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| recommendationId | string | ✅ | |
| action | enum | ✅ | `clicked` \| `booked` \| `dismissed` |

**Responses:**
- `200` — Feedback recorded

---

## 14. Referrals — `/api/referrals`

### GET /api/referrals/my-code
Get user referral code.

**Auth:** bearer

**Responses:**
- `200` — `{ code, shareUrl }`

---

### POST /api/referrals/apply
Apply a referral code.

**Auth:** bearer

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| code | string | ✅ | Referral code |

**Responses:**
- `200` — Reward applied
- `400` — Invalid or expired
- `409` — Already used

---

### GET /api/referrals/history
Referral earnings history.

**Auth:** bearer

**Responses:**
- `200` — Array of referral events

---

## 15. Offers — `/api/offers`

### GET /api/offers
List active offers.

**Auth:** public

**Query params:** `serviceId`

**Responses:**
- `200` — Array of offers

---

### POST /api/offers/validate
Validate a coupon code.

**Auth:** bearer

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| code | string | ✅ | Coupon code |
| bookingId | string | ✅ | Target booking |

**Responses:**
- `200` — `{ discountAmount, discountType }`
- `400` — Invalid or expired

---

## 16. Portfolio — `/api/portfolio`

### GET /api/portfolio/:providerId
Get provider portfolio.

**Auth:** public

**Responses:**
- `200` — Array of portfolio entries

---

### POST /api/portfolio
Add portfolio item.

**Auth:** provider

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| title | string | ✅ | Item title |
| imageUrl | string | ✅ | S3 URL |
| description | string | — | Description |

**Responses:**
- `201` — Portfolio item created

---

### DELETE /api/portfolio/:id
Remove portfolio item.

**Auth:** provider

**Responses:**
- `204` — Deleted

---

## 17. Service Reports — `/api/service-reports`

### POST /api/service-reports
Submit service report.

**Auth:** provider

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| bookingId | string | ✅ | Booking UUID |
| workDone | string | ✅ | Description of work |
| materials | array | — | Materials used |
| photos | array | — | S3 URLs |

**Responses:**
- `201` — Report created

---

### GET /api/service-reports/:bookingId
Get report for a booking.

**Auth:** bearer

**Responses:**
- `200` — Report object
- `404` — Not found

---

## 18. Uploads — `/api/upload`

### POST /api/upload/presigned
Get S3 presigned upload URL.

**Auth:** bearer

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| filename | string | ✅ | Original filename |
| contentType | string | ✅ | MIME type |
| purpose | enum | ✅ | `avatar` \| `portfolio` \| `document` \| `report` |

**Responses:**
- `200` — `{ uploadUrl, fileKey }`

---

## 19. Notifications — `/api/notifications`

### GET /api/notifications
List user notifications.

**Auth:** bearer

**Query params:** `read` (boolean), `page`

**Responses:**
- `200` — Paginated notifications

---

### PATCH /api/notifications/:id/read
Mark notification as read.

**Auth:** bearer

**Responses:**
- `200` — Updated

---

### POST /api/notifications/schedule
Schedule a notification. *(admin only)*

**Auth:** admin

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| userId | string | ✅ | Target user UUID |
| title | string | ✅ | Notification title |
| body | string | ✅ | Notification body |
| scheduledAt | datetime | ✅ | ISO 8601 datetime |

**Responses:**
- `201` — Scheduled notification

---

## 20. Admin — `/api/admin`

### GET /api/admin/dashboard
Platform overview stats.

**Auth:** admin

**Responses:**
- `200` — Stats snapshot

---

### GET /api/admin/users
List all users.

**Auth:** admin

**Query params:** `role` (user\|provider\|admin), `page`, `search`

**Responses:**
- `200` — Paginated users

---

### PATCH /api/admin/users/:id/block
Block or unblock a user.

**Auth:** admin

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| blocked | boolean | ✅ | Block state |

**Responses:**
- `200` — Updated

---

### GET /api/admin/bookings
All bookings with filters.

**Auth:** admin

**Query params:** `status`, `from` (date), `to` (date)

**Responses:**
- `200` — Paginated bookings

---

### GET /api/admin/kyc/pending
KYC pending review list.

**Auth:** admin

**Responses:**
- `200` — Array of pending verifications

---

### PATCH /api/admin/kyc/:id
Approve or reject KYC.

**Auth:** admin

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| status | enum | ✅ | `verified` \| `rejected` |
| reason | string | — | Rejection reason |

**Responses:**
- `200` — Updated KYC record

---

### POST /api/admin/settings
Update platform settings.

**Auth:** admin

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| key | string | ✅ | Setting key |
| value | any | ✅ | Setting value |

**Responses:**
- `200` — Updated setting

---

## WebSocket Events

Connect to: `wss://your-domain.com` with `Authorization` header.

| Event (server → client) | Payload | Description |
|---|---|---|
| `booking:status_changed` | `{ bookingId, status }` | Booking state update |
| `provider:location_updated` | `{ bookingId, lat, lng }` | Live provider location |
| `gps:alert` | `{ alertId, type, bookingId }` | GPS geofence alert |
| `call:incoming` | `{ bookingId, callerId }` | Incoming auto-call |
| `notification:new` | `{ notificationId, title }` | Push notification |

---

## Error Format

All errors follow this shape:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human readable message",
    "details": {}
  }
}
```

Common error codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `UNPROCESSABLE`, `INTERNAL_ERROR`
