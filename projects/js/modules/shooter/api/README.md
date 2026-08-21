# JavaScript Runtime API

The runtime exposes reflected scene types, retained Bevy UI, keyboard, mouse/touch pointer,
application-exit, and HTTP functions through the shared BMS registry. This directory marks the API
boundary; game code and runtime assets live under `../game`.

Retained UI uses `ui_spawn`, `ui_set_style`, `ui_set_text`, `ui_set_image`,
`ui_button_just_pressed`, `ui_despawn`, and `ui_clear`. Style objects are passed as JSON strings so
JavaScript, TypeScript, and Lua use the exact same BMS function implementation.

See `docs/script-api.md` for the exported functions.
