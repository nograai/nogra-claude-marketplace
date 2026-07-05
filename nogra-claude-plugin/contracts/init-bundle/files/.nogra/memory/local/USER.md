# Nogra User Profile

schema: nogra.memory.user.v1
workspace: {{workspaceName}}
authority: advisory-continuity
reuse_rule: who the user is — role, preferences, how they work; loaded into every session, bounded at 1375 chars; consolidate when full, do not hoard

<!-- Nogra loads this file into every session, deterministically. Keep it to durable facts about the user; when it is full, the oldest content drops on read — consolidate rather than hoard. -->
