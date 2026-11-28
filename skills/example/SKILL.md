---
name: example
description: Placeholder skill shipped with the scaffold; replace this folder and its SKILL.md with your own operational guidance.
---

# Example skill

This skill is a placeholder. It ships with the `oc-template` scaffold so a copied
server has a working, hashed, multi-file skill out of the box. Replace its body
with the operational guidance your server's users need.

## What a skill is here

A skill is a directory under `skills/`. Its `SKILL.md` opens with YAML
frontmatter whose `name` equals the folder name and whose `description` is one to
1024 characters. The server walks that directory, hashes every file with
SHA-256, and serves the set through `skills/list`, `skills/get`, and
`resources/read`.

A skill is not a tool. It is documentation and supporting files that a client
loads on demand, after the user approves it. The server only transports bytes;
it does not execute anything in the skill folder.

## Naming rule

The folder name MUST equal the frontmatter `name`. The server refuses a skill
whose names disagree, so renaming a folder means updating `name` in the same
edit. Names are one to 64 characters of lowercase letters, digits, and single
hyphens.

## Resources

Every file in the folder becomes a resource entry with a `sha256:` digest and a
byte size, sorted by URI. Supporting files such as
[references/checklist.md](references/checklist.md) are part of the same digest
set. Keep the folder self-contained: no paths outside it, no symlinks that
escape it.

The list is complete: a file that exists on disk but is absent from the
entry is treated by clients as a verification failure. Add or remove files only
through a server restart after editing.

## Replacing this skill

1. Rename the folder and set `name` to match.
2. Rewrite this body with the server's own guidance.
3. Add or remove supporting files; the server rehashes them on startup.
4. Run `npm run check` to confirm the digests and tests still pass.

## Verification

`SKILL.md` must start with `---\n` and carry no BOM. Every resource must stay
inside the skill folder. The suite walks whatever skills are served and checks
each entry's URI, frontmatter, sorted resources, digests, and sizes.

The scaffold's identity lives in `src/identity.ts` only; skill content is not
identity.
