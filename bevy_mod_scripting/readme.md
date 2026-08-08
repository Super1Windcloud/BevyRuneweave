# Bevy Runeweave BMS Runtime

This is the focused `bevy_mod_scripting` runtime used by Bevy Runeweave. It
keeps the upstream script asset, lifecycle, callback, and hot-reload pipeline,
while limiting language support to:

- Lua 5.5 through `mlua`
- JavaScript through QuickJS
- TypeScript compiled to JavaScript and executed through QuickJS

The host exposes an explicit game API instead of registering Bevy's generated
reflection globals. JavaScript and TypeScript share the same QuickJS runtime.

Use the repository root `justfile` for every build and validation command.
