/**
 * Single source of truth for this package's identity.
 *
 * Make a copy of this template your own by editing this file and the `name`,
 * `version` and `description` fields in `package.json`; `tests/identity.test.mjs`
 * fails if the two disagree.
 */
export const NAME = "oc-template"

export const VERSION = "0.2.0"

/** Slash command this plugin registers. */
export const COMMAND_NAME = "template-status"

/** Prefix for every storage key the plugin writes, so copies cannot collide. */
export const STORAGE_PREFIX = `${NAME}:`
