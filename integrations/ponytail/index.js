import { Plugin } from "@opencode/plugin";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
// Resolve the package without loading its incompatible V1 entrypoint.
const root = path.resolve(path.dirname(require.resolve("@dietrichgebert/ponytail")), "../..");
const { getPonytailInstructions } = require(path.join(root, "hooks/ponytail-instructions.js"));
const { getDefaultMode, normalizeMode, normalizePersistedMode, isDeactivationCommand } =
  require(path.join(root, "hooks/ponytail-config.js"));
const { parseCommandFile } = require(path.join(root, ".opencode/plugins/ponytail-frontmatter.cjs"));

const commands = readdirSync(path.join(root, ".opencode/command"))
  .filter((file) => file.endsWith(".md"))
  .map((file) => ({
    name: path.basename(file, ".md"),
    ...parseCommandFile(path.join(root, ".opencode/command", file)),
  }));
const skills = commands.map(({ name, description }) => {
  const file = path.join(root, "skills", name, "SKILL.md");
  return {
    id: name,
    name,
    description,
    path: file,
    content: parseCommandFile(file).template,
    // Mode injection is handled by the hook; skills remain explicitly available.
    autoinvoke: false,
  };
});

export default Plugin.define({
  id: "ponytail",
  async setup(ctx) {
    // Keep upstream's global mode file so settings survive reloads and projects.
    const statePath = path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"),
      "opencode", ".ponytail-active");
    const readMode = async () => {
      try {
        return normalizePersistedMode(await readFile(statePath, "utf8")) || getDefaultMode();
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return getDefaultMode();
      }
    };
    const writeMode = async (mode) => {
      await mkdir(path.dirname(statePath), { recursive: true });
      await writeFile(statePath, mode, "utf8");
    };
    const notice = (sessionID, text, delivery) => ctx.session.prompt({
      sessionID,
      text: `${text}\n\nDisplay this Ponytail status/reference concisely. Do not change the mode or call tools.`,
      delivery,
    });

    await ctx.session.hook("context", async (event) => {
      const mode = await readMode();
      if (mode !== "off") event.system.push({ type: "text", text: getPonytailInstructions(mode) });
    });
    await ctx.session.hook("prompt", async (event) => {
      if (isDeactivationCommand(event.prompt.text)) await writeMode("off");
    });
    await ctx.skill.transform((editor) => {
      skills.forEach((skill) => editor.add(skill));
    });
    await ctx.command.transform((editor) => {
      commands.forEach((command) => editor.add({
        name: command.name,
        description: command.description,
        async execute({ sessionID, prompt, delivery }) {
          if (command.name === "ponytail") {
            const argument = prompt.text.trim();
            if (argument) {
              const mode = normalizeMode(argument);
              if (!mode) throw new Error("Usage: /ponytail [lite|full|ultra|off]");
              await writeMode(mode);
            }
            await notice(sessionID, `Ponytail: ${await readMode()}. Mode applies globally until changed.`, delivery);
            return;
          }
          if (command.name === "ponytail-help") {
            await notice(sessionID, [
              `Ponytail: ${await readMode()}.`,
              "/ponytail — show the current mode",
              "/ponytail lite|full|ultra|off — set the global mode (persisted across sessions)",
              "/ponytail-review — review the current diff for over-engineering",
              "/ponytail-audit — audit the whole repository",
              "/ponytail-debt — list deferred ponytail: shortcuts",
              "/ponytail-gain — show the published benchmark scoreboard",
              '"stop ponytail" or "normal mode" — turn it off',
              'Default: full. Override with PONYTAIL_DEFAULT_MODE or ~/.config/ponytail/config.json.',
              'The saved mode takes precedence over the default. Resume with /ponytail full.',
            ].join("\n"), delivery);
            return;
          }
          await ctx.session.prompt({
            ...prompt,
            sessionID,
            // Keep user text first so attachment mention offsets remain valid.
            text: `${prompt.text}${prompt.text ? "\n\n" : ""}${command.template}`,
            delivery,
          });
        },
      }));
    });
  },
});
