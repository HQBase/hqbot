# Device notifications and the installed web app

Open **Inbox**, expand **Device notifications**, and choose the types of update you want.
Select **Enable on this device**, then allow notifications in the browser prompt. Use **Send test
alert** to check delivery. It should arrive within one minute. Each device has its own name and
preferences. Disable an old device from the same panel.

Push can arrive while HQBot is closed. It contains a generic status, such as “Your input is
needed”, and opens this HQBot installation. It does not contain a conversation, task prompt,
result, credential, or file. The Inbox remains available when a push alert cannot be delivered.

HQBot generates its own VAPID signing key in the workspace Durable Object. It uses encrypted
standard Web Push with the browser's push service. There is no shared HQBot push relay. Apple,
Google, Mozilla, and Microsoft browser endpoints are supported. Keep workspace storage when
moving the deployment so existing device subscriptions retain their signing key.

The durable queue saves a record with each update. Delivery retries temporary errors at most six
times within one day. Invalid or expired subscriptions are removed. An unknown send result can
retry; the notification tag stays the same to replace a duplicate alert. “Push service accepted
the alert” confirms provider acceptance, not that the device displayed it or a person read it.
Device settings, battery limits, browser policy, and network state can affect delivery.

## Install HQBot

Use the browser's install action to add HQBot to your desktop or home screen. On iPhone and iPad,
use **Share → Add to Home Screen**, open that installed app, then enable notifications. This is
the [WebKit web app push model](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

The installed web app uses the same deployment and sign-in. It shows an offline page when there
is no connection. It does not cache chats, files, credentials, or API responses for offline use.
Your teammates can continue in Cloudflare while your device is offline.
