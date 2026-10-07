# Ponytail for OpenCode V2

Local adapter for `@dietrichgebert/ponytail@4.10.0`, whose published entrypoint
uses the V1 plugin API. Uses the upstream instruction builder, command templates,
and six bundled skills. Tested with OpenCode 2.0.16.

## Setup

```sh
npm ci --ignore-scripts --prefix ~/.config/opencode/integrations/ponytail
```

The global `opencode.jsonc` enables `./integrations/ponytail` under `plugins`.
No API keys or additional services are needed. Config changes reload automatically.

## Usage

- `/ponytail` reports the current mode without changing it.
- `/ponytail lite|full|ultra|off` switches the global mode immediately.
- `/ponytail-help` shows the command reference.
- `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`, and `/ponytail-gain`
  submit the upstream command templates to the current session.
- `stop ponytail` and `normal mode`, as standalone prompts, disable injection.

Rules are injected on every agent model request, including subagent sessions.
Skills are registered for explicit use, with automatic invocation disabled so
they don't override the selected intensity or reactivate an `off` mode.

Mode is shared across projects and survives sessions/reloads in
`~/.config/opencode/.ponytail-active` (`XDG_CONFIG_HOME` is respected).
Without a saved mode, Ponytail uses `PONYTAIL_DEFAULT_MODE`, then
`~/.config/ponytail/config.json`'s `defaultMode`, then `full`.
Use `/ponytail full` to resume after turning it off.

## Verification and updates

```sh
npm test --prefix ~/.config/opencode/integrations/ponytail
opencode plugin list
```

Dependencies are pinned in this adapter's package and lock files. Updates are
manual: update the pinned versions, reinstall, run the test, and verify loading.
Once upstream ships V2 support, replace the local plugin entry with the upstream
package and remove this adapter.
