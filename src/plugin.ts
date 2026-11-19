import { Plugin } from "@opencode/plugin"

import { COMMAND_NAME, NAME, STORAGE_PREFIX, VERSION } from "./identity.js"

export const PLUGIN_ID = NAME
export const PLUGIN_VERSION = VERSION

const LAST_TOOL_KEY = `${STORAGE_PREFIX}last-tool`
const LAST_COMMAND_KEY = `${STORAGE_PREFIX}last-command`

async function registerStatusCommand(context: Plugin.Context): Promise<Plugin.Cleanup> {
  const registration = await context.command.transform((editor) => {
    editor.add({
      name: COMMAND_NAME,
      description: `Stamp the current time into plugin storage (${NAME} example).`,
      async execute() {
        await context.storage.set(LAST_COMMAND_KEY, new Date().toISOString())
      },
    })
  })
  return registration.dispose
}

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
