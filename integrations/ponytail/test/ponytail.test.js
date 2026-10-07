import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import plugin from "../index.js";

test("V2 registration, mode persistence, prompt injection, and command forwarding", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ponytail-test-"));
  const previous = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, PONYTAIL_DEFAULT_MODE: process.env.PONYTAIL_DEFAULT_MODE };
  process.env.XDG_CONFIG_HOME = directory;
  process.env.PONYTAIL_DEFAULT_MODE = "full";
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  });

  async function load() {
    const hooks = new Map();
    const commands = new Map();
    const skills = [];
    const prompts = [];
    await plugin.setup({
      session: {
        hook: async (name, fn) => hooks.set(name, fn),
        prompt: async (prompt) => prompts.push(prompt),
      },
      command: { transform: async (fn) => fn({ add: (command) => commands.set(command.name, command) }) },
      skill: { transform: async (fn) => fn({ add: (skill) => skills.push(skill) }) },
    });
    const run = (name, text = "", attachments = {}) => commands.get(name).execute({
      sessionID: "ses_test", prompt: { text, ...attachments }, delivery: "queue",
    });
    const context = async () => {
      const event = { system: [{ type: "text", text: "Existing instructions" }] };
      await hooks.get("context")(event);
      assert.equal(event.system[0].text, "Existing instructions");
      return event.system;
    };
    return { hooks, commands, skills, prompts, run, context };
  }

  const first = await load();
  assert.deepEqual([...first.commands.keys()].sort(), [
    "ponytail", "ponytail-audit", "ponytail-debt", "ponytail-gain", "ponytail-help", "ponytail-review",
  ]);
  assert.equal(first.skills.length, 6);
  for (const skill of first.skills) {
    assert.ok((await readFile(skill.path, "utf8")).includes(skill.content));
    assert.equal(skill.autoinvoke, false);
    assert.ok(!skill.content.startsWith("---"));
  }
  assert.match((await first.context())[1].text, /level: full/);

  for (const mode of ["lite", "ultra", "full", "off"]) {
    await first.run("ponytail", mode);
    const reloaded = await load();
    const system = await reloaded.context();
    if (mode === "off") assert.equal(system.length, 1);
    else assert.ok(system[1].text.includes(`level: ${mode}`));
    await reloaded.run("ponytail");
    assert.ok(reloaded.prompts.at(-1).text.includes(`Ponytail: ${mode}.`));
    assert.equal(reloaded.prompts.at(-1).delivery, "queue");
  }
  await assert.rejects(first.run("ponytail", "bogus"), /Usage:/);
  assert.equal((await first.context()).length, 1);
  await first.run("ponytail-help");
  assert.equal((await first.context()).length, 1);

  const files = [{ uri: "file:///example.js", mention: { start: 0, end: 11 } }];
  for (const name of ["ponytail-review", "ponytail-audit", "ponytail-debt", "ponytail-gain"]) {
    await first.run(name, "@example.js $&", { files });
    const forwarded = first.prompts.at(-1);
    assert.ok(forwarded.text.startsWith("@example.js $&\n\n"));
    assert.equal(forwarded.files, files);
    assert.equal(forwarded.delivery, "queue");
    assert.equal(forwarded.sessionID, "ses_test");
    assert.equal((await first.context()).length, 1);
  }
  await first.run("ponytail", "LITE");
  await first.hooks.get("prompt")({ prompt: { text: "add a normal mode toggle" } });
  assert.match((await first.context())[1].text, /level: lite/);
  await first.hooks.get("prompt")({ prompt: { text: "Stop ponytail!" } });
  assert.equal((await first.context()).length, 1);
});
