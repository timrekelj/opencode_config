# devices

iOS simulators and Android emulators in an OpenCode Desktop side panel, the way T3 Code's Device panel works.

- **Devices tab**: every installed iOS simulator (`simctl`) and Android AVD (`emulator -list-avds` + `adb`), grouped
  by platform, running ones first, each Running / Stopped / Unavailable. Click a running device to open it, a
  stopped one to start it and then open it. The stop button powers a device off.
- **One tab per device**: the live screen, which you can tap, swipe and type into. Open several devices and switch
  between their tabs. The toolbar has All devices, Reload, Power off, Open in browser and DevTools.
- Commands: *Open devices*, *Open device…* (searchable picker), *Restart device hub*.

The server part runs [expo-device-hub](https://github.com/expo/expo-device-hub) (the same pinned version T3 Code
uses) on free loopback ports: one hub to boot and shut down devices, plus one per opened device, locked to it with
`--single-device`. A device's hub stops when the device stops; all of them stop with the server. The desktop main
process loads each device's hub page in an embedded view in its tab.

- iOS needs Xcode. Android needs the Android SDK (`~/Library/Android/sdk`, or `ANDROID_HOME`) and a JDK for
  `avdmanager`; Android Studio's bundled JDK is found automatically.
- The hub binds `127.0.0.1` only. serve-sim exposes a shell-exec route, so never pass `--host 0.0.0.0`.
- Open it from the session panel menu, or the *Open devices* command. *Restart device hub* restarts it.

## Development

```sh
bun install
bun run dev        # vite build --watch
bun run typecheck
```

The server part (`src/index.ts`, `src/hub.ts`) runs from source. Restart the service after changing it:
`opencode service restart`.

Options (in `opencode.json`), all optional:

```jsonc
{
  "plugins": [
    {
      "package": "/Users/timrekelj/.config/opencode/plugins/devices",
      "options": {
        "node": "/opt/homebrew/bin/node",
        "androidHome": "/Users/me/Library/Android/sdk",
        "javaHome": "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
        "args": ["--transport", "h264"]
      }
    }
  ]
}
```

`args` are passed to `expo-device-hub`; see `node node_modules/expo-device-hub/dist/server/cli.mjs --help`.
