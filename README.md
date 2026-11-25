# User Data Export — Files and Columns

Every export is a zip of the CSV files below, in this order. All dates are UTC, formatted `YYYY-MM-DD HH:MM:SS`.

Input: `{ "userId": "<users.id>", "productId": "<products.id>" }`

| File                          | Product specific?                           |
| ----------------------------- | ------------------------------------------- |
| account.csv                   | No                                          |
| profiles.csv                  | Partially (only `aaa`)                      |
| login_history.csv             | Yes                                         |
| items.csv                     | No                                          |
| linked_accounts.csv           | Partially (only `aaa`)                      |
| friends.csv                   | Partially (all products except `aaa`)       |
| device_settings.csv           | No                                          |
| communication_preferences.csv | Yes                                         |
| game_library.csv              | Yes                                         |
| consents.csv                  | Yes                                         |
| subscription.csv              | Yes                                         |
| transactions.csv              | Partly: subscription rows yes, coin rows no |
| achievements.csv              | Partly: rules yes, current tier no          |
| game_sessions.csv             | Yes (legacy sessions count as `onmo`)       |
| wallets.csv                   | No                                          |

Which product gets `profiles.csv`, `linked_accounts.csv` and `friends.csv` is decided in one place: `HEADER_ONLY_FILES` in `lib/product-files.js`. When a file doesn't apply to the requested product, it's still in the zip with the header row only.

---

## account.csv

Source: MySQL `users`

| Column         | Description                                                              |
| -------------- | ------------------------------------------------------------------------ |
| username       | Account username                                                         |
| email          | Email address                                                            |
| phone_number   | Phone number                                                             |
| language       | Language as stored                                                       |
| avatar         | Avatar as stored                                                         |
| sign_in_method | `idp_name`; `Phone` if no IDP and a phone number is set; otherwise empty |
| created_on     | Account creation date                                                    |

## profiles.csv

Source: MySQL `profiles` (disabled profiles excluded)

Profiles are only supported by product `aaa`. For any other product the file contains the header row only.

| Column      | Description           |
| ----------- | --------------------- |
| name        | Profile username      |
| avatar      | Avatar as stored      |
| kid_profile | Yes / No              |
| locked      | Yes / No              |
| language    | Language as stored    |
| created_on  | Profile creation date |

## login_history.csv

Source: Redis (check-ins not yet synced) + MySQL `user_checkins`. Newest first.

| Column     | Description                                                  |
| ---------- | ------------------------------------------------------------ |
| ip_address | IP address                                                   |
| timestamp  | Check-in time (Redis rows use the user's last check-in time) |
| country    | Country as stored (empty for Redis rows)                     |
| user_agent | User agent text (empty for Redis rows)                       |
| device     | Device as stored (empty for Redis rows)                      |

## items.csv

Source: MySQL `item_transactions` (inventory wallet) + `inventory`. What the user owns now: one row per bundle and one per item (a bundle purchase writes a transaction for the bundle and one per item inside it). Items aren't linked back to their bundle; they share almost the same `acquired_on`. Newest first.

| Column      | Description                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------- |
| name        | Item or bundle title                                                                              |
| category    | Readable category (e.g. `Avatar`); `AVATAR BUNDLE` for avatar bundles; `Bundle` for other bundles |
| acquired_on | First time the item or bundle was granted                                                         |

## linked_accounts.csv

Source: EON API (`/rm/cda/checkuserlogin`), one call per non-disabled profile.

Only generated when `productId` is `aaa`. For any other product the file contains the header row only.

| Column       | Description                               |
| ------------ | ----------------------------------------- |
| profile_name | Profile username                          |
| service      | Always `Steam` for now                    |
| status       | `Linked`, `Not Linked`, or `Check Failed` |
| checked_at   | When the check was made                   |

> **Notes / limitations**
>
> - **Service is hardcoded to Steam.** Only Steam is checked, and `service` is always `Steam`. If new services need to be exported, the logic in `files/linked-accounts.js` needs to be updated.
> - **EON client ID is hardcoded per environment** (`eonClientIds` in `lib/config.js`: one client per environment). If one user is allowed to use EON with multiple clients, this export will not be valid and needs to be updated.

## friends.csv

Source: MySQL `user_followers` + `users`. Disabled users are included (the relationship is the requester's data); service users are excluded. People the user follows first, then followers not followed back; each newest first.

Product `aaa` does not support friends: for `aaa` the file contains the header row only.

| Column            | Description                                       |
| ----------------- | ------------------------------------------------- |
| username          | The other person's username                       |
| following         | Yes if the user follows them                      |
| mutual            | Yes if both follow each other                     |
| followed_date     | When the user followed them (empty if they don't) |
| followed_you_date | When they followed the user (empty if they don't) |

## device_settings.csv

Source: MySQL `user_metadata` (`preferred_eon_cluster`, `streaming_config`, `device_preferences`) + `devices`. Disabled profiles excluded.

| Column       | Description                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| profile_name | Filled for profile and device+profile settings; empty for device-only settings                                                    |
| device       | Make and model (raw signature if the device is unknown); empty for profile-only settings                                          |
| setting      | `Preferred Streaming Location`, `Streaming Quality Preset`, `Resolution`, `FPS`, `Bitrate`, `Adaptive Quality`, `Keyboard Layout` |
| value        | Setting value (no units)                                                                                                          |
| updated_on   | When the stored setting was last updated                                                                                          |

Scope by key: `preferred_eon_cluster` = profile; `streaming_config` = device; `device_preferences` = device + profile.

## communication_preferences.csv

Source: MySQL `user_metadata` (`notification_preferences`, account level) for the input product.

| Column                 | Description                                                  |
| ---------------------- | ------------------------------------------------------------ |
| channel                | e.g. `WhatsApp`                                              |
| category               | `Account`, `Updates`, `Engagement`                           |
| opted_in               | Yes / No (`Account` is always Yes)                           |
| changed_via            | `Settings` or `Prompt`                                       |
| last_updated_at        | When the category was last changed                           |
| times_prompt_dismissed | Opt-in prompt dismissals (per channel, repeated on each row) |
| last_dismissed_on      | Last prompt dismissal (per channel, repeated on each row)    |

## game_library.csv

Source: MySQL `user_game_library` + `games`. Non-disabled profiles; by profile, newest first.

| Column       | Description             |
| ------------ | ----------------------- |
| profile_name | Profile username        |
| game         | Game title              |
| added_on     | When the game was added |

## consents.csv

Source: Mongo `consents` + MySQL `documents`. Newest first.

| Column       | Description                                                         |
| ------------ | ------------------------------------------------------------------- |
| consented_on | When the consent was recorded                                       |
| category     | e.g. `Legal`, `Cookies`                                             |
| purpose      | e.g. `Privacy Policy`, `Age Declaration`                            |
| action       | e.g. `Accepted`, `Rejected`                                         |
| document_url | URL of the document version consented to, in the consent's language |
| shown_text   | Text shown to the user                                              |
| language     | Language as stored                                                  |
| source       | e.g. `Login`, `Cookie Banner`                                       |

## subscription.csv

Source: MySQL `user_subscription` + `subscription_plans` + `subscription_mandates`. Current subscription(s) only.

| Column               | Description                                                                |
| -------------------- | -------------------------------------------------------------------------- |
| plan_name            | Plan title in every language, e.g. `en: Essential Pass; es: Pase esencial` |
| status               | `Active`, `Pending`, `Expired`, `Cancelled`                                |
| subscribed_via       | `Voucher`, `Mandate`, `One-time`                                           |
| price                | Plan amount, 2 decimals                                                    |
| currency             | From the plan's metadata (e.g. `INR`)                                      |
| plan_duration_days   | Plan duration in days                                                      |
| current_period_start | Start of the current period                                                |
| current_period_end   | End of the current period                                                  |
| auto_renew           | Yes / No                                                                   |
| subscribed_on        | When the subscription was created                                          |
| payment_provider     | `Razorpay`, `Juspay`, `OnmoPay` (mandate subscriptions only)               |
| payment_method       | As stored, e.g. `upi` (mandate subscriptions only)                         |
| billing_frequency    | e.g. `Monthly` (mandate subscriptions only)                                |
| mandate_cancelled_on | When the mandate was cancelled (mandate subscriptions only)                |

## transactions.csv

Source: MySQL `item_transactions` (coin wallet, all products) + `payment_transactions` (input product). Merged, newest first.

| Column         | Coin rows                                                      | Subscription rows                                                                          |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| date           | Transaction date                                               | Payment date                                                                               |
| category       | `Coins`                                                        | `Subscription`                                                                             |
| type           | Readable transaction type (e.g. `Win`, `Expired`, `Inventory`) | `Autopay Activation`, `Autopay Renewal`, `One-time Purchase`, `Voucher Redemption`         |
| amount         | Coin amount (negative for debits)                              | Payment amount, 2 decimals                                                                 |
| currency       | Coin type (e.g. `Gems`)                                        | Plan currency (e.g. `INR`)                                                                 |
| status         | Always `Success`                                               | `Success`, `Failed`, `Pending`, `Cancelled`                                                |
| item           | Game title, or inventory item title for `Inventory` purchases  | Plan name (English)                                                                        |
| source         | `Onmopay` for subscription grants, otherwise empty             | Empty                                                                                      |
| paid_via       | Empty                                                          | Gateway (`Juspay`, `Razorpay`) or `Voucher`                                                |
| payment_method | Empty                                                          | From the mandate for autopay; `Voucher purchased offline` for vouchers; empty for one-time |
| invoice_number | Empty                                                          | Invoice ID                                                                                 |
| valid_until    | Empty                                                          | Subscription validity end                                                                  |

## achievements.csv

Source: Mongo `event_rules` + `event_data`, MySQL `item_buckets` (achievement wallet). Only achievements the user has progress or a tier in; sorted by name.

| Column           | Description                                                        |
| ---------------- | ------------------------------------------------------------------ |
| name             | From `achievementType`, e.g. `Time Played`                         |
| current_tier     | Sum of unexpired achievement buckets (not product specific)        |
| progress         | Stored progress total (0 if no record; empty if unknown/malformed) |
| progress_unit    | e.g. `Seconds`, `Wins`, `Days` (`Unknown` if unknown/malformed)    |
| next_tier_target | Threshold of the next tier; empty when at the top tier             |

Rule chosen per achievement: tenant + product, then tenant only, then product only, then generic; lowest rule id on ties.

## game_sessions.csv

Source: MySQL `game_sessions` + `game_plays` + `game_participants` (own row only) + `games` + `profiles` + `inventory`. All profiles; newest first. Legacy sessions with no game play count as product `onmo`.

| Column               | Description                                                                        |
| -------------------- | ---------------------------------------------------------------------------------- |
| started_at           | Session start                                                                      |
| last_updated_at      | Last update                                                                        |
| profile_name         | Profile that played (empty if the account has no profile row)                      |
| game                 | Game title                                                                         |
| game_mode            | e.g. `Casual Stream`, `House Battle`                                               |
| status               | `Not Started`, `Playing`, `Closed` (legacy `CHEATED`/`REVIEWED` shown as `Closed`) |
| close_reason         | `Manual`, `Expired` (cheat-detected closes shown empty)                            |
| duration_seconds     | Session duration                                                                   |
| score                | Session score                                                                      |
| result               | e.g. `Win`, `Loss`, `Pending`, `Closed`                                            |
| paid                 | Yes / No                                                                           |
| payment_mode         | e.g. `50 Basic`, `Subscription` (unknown shapes as raw JSON)                       |
| prizes               | e.g. `20 Gems`, item titles (unknown shapes as raw JSON)                           |
| device_make          | Device make                                                                        |
| device_model         | Device model                                                                       |
| device_type          | Device type                                                                        |
| device_os            | Device OS                                                                          |
| app_version          | App version                                                                        |
| ip_address           | Client IP                                                                          |
| city                 | Client city                                                                        |
| region               | Client region                                                                      |
| isp                  | Client ISP                                                                         |
| poor_network_seconds | Seconds of poor network                                                            |

## wallets.csv

Source: MySQL `item_buckets` (coin wallet). Current balances only; expired coins are in `transactions.csv` as `Expired`.

| Column     | Description                                      |
| ---------- | ------------------------------------------------ |
| coin_type  | e.g. `Gems`, `Spendable GZ Tokens`               |
| entry      | `Total balance`, `Does not expire`, or `Expires` |
| amount     | Amount for that entry                            |
| expires_at | Expiry date for `Expires` rows; empty otherwise  |

Per coin type: one `Total balance` row, a `Does not expire` row if above 0, and one `Expires` row per expiry date (soonest first). Total = does not expire + all expires rows.
