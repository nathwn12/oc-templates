/**
 * Minimal OpenCode v2 plugin entry.
 *
 * OpenCode loads the package default export and calls `setup` with its plugin
 * context, then calls the returned cleanup on unload. Everything a plugin can
 * touch hangs off that context (`command`, `tool`, `storage`, `session`, ...).
 */
import { Plugin } from "@opencode/plugin"

export const PLUGIN_ID = "oc-template"
export const PLUGIN_VERSION = "0.1.0"

const LAST_TOOL_KEY = "oc-template:last-tool"
const LAST_COMMAND_KEY = "oc-template:last-command"

/**
 * Example 1: register a slash command.
 * `transform` hands you an editor; register inside it and opencode reloads.
 */
async function registerStatusCommand(context: Plugin.Context): Promise<Plugin.Cleanup> {
  const registration = await context.command.transform((editor) => {
    editor.add({
      name: "template-status",
      description: "Stamp the current time into plugin storage (oc-template example).",
      async execute() {
        await context.storage.set(LAST_COMMAND_KEY, new Date().toISOString())
      },
    })
  })
  return registration.dispose
}

/**
 * Example 2: observe a runtime hook.
 * Same shape for every hook name the context exposes (`execute.before`,
 * `execute.after`, ...); the callback payload is typed by the hook name.
 */
async function registerToolObserver(context: Plugin.Context): Promise<Plugin.Cleanup> {
  const registration = await context.tool.hook("execute.before", async (input) => {
    await context.storage.set(LAST_TOOL_KEY, input.tool)
  })
  return registration.dispose
}

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(context): Promise<Plugin.Cleanup> {
    const cleanups = await Promise.all([
      registerStatusCommand(context),
      registerToolObserver(context),
    ])

    return async () => {
      for (const cleanup of cleanups) await cleanup()
    }
  },
})
