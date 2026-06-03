# nanobot Always Skills Notes

## What `always: true` Does

Add `always: true` to a skill's `SKILL.md` frontmatter to make nanobot load that skill into the system prompt automatically.

```md
---
name: your-skill
description: Short trigger-focused description.
always: true
---

# Your Skill

Instructions here are injected into the agent context automatically.
```

## Where It Appears

Always skills are injected into the system prompt under:

```md
# Active Skills
```

The injected content is the `SKILL.md` body. The YAML frontmatter is stripped before insertion.

## When It Is Loaded

For each user turn, nanobot builds `initial_messages` before entering the ReAct runner loop.

During that message-building step:

1. `ContextBuilder.build_messages()` creates the system message.
2. `ContextBuilder.build_system_prompt()` calls `SkillsLoader.get_always_skills()`.
3. Matching skills are loaded with `load_skills_for_context()`.
4. Their full `SKILL.md` body is placed in `# Active Skills`.

Inside the same ReAct turn, `get_always_skills()` is not called again for every iteration. The runner reuses the same initial system message while appending assistant messages, tool calls, tool results, and follow-up injections.

## Does It Need `read_file`?

An `always: true` skill does not need `read_file` to load its `SKILL.md`. The full body is already visible to the model through the system prompt.

However, only the main `SKILL.md` body is injected automatically. Extra files referenced by the skill, such as `references/*.md`, `scripts/*.py`, or assets, are not auto-loaded. Those still need to be read or executed when needed.

## What About Skills Without `always: true`?

Skills without `always: true` are not fully injected into the system prompt.

They appear only in the normal `# Skills` index, which includes:

- Skill name
- Description
- `SKILL.md` path
- Availability information

If the agent decides one of those skills is relevant, it must read the listed `SKILL.md` file on demand.

## Interaction With `disabledSkills`

If a skill name is listed in `agents.defaults.disabledSkills`, it is excluded from:

- The normal `# Skills` index
- Always-on `# Active Skills` injection
- Subagent skill summaries

This applies even if the skill has `always: true`.

## Practical Guidance

Use `always: true` only for short, high-value instructions that should be present on every turn.

Avoid marking large skills as always-on unless the token cost is justified. Long skills should usually stay in the normal skill index and be loaded on demand.
