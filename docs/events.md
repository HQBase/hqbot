# Start work from incoming events

Open **Automations**, add a routine, and choose **When an event arrives**. Write the task, save it,
then use **Add trigger**. Choose your service. Each trigger has its own URL and signing key.
Copy the key before closing the setup window. List views never show saved keys.

## GitHub

Enter the repository as `owner/repository`. An optional action, such as `opened`, filters the
payload's action field. In the repository webhook settings, enter the trigger URL, select JSON,
and enter the generated signing key as the webhook secret. Select only the events you want.
Follow [GitHub's setup guide](https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks).

HQBot verifies `X-Hub-Signature-256` against the original body. It uses the signed body hash for
replay detection because the delivery header is not signed. GitHub does not sign a request
timestamp. Receipts remain until you delete the trigger. Identical signed payloads run once.
See [GitHub signature validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

## Slack

Enter your Slack workspace ID, channel ID, and app signing secret. In the Slack app's Event
Subscriptions, enter the trigger URL. HQBot answers signed URL verification requests. Subscribe
to `app_mention` or the message event for your selected channel. Install the app with the required
Slack scopes and add it to that channel. Use a dedicated app for a separate deployment.

HQBot accepts human messages and mentions in the selected workspace and channel. It ignores bot
messages, edits, and other event types. It checks Slack's signature and five-minute timestamp
window, then keeps the signed event ID. See the [Slack Events API](https://docs.slack.dev/apis/events-api/)
and [request verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/).

## Generic webhooks

The JSON body may include a `type` field. Set the optional event type filter to accept only that
value. The sender must make a unique delivery ID for each event and keep it for retries.

1. Read the current Unix timestamp in seconds.
2. Compute HMAC SHA-256, using the signing key, over the UTF-8 bytes of
   `v1:<timestamp>:<delivery-id>:<raw-json-body>`.
3. POST the same body bytes to the trigger URL. Send `X-HQBot-Timestamp`, `X-HQBot-Delivery`, and
   `X-HQBot-Signature: sha256=<lowercase-hex-digest>`.

Delivery IDs use letters, numbers, dots, underscores, and hyphens, up to 160 characters. Timestamps
must be within five minutes of the server time. On a later retry, sign again with a current
timestamp and the same delivery ID and body. A successful duplicate response does not repeat work.

## Check and maintain a trigger

Use **Recent deliveries** to see accepted and ignored events. The routine's run history shows the
queued work and result. A valid signature does not grant new tool permissions. The teammate's
current budget and action rules still apply. Incoming content is treated as untrusted task data.

Requests are limited to 64 KiB. At most 20 runs can wait for one teammate. A full queue returns
HTTP 503 with a retry delay. A trigger retains up to 100,000 compact receipts. At that limit,
replace it with a new trigger and a new signing key. Do not reuse the old key.

To rotate a key, edit the trigger and enter a new signing key, then update the sender. Requests
with the old key stop working. Pause or delete a trigger to stop its URL. Pause a routine to stop
new automatic runs; manual tests remain available. Stop the teammate to cancel accepted work.
