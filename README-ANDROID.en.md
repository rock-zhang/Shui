# 📱 Shui — Android

The Android build ships as a standalone app. It shares the same drink data and business logic with the desktop build, while every native capability (alarm reminders, notifications, battery whitelist, system bars) is reimplemented. This document covers **how Android differs from desktop** and **the full production build flow for APK / AAB**.

- Project overview, desktop installation and release pipeline: [README.en.md](README.en.md)
- 中文版: [README-ANDROID.md](README-ANDROID.md)

---

## Android vs Desktop

The UI no longer carries desktop-comparison notes; the mapping and trade-offs are kept here for maintainers.

| Desktop | Android |
| --- | --- |
| Tray countdown | Today → "Reminder rhythm" card |
| Global hotkeys | "Log a drink" action on system notifications |
| Silent autostart | Alarms rebuilt after the boot broadcast |
| App whitelist / lock-screen auto-pause | Quiet hours + manual pause |
| In-app auto update | Play Store updates (in-app self-updates violate store policy) |
| Installed-app list | Not collected (sensitive permission) |

Unchanged: daily goal, reminder interval (minutes), repeat days, time range, full-screen reminders / system notifications / sound, drink logging and undo, trend and habit statistics, CSV export, JSON backup and import, appearance themes.

Background delivery depends on system alarms, notification permission and the battery-optimization whitelist; some vendor ROMs also require autostart / background-lock permission. See `src-tauri/gen/android/` for the native implementation.

**System bars**: the status bar and gesture navigation bar share the page background, with icon contrast inverted per theme. Colours come from the `background` token in `src/app/globals.css` (light `#ffffff` / dark `#020618`) and are declared in `res/values/colors.xml`. `values/themes.xml` and `values-night/themes.xml` cover the cold-start frame; at runtime the `set_system_bar_theme` command follows the resolved next-themes theme, which the user can set independently of the OS. `tests/system-bars.test.cjs` asserts that the CSS, Android colours and `themeColor` stay in sync.

**Reminder pipeline**: in the foreground a Rust timer thread raises the full-screen reminder; in the background a Kotlin `AlarmManager` exact alarm posts a system notification. Both paths read and write the same "last reminder time" ledger (`last_reminder_at.txt`), so once either one fires, the other stays quiet for the remainder of the interval — no double prompt (notification + full screen) when the app regains focus.

---

## Production Builds (APK / AAB)

Android is packaged separately: **AAB for Google Play, APK for sideloading and third-party stores**. The desktop release pipeline is unrelated — see [README.en.md](README.en.md), section "📦 Release Process".

`--debug` builds are for local testing only — unoptimized Rust, debug symbols kept (2–3× larger), and signed with the debug certificate, which Play rejects outright. Anything you hand out must be a release build.

### 1. One-time setup: create a release keystore

```shell
keytool -genkeypair -v \
  -keystore ~/.android-keys/shui-release.jks \
  -alias shui \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Shui, O=Shui, C=CN"
```

Keep `-validity` long enough to outlive the app — Google Play requires a signing certificate valid through at least 2033.

> ⚠️ **Lose this file and you can never update the published app again.** Back it up to a password manager and offline media, not just this machine.
> Strongly recommended: enable **Play App Signing** and treat this as the *upload key* — Google can reset it if it leaks or is lost.

Record the certificate fingerprint afterwards; you will need it to cross-check signatures in the Play console:

```shell
keytool -list -v -keystore ~/.android-keys/shui-release.jks -alias shui | grep SHA256
```

### 2. Configure signing (pick one)

**Option A: local file** (recommended for solo development)

Create `src-tauri/gen/android/key.properties` (already in `.gitignore`):

```properties
storeFile=/Users/you/.android-keys/shui-release.jks
storePassword=your-store-password
keyAlias=shui
keyPassword=your-key-password
```

An absolute path for `storeFile` is simplest; relative paths resolve against `src-tauri/gen/android/`.

**Option B: environment variables** (CI, or when nothing may touch disk)

| Variable | Meaning |
| --- | --- |
| `ANDROID_KEYSTORE_FILE` | absolute path to the keystore |
| `ANDROID_KEYSTORE_PASSWORD` | store password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

> Release signing activates only when all four are present. **Miss any one and it silently falls back to the debug certificate** — installs fine locally, rejected by Play. Always verify the signature (step 5).

Confirm Gradle picks up the certificate before you build, so a fallback does not surface at upload time:

```shell
cd src-tauri/gen/android && ./gradlew :app:signingReport | grep -A 4 Release
```

`Store` should point at your jks and `SHA-256` should match the fingerprint from step 1.

### 3. Bump the version

```shell
yarn release 0.3.0     # syncs 4 version files, commits, tags
```

Android's `versionCode` is **never written by hand**: it is derived from `version` in `tauri.conf.json` into `src-tauri/gen/android/app/tauri.properties` at build time (`major*1000000 + minor*1000 + patch`, so `0.2.32` → `2032`). That file is generated, git-ignored, and overwritten on every build. **As long as the version increases, versionCode increases** — Play's "version code must be higher than production" can't surprise you.

Never edit `tauri.properties` by hand (its header says it is generated and it is overwritten on every build).

### 4. Build

```shell
# AAB — for Google Play
yarn tauri android build --aab -t aarch64

# APK — sideloading / third-party stores / internal testing
yarn tauri android build --apk -t aarch64
```

- **Never pass `--apk` and `--aab` in the same command**: with Tauri CLI 2.x the second Gradle invocation waits on a socket that never opens and hangs forever. Run them as two separate commands.
- `-t` selects ABIs: `aarch64` (virtually all phones, the minimum), `armv7` (older devices), `x86_64` (emulators). Multiple values are space-separated: `-t aarch64 armv7`. Omit it to build all ABIs (much larger output).
- `--ci` is optional — non-interactive, no confirmation prompts.
- No manual frontend step: release builds run `beforeBuildCommand` (`yarn build`) automatically.

Output (a single-ABI build still lands in a `universal` container):

```
src-tauri/gen/android/app/build/outputs/
├── bundle/universalRelease/app-universal-release.aab   # for Play, ~11 MB
└── apk/universal/release/app-universal-release.apk     # for distribution, ~19 MB
```

### 5. Verify the signature (every production build)

```shell
# AAB: signing block present, not a debug certificate
unzip -l src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab \
  | grep -E 'META-INF/.*\.(RSA|DSA|EC|SF)'
keytool -printcert -jarfile src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab | head -3

# APK
$ANDROID_HOME/build-tools/34.0.0/apksigner verify --print-certs \
  src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk | head -3
```

If you see `CN=Android Debug`, it fell back to the debug certificate — revisit step 2.

### 6. Build in CI

[`.github/workflows/android-release.yml`](.github/workflows/android-release.yml) is triggered manually from the Actions tab; it takes artifact type (both / aab / apk) and ABI list as inputs.

Configure four secrets (mirroring step 2):

| Secret | How to produce it |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -i ~/.android-keys/shui-release.jks` (macOS) or `base64 -w0 shui-release.jks` (Linux) |
| `ANDROID_KEYSTORE_PASSWORD` | same store password |
| `ANDROID_KEY_ALIAS` | same key alias |
| `ANDROID_KEY_PASSWORD` | same key password |

CI decodes the keystore, verifies the AAB is not debug-signed, deletes the key file afterwards, and publishes the artifacts (kept 14 days).

### 7. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `next build` fails with `TypeError: Cannot read properties of undefined (reading 'length')` (`WasmHash._updateWithBuffer` in the stack) | Corrupted webpack cache. `rm -rf .next dist && mkdir -p dist` and rebuild. Note `distDir` here is `dist`, not the default `.next` |
| `beforeBuildCommand` `yarn build` fails with safe-delete / `ENOENT` | Node is wrapped by a filesystem shim (some agent/sandbox tools inject one). Prefix with `NODE_OPTIONS= yarn tauri android build ...` |
| Play rejects with "version code already used" | Version wasn't bumped, so versionCode didn't change. Run `yarn release <new-version>` |
| Play rejects with "not signed / invalid signature" | Fell back to debug signing — the four parameters in step 2 are incomplete |
| Build hangs with Gradle starting a second time | `--apk --aab` were passed together; split them |
| Package is unexpectedly large (30 MB+) | You built a debug package (`--debug`), or passed every ABI to `-t` |
| Installing a release build fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | A debug build is already installed; the signatures differ. Uninstall the old app first (in-app data is lost — harmless before launch) |

---

## Related documents

- [Data model and backup format](docs/data-backup.md)
- [Drink records design](docs/drink-records.md)
- [Hydration statistics](docs/hydration-statistics.md)
- [Silent autostart](docs/silent-autostart.md)
- [Themes](docs/themes.md)
