# User Data Export — Files and Columns

Every export is a zip of the CSV files below, in this order. All dates are UTC, formatted `YYYY-MM-DD HH:MM:SS`.

Input: `{ "userId": "<users.id>", "productId": "<products.id>" }`

Files, in zip order:

- account.csv
- profiles.csv
- login_history.csv
- items.csv
- linked_accounts.csv
- friends.csv
- device_settings.csv
- communication_preferences.csv
- game_library.csv
- consents.csv
- subscription.csv
- transactions.csv
- achievements.csv
- game_sessions.csv
- wallets.csv
- unread_notifications.csv

Nothing is filtered by product: data from every product is exported, and files that hold product-specific data have a `product` column.

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

| Column      | Description           |
| ----------- | --------------------- |
| name        | Profile username      |
| avatar      | Avatar as stored      |
| kid_profile | Yes / No              |
| locked      | Yes / No              |
| language    | Language as stored    |
| created_on  | Profile creation date |

## login_history.csv

Source: Redis (check-ins not yet synced, for every product in `products`) + MySQL `user_checkins`. All products, merged newest first.

| Column     | Description                                                                   |
| ---------- | ----------------------------------------------------------------------------- |
| product    | `Onmoplus` (aaa), `Onmo` (onmo), `Challenges Arena` (ca); other ids as stored |
| ip_address | IP address                                                                    |
| timestamp  | Check-in time (Redis rows use the user's last check-in time)                  |
| country    | Country as stored (empty for Redis rows)                                      |
| user_agent | User agent text (empty for Redis rows)                                        |
| device     | Device as stored (empty for Redis rows)                                       |

## items.csv

Source: MySQL `item_transactions` (inventory wallet) + `inventory`. What the user owns now: one row per bundle and one per item (a bundle purchase writes a transaction for the bundle and one per item inside it). Items aren't linked back to their bundle; they share almost the same `acquired_on`. Newest first.

| Column      | Description                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------- |
| name        | Item or bundle title                                                                              |
| category    | Readable category (e.g. `Avatar`); `AVATAR BUNDLE` for avatar bundles; `Bundle` for other bundles |
| acquired_on | First time the item or bundle was granted                                                         |

## linked_accounts.csv

Source: EON API (`/rm/cda/checkuserlogin`), one call per non-disabled profile.

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
| device       | Make and model (`Unknown device` if the device isn't found; raw signatures are never exported); empty for profile-only settings   |
| setting      | `Preferred Streaming Location`, `Streaming Quality Preset`, `Resolution`, `FPS`, `Bitrate`, `Adaptive Quality`, `Keyboard Layout` |
| value        | Setting value (no units)                                                                                                          |
| updated_on   | When the stored setting was last updated                                                                                          |

Scope by key: `preferred_eon_cluster` = profile; `streaming_config` = device; `device_preferences` = device + profile.

## communication_preferences.csv

Source: MySQL `user_metadata` (`notification_preferences`, account level). Every product section, with a `product` column.

- `Account` is on by default and isn't stored. Every channel shown gets an `Account, Yes, Default` row. `Onmoplus, WhatsApp, Account, Yes, Default` is always present, even when nothing is stored; other products only show channels that have stored data.
- Other categories appear only when stored; a category that isn't stored means the user isn't receiving it.

| Column                 | Description                                                                   |
| ---------------------- | ----------------------------------------------------------------------------- |
| product                | `Onmoplus` (aaa), `Onmo` (onmo), `Challenges Arena` (ca); other ids as stored |
| channel                | e.g. `WhatsApp`                                                               |
| category               | `Account`, `Updates`, `Engagement`                                            |
| opted_in               | Yes / No (`Account` is always Yes)                                            |
| changed_via            | `Settings` or `Prompt`; `Default` for the Account row                         |
| last_updated_at        | When the category was last changed (empty for the Account default)            |
| times_prompt_dismissed | Opt-in prompt dismissals (per channel, repeated on each row)                  |
| last_dismissed_on      | Last prompt dismissal (per channel, repeated on each row)                     |

## game_library.csv

Source: MySQL `user_game_library` + `games`. All products; non-disabled profiles; by product, then profile, newest first.

| Column       | Description                                                                   |
| ------------ | ----------------------------------------------------------------------------- |
| product      | `Onmoplus` (aaa), `Onmo` (onmo), `Challenges Arena` (ca); other ids as stored |
| profile_name | Profile username                                                              |
| game         | Game title                                                                    |
| added_on     | When the game was added                                                       |

## consents.csv

Source: Mongo `consents` + MySQL `documents`. All products, newest first.

| Column       | Description                                                                   |
| ------------ | ----------------------------------------------------------------------------- |
| product      | `Onmoplus` (aaa), `Onmo` (onmo), `Challenges Arena` (ca); other ids as stored |
| consented_on | When the consent was recorded                                                 |
| category     | e.g. `Legal`, `Cookies`                                                       |
| purpose      | e.g. `Privacy Policy`, `Age Declaration`                                      |
| action       | e.g. `Accepted`, `Rejected`                                                   |
| document_url | URL of the document version consented to, in the consent's language           |
| shown_text   | Text shown to the user                                                        |
| language     | Language as stored                                                            |
| source       | e.g. `Login`, `Cookie Banner`                                                 |

## subscription.csv

Source: MySQL `user_subscription` + `subscription_plans` + `subscription_mandates`. Current subscription(s) for every product.

| Column               | Description                                                                   |
| -------------------- | ----------------------------------------------------------------------------- |
| product              | `Onmoplus` (aaa), `Onmo` (onmo), `Challenges Arena` (ca); other ids as stored |
| plan_name            | Plan title in every language, e.g. `en: Essential Pass; es: Pase esencial`    |
| status               | `Active`, `Pending`, `Expired`, `Cancelled`                                   |
| subscribed_via       | `Voucher`, `Mandate`, `One-time`                                              |
| price                | Plan amount, 2 decimals                                                       |
| currency             | From the plan's metadata (e.g. `INR`)                                         |
| plan_duration_days   | Plan duration in days                                                         |
| current_period_start | Start of the current period                                                   |
| current_period_end   | End of the current period                                                     |
| auto_renew           | Yes / No                                                                      |
| subscribed_on        | When the subscription was created                                             |
| payment_provider     | `Razorpay`, `Juspay`, `OnmoPay` (mandate subscriptions only)                  |
| payment_method       | As stored, e.g. `upi` (mandate subscriptions only)                            |
| billing_frequency    | e.g. `Monthly` (mandate subscriptions only)                                   |
| mandate_cancelled_on | When the mandate was cancelled (mandate subscriptions only)                   |

## transactions.csv

Source: MySQL `item_transactions` (coin wallet) + `payment_transactions`, all products. Merged, newest first.

| Column         | Coin rows                                                      | Subscription rows                                                                          |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| product        | Empty                                                          | `Onmoplus` (aaa), `Onmo` (onmo), `Challenges Arena` (ca); other ids as stored              |
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

Source: Mongo `event_rules` (every achievement rule, active or inactive) + `event_data`, MySQL `item_buckets` (achievement wallet). Not product or tenant specific. One row per rule the user has a progress record for, plus one row per achievement the user holds a tier in without any progress record. Sorted by name, then product.

| Column           | Description                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| product          | The rule's product (`Onmoplus`, `Onmo`, `Challenges Arena`, other ids as stored); empty for generic rules and tier-only rows |
| name             | From `achievementType`, e.g. `Time Played`                                                                                   |
| current_tier     | Sum of unexpired achievement buckets for the type (shared by all rows of that type)                                          |
| progress         | Stored progress total (empty if unknown/malformed, and on tier-only rows)                                                    |
| progress_unit    | e.g. `Seconds`, `Wins`, `Days` (`Unknown` if unknown/malformed; empty on tier-only rows)                                     |
| next_tier_target | The rule's threshold at index `current_tier`; empty at the top tier and on tier-only rows                                    |

## game_sessions.csv

Source: MySQL `game_sessions` + `game_plays` + `game_participants` (own row only) + `games` + `profiles` + `inventory`. All products and profiles; newest first. Legacy sessions with no game play have an empty `product`.

| Column               | Description                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| product              | `Onmoplus` (aaa), `Onmo` (onmo), `Challenges Arena` (ca); other ids as stored; empty for legacy sessions |
| started_at           | Session start                                                                                            |
| last_updated_at      | Last update                                                                                              |
| profile_name         | Profile that played (empty if the account has no profile row)                                            |
| game                 | Game title                                                                                               |
| game_mode            | e.g. `Casual Stream`, `House Battle`                                                                     |
| status               | `Not Started`, `Playing`, `Closed` (legacy `CHEATED`/`REVIEWED` shown as `Closed`)                       |
| close_reason         | `Manual`, `Expired` (cheat-detected closes shown empty)                                                  |
| duration_seconds     | Session duration                                                                                         |
| score                | Session score                                                                                            |
| result               | e.g. `Win`, `Loss`, `Pending`, `Closed`                                                                  |
| paid                 | Yes / No                                                                                                 |
| payment_mode         | e.g. `50 Basic`, `Subscription` (unknown shapes as raw JSON)                                             |
| prizes               | e.g. `20 Gems`, item titles (unknown shapes as raw JSON)                                                 |
| device_make          | Device make                                                                                              |
| device_model         | Device model                                                                                             |
| device_type          | Device type                                                                                              |
| device_os            | Device OS                                                                                                |
| app_version          | App version                                                                                              |
| ip_address           | Client IP                                                                                                |
| city                 | Client city                                                                                              |
| region               | Client region                                                                                            |
| isp                  | Client ISP                                                                                               |
| poor_network_seconds | Seconds of poor network                                                                                  |

## wallets.csv

Source: MySQL `item_buckets` (coin wallet). Current balances only; expired coins are in `transactions.csv` as `Expired`.

| Column     | Description                                      |
| ---------- | ------------------------------------------------ |
| coin_type  | e.g. `Gems`, `Spendable GZ Tokens`               |
| entry      | `Total balance`, `Does not expire`, or `Expires` |
| amount     | Amount for that entry                            |
| expires_at | Expiry date for `Expires` rows; empty otherwise  |

Per coin type: one `Total balance` row, a `Does not expire` row if above 0, and one `Expires` row per expiry date (soonest first). Total = does not expire + all expires rows.

## unread_notifications.csv

Source: Mongo `event_data` (`rule_id = e3b3e7a1-60e6-44e5-9300-b14b9679115d`, `index_id = userId`, `data.notifications`) + MySQL `users`, `games`. Every stored notification is unread. Not filtered by product. Newest first.

| Column      | Description                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------- |
| received_at | When the notification was created                                                            |
| type        | Readable type, e.g. `Battle Invitation`, `Global Leaderboard Ended`                          |
| details     | One readable line, parts separated by `\|` (game title, other player's username, rank, etc.) |

Internal ids (match, tournament, leaderboard, flow), `earnedTags` and `isEndScreenReward` are not exported. Unknown or old types show the raw data in `details`.
