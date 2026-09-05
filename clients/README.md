# HQBot clients

The hosted web app is the main product. These small native apps connect to your own HTTPS HQBot
address. They contain no shared HQBot service, account, or JavaScript-to-native command bridge.
Sign in on the workspace page. The web app also supports browser installation with Add to Home
Screen or Install app.

## macOS and iOS

Install Xcode and select its command line tools. From the repository root:

```sh
python3 clients/apple/build.py macos
python3 clients/apple/build.py ios-simulator
```

The first command produces `clients/apple/build/macos/HQBot.app`. The second produces an iOS
Simulator app. Both receive a local ad hoc signature. They are not notarized or signed for App Store
distribution. Open the Mac app, choose **Workspace**, and enter your deployment's HTTPS address.

To run the iOS build, start a compatible simulator in Xcode, then use:

```sh
xcrun simctl install booted clients/apple/build/ios-simulator/HQBot.app
xcrun simctl launch booted com.hqbot.app
```

For a physical iPhone or App Store build, create an iOS App target in Xcode with deployment target
17.0 or later. Add the Swift source files in `clients/apple` to that target, remove the generated App
entrypoint, and choose your own bundle ID and signing team. Exclude the `tests` folder. For macOS,
use target 13.0 or later. The local command companion is not an App Sandbox target. Notarize a
Developer ID build before distributing it to other Mac users.

Run the local process tests without pairing a device:

```sh
xcrun swiftc -parse-as-library -swift-version 5 clients/apple/CommandProcess.swift clients/apple/tests/ProcessTests.swift -o /tmp/hqbot-process-tests
/tmp/hqbot-process-tests
```

## Local commands on a Mac

1. In the web app, open **Settings → Devices → Pair a computer**. Select teammates and create a code.
2. In the Mac app, open **Local access**, choose a working folder, and enter the code within ten minutes.
3. Ask a selected teammate to list its local devices and run a small command, such as `pwd`.
4. Review the complete command, workspace address, and working folder in the native dialog. Choose
   **Run once** or **Deny**. The result returns to the conversation.

The device token stays in Keychain. The process receives a small environment, a 60-second deadline,
and a 32 KB output limit. Its working folder is a starting location, **not a filesystem sandbox**.
An approved command runs with your Mac account and can access other files or services. Review it
with that authority in mind. Do not approve code you do not understand or trust.

Receipts are saved in `~/Library/Application Support/HQBot/local-receipts.json` with private file
permissions. Restart recovery sends a saved result or marks the outcome uncertain; it does not run
the command again. The companion must stay open to receive requests. Stop or device removal
cancels queued work. The running process checks for cancellation every two seconds, and stops if
that check fails. Removing a device while offline also requires removing it in web Settings.

## Android

Open `clients/android` in Android Studio with JDK 17 and Android SDK 35. Sync the pinned Android
Gradle plugin and use **Build APK**. Gradle 8.11.1 is compatible with the included plugin.

For a build with an existing SDK and no Gradle downloads:

```sh
python3 clients/android/build.py --java /path/to/jdk --platform /path/to/sdk/platforms/android-35 --tools /path/to/sdk/build-tools/35.0.0
```

The output is `clients/android/app/build/standalone/hqbot-debug.apk`. It uses a generated local debug
key. Install it on a test device with `adb install -r <apk-path>`. Use your own release key, current
Play requirements, and a signed release bundle before store publication. This repository does not
contain a production signing key.

## Client boundaries and checks

- Hosted work, approvals, projects, memory, routines, and Inbox use the same server and account.
- External HTTPS links open the system browser. The clients do not bypass TLS errors.
- Native apps support file selection and downloads. Android downloads are limited to 50 MB and
  same-origin HTTPS files; save generated Blob downloads in a normal browser.
- Push is currently **Web Push in a supported browser or installed web app**. These native shells
  do not register APNs or FCM device tokens. Use the hosted Inbox in a native client.
- Use a supported desktop browser to record demonstrations. Native web-view screen recording is
  not part of this client build.
- macOS and iOS Simulator compile checks and the Android APK build do not prove device UI behavior.
  Before release, test sign-in, reconnect, file upload/download, external OAuth, device rotation,
  screen reader labels, and safe-area layout on each target device.

Platform references: [Apple WKWebView](https://developer.apple.com/documentation/webkit/wkwebview/),
[Android WebView](https://developer.android.com/develop/ui/views/layout/webapps/webview), and
[Android Gradle compatibility](https://developer.android.com/build/releases/agp-8-9-0-release-notes).
