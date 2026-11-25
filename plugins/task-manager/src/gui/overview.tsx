import type { Context } from "@opencode/plugin/gui"
import { For, Show, type JSX } from "solid-js"
import type { HistoryPoint, Snapshot } from "../types"
import { bytes, duration, minutes, pct, powerLine, powerSource, pressureLabel, rate } from "./format"
import { Spark } from "./spark"

function Card(props: { title: string; badge?: JSX.Element; error?: string; children?: JSX.Element }) {
  return (
    <section class="tm-card">
      <header class="tm-card-head">
        <span class="tm-card-title">{props.title}</span>
        <span class="tm-spacer" />
        {props.badge}
      </header>
      <Show when={props.error}>{(message) => <div class="tm-soft-error">{message()}</div>}</Show>
      {props.children}
    </section>
  )
}

function Stat(props: { label: string; value: string }) {
  return (
    <div class="tm-stat">
      <span class="tm-faint tm-xsmall">{props.label}</span>
      <span class="tm-mono tm-nowrap">{props.value}</span>
    </div>
  )
}

function Segments(props: { parts: { label: string; value: number; class: string }[]; total: number }) {
  return (
    <>
      <div class="tm-bar">
        <For each={props.parts}>
          {(p) => <div class={`tm-bar-seg ${p.class}`} style={{ width: `${Math.min(100, (p.value / props.total) * 100)}%` }} />}
        </For>
      </div>
      <div class="tm-legend">
        <For each={props.parts}>
          {(p) => (
            <span class="tm-legend-item tm-xsmall tm-muted">
              <i class={`tm-dot ${p.class}`} />
              {p.label} {bytes(p.value)}
            </span>
          )}
        </For>
      </div>
    </>
  )
}

export function Overview(props: { ctx: Context; snapshot: Snapshot | undefined; history: HistoryPoint[]; error: unknown; message: string }) {
  const ui = props.ctx.ui
  const s = () => props.snapshot
  const errors = () => s()?.errors ?? {}
  const times = () => props.history.map((p) => p.t)

  return (
    <div class="tm-content">
      <Show when={props.error}>
        <div class="tm-empty tm-error">
          <ui.Icon name="circle-exclamation" />
          <span>{props.message}</span>
        </div>
      </Show>
      <Show when={s()} fallback={<Show when={!props.error}><div class="tm-empty tm-muted">Loading…</div></Show>}>
        {(snap) => (
          <>
            <div class="tm-host tm-small tm-muted">
              <span class="tm-strong">{snap().host.chip ?? snap().host.model ?? snap().host.hostname}</span>
              <Show when={snap().host.chip && snap().host.model}>
                <span>{snap().host.model}</span>
              </Show>
              <span>{snap().host.osVersion}</span>
              <span>{snap().host.cores} cores</span>
              <span>up {duration(snap().host.uptime)}</span>
            </div>

            <div class="tm-grid">
              <Card title="CPU" error={errors().cpu} badge={<Show when={snap().cpu}>{(c) => <span class="tm-big">{pct(c().total, 0)}</span>}</Show>}>
                <Show when={snap().cpu}>
                  {(cpu) => (
                    <>
                      <Spark label="CPU history" times={times()} max={100} lines={[{ values: props.history.map((p) => p.cpu), class: "tm-c-cpu" }]} />
                      <div class="tm-stats">
                        <Stat label="User" value={pct(cpu().user, 1)} />
                        <Stat label="System" value={pct(cpu().system, 1)} />
                        <Stat label="Load 1/5/15" value={cpu().load.map((l) => l.toFixed(2)).join(" ")} />
                      </div>
                      <div class="tm-cores" title="Per-core usage">
                        <For each={cpu().perCore}>
                          {(core, i) => (
                            <div class="tm-core" title={`Core ${i() + 1}: ${pct(core)}`}>
                              <div class="tm-core-fill" style={{ height: `${Math.min(100, Math.max(0, core))}%` }} />
                            </div>
                          )}
                        </For>
                      </div>
                    </>
                  )}
                </Show>
              </Card>

              <Card
                title="Memory"
                error={errors().memory}
                badge={
                  <Show when={snap().memory}>
                    {(m) => (
                      <span class={`tm-badge tm-badge-${pressureLabel(m().pressure)}`}>Pressure: {pressureLabel(m().pressure)}</span>
                    )}
                  </Show>
                }
              >
                <Show when={snap().memory}>
                  {(mem) => (
                    <>
                      <div class="tm-row">
                        <span class="tm-big">{bytes(mem().used)}</span>
                        <span class="tm-muted tm-small">of {bytes(mem().total)}</span>
                      </div>
                      <Segments
                        total={mem().total}
                        parts={[
                          { label: "App", value: mem().app, class: "tm-s1" },
                          { label: "Wired", value: mem().wired, class: "tm-s2" },
                          { label: "Compressed", value: mem().compressed, class: "tm-s3" },
                          { label: "Cached", value: mem().cached, class: "tm-s4" },
                        ]}
                      />
                      <Spark
                        label="Memory history"
                        times={times()}
                        max={mem().total}
                        lines={[{ values: props.history.map((p) => p.memUsed), class: "tm-c-mem" }]}
                      />
                      <div class="tm-stats">
                        <Stat label="Swap used" value={mem().swapTotal > 0 ? `${bytes(mem().swapUsed)} / ${bytes(mem().swapTotal)}` : bytes(mem().swapUsed)} />
                        <Stat label="Free" value={bytes(mem().free)} />
                      </div>
                    </>
                  )}
                </Show>
              </Card>

              <Show when={snap().gpu || errors().gpu}>
                <Card
                  title="GPU"
                  error={errors().gpu}
                  badge={<Show when={snap().gpu}>{(g) => <span class="tm-big">{pct(g().utilization, 0)}</span>}</Show>}
                >
                  <Show when={snap().gpu}>
                    {(gpu) => (
                      <>
                        <div class="tm-muted tm-small">
                          {gpu().name ?? "GPU"}
                          <Show when={gpu().cores}> · {gpu().cores} cores</Show>
                        </div>
                        <Spark label="GPU history" times={times()} max={100} lines={[{ values: props.history.map((p) => p.gpu), class: "tm-c-gpu" }]} />
                        <div class="tm-stats">
                          <Show when={gpu().memoryInUse !== undefined}>
                            <Stat label="Memory in use" value={bytes(gpu().memoryInUse)} />
                          </Show>
                          <Show when={gpu().renderer !== undefined}>
                            <Stat label="Renderer" value={pct(gpu().renderer)} />
                          </Show>
                          <Show when={gpu().tiler !== undefined}>
                            <Stat label="Tiler" value={pct(gpu().tiler)} />
                          </Show>
                        </div>
                      </>
                    )}
                  </Show>
                </Card>
              </Show>

              <Card title="Network" error={errors().network}>
                <Show when={snap().network}>
                  {(net) => (
                    <>
                      <div class="tm-row tm-wrap">
                        <span class="tm-mono tm-rx">↓ {rate(net().rxRate)}</span>
                        <span class="tm-mono tm-tx">↑ {rate(net().txRate)}</span>
                      </div>
                      <Spark
                        label="Network history"
                        times={times()}
                        lines={[
                          { values: props.history.map((p) => p.netRx), class: "tm-c-rx" },
                          { values: props.history.map((p) => p.netTx), class: "tm-c-tx" },
                        ]}
                      />
                      <div class="tm-stats">
                        <Stat label="Received" value={bytes(net().rxTotal)} />
                        <Stat label="Sent" value={bytes(net().txTotal)} />
                      </div>
                    </>
                  )}
                </Show>
              </Card>

              <Card title="Disk" error={errors().disks}>
                <Show when={snap().disks?.length}>
                  <div class="tm-disks">
                    <For each={snap().disks}>
                      {(disk) => (
                        <div class="tm-disk">
                          <div class="tm-row">
                            <span class="tm-ellipsis tm-small" title={disk.mount}>{disk.mount}</span>
                            <span class="tm-spacer" />
                            <span class="tm-muted tm-xsmall tm-nowrap">
                              {bytes(disk.used)} used · {bytes(disk.free)} free
                            </span>
                          </div>
                          <div class="tm-bar">
                            <div
                              class={`tm-bar-seg ${disk.used / disk.total > 0.9 ? "tm-s-danger" : "tm-s1"}`}
                              style={{ width: `${Math.min(100, (disk.used / disk.total) * 100)}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </Card>

              <Card title="Power" error={errors().power}>
                <Show when={snap().power}>
                  {(power) => (
                    <>
                      <Show when={power().hasBattery}>
                        <div class="tm-row">
                          <span class="tm-big">{pct(power().battery)}</span>
                          <span
                            class={`tm-small ${powerLine(power()).warn ? "tm-power-warn" : "tm-muted"}`}
                            title={powerLine(power()).hint}
                          >
                            {powerLine(power()).text}
                          </span>
                        </div>
                        <div class="tm-bar">
                          <div
                            class={`tm-bar-seg ${
                              powerLine(power()).warn || ((power().battery ?? 100) <= 20 && power().state !== "charging")
                                ? "tm-s-danger"
                                : "tm-s-success"
                            }`}
                            style={{ width: `${Math.min(100, power().battery ?? 0)}%` }}
                          />
                        </div>
                        <Show when={powerLine(power()).warn && powerLine(power()).hint}>
                          <div class="tm-power-warn tm-xsmall">{powerLine(power()).hint}</div>
                        </Show>
                      </Show>
                      <div class="tm-stats">
                        <Stat label="Source" value={powerSource(power())} />
                        <Show when={power().adapter}>
                          {(adapter) => (
                            <Stat
                              label="Adapter"
                              value={adapter().name ? `${adapter().name} \u00b7 ${adapter().watts} W` : `${adapter().watts} W`}
                            />
                          )}
                        </Show>
                        <Show when={power().systemPowerW !== undefined}>
                          <Stat label="System draw" value={`${power().systemPowerW!.toFixed(1)} W`} />
                        </Show>
                        <Show when={power().hasBattery && power().timeRemainingMin !== undefined}>
                          <Stat label={power().state === "charging" ? "Until full" : "Remaining"} value={minutes(power().timeRemainingMin)} />
                        </Show>
                        <Show when={power().health}>
                          {(health) => (
                            <>
                              <Stat label="Cycles" value={String(health().cycleCount)} />
                              <Stat
                                label="Health"
                                value={`${health().healthPercent.toFixed(0)}% \u00b7 ${health().maxCapacity}/${health().designCapacity} mAh`}
                              />
                            </>
                          )}
                        </Show>
                        <Show when={power().temperatureC !== undefined}>
                          <Stat label="Temperature" value={`${power().temperatureC!.toFixed(1)} \u00b0C`} />
                        </Show>
                        <Stat label="Thermal" value={power().thermalLevel === "warning" ? "Throttling" : "Nominal"} />
                        <Show when={power().cpuSpeedLimit !== undefined && power().cpuSpeedLimit! < 100}>
                          <Stat label="CPU limit" value={pct(power().cpuSpeedLimit)} />
                        </Show>
                      </div>
                    </>
                  )}
                </Show>
              </Card>
            </div>
          </>
        )}
      </Show>
    </div>
  )
}
