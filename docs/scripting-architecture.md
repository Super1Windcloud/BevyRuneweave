# BMS-First Scripting Architecture

Bevy Runeweave uses `bevy_mod_scripting` as the sole foundation for script-facing APIs. Scripts
operate on the real Bevy `World` through reflected types, registered functions, guarded references,
queries, resources, and script systems.

## Authoritative State

The Bevy `World` is authoritative. A script component is a real registered Bevy component, and a
script resource is a real registered Bevy resource. Rust systems and scripts observe the same state.
Runtime APIs must not maintain a second ECS snapshot that later materializes into Bevy components.
Runeweave scene functions therefore insert Bevy `Transform`, `Sprite`, and text components directly,
while input functions read the live `ButtonInput<KeyCode>` resource through `WorldGuard`.

## API Registration

Script APIs are defined once through BMS:

1. Register script-visible types with Bevy reflection and the applicable component/resource data.
2. Register constructors, methods, and commands in `AppScriptFunctionRegistry` using BMS namespaces
   and binding helpers.
3. Let language adapters convert `ScriptValue` and `ReflectReference` to native Lua and QuickJS
   values.
4. Generate or update TypeScript declarations from the registered contract.

Language adapters may expose the BMS core globals needed to reach the registry. Product features
must not be implemented as unrelated handwritten globals in each language runtime.

## Access And Lifetime

All reflected world access goes through `WorldGuard` and its access claims. References must follow
`ReflectReference` validity and allocation rules. Script systems declare component/resource access
and schedule placement through the BMS script-system infrastructure.

## Removed Legacy Layer

The former `src/ecs_api` snapshot bridge and its Lua/QuickJS adapters have been removed. Runtime
code must not recreate `EcsValue` snapshots, string-keyed generic components, deferred mirror
systems, or language-specific product globals. `src/script_api` contains the current domain types
and registers each operation once through `NamespaceBuilder`; Lua and QuickJS consume the same BMS
registry entries.

Input, networking, rendering, physics, audio, and future script APIs follow the same BMS registration
path even when their implementation uses platform-specific code internally.
