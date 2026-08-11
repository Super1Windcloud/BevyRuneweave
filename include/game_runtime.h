#ifndef BEVY_SCRIPT_GAME_RUNTIME_H
#define BEVY_SCRIPT_GAME_RUNTIME_H

#ifdef __cplusplus
extern "C" {
#endif

/* Blocks until the Bevy event loop exits. Returns 0 on success. */
int game_runtime_run(const char *script_path);

/* Runs with an explicit asset directory. Both paths must be UTF-8. */
int game_runtime_run_with_assets(const char *asset_root, const char *script_path);

/* Reloads the configured script on the next frame. */
void game_runtime_request_reload(void);

/*
 * Handles a script exit request in an embedding host. Pass NULL to restore the
 * standalone behavior, which exits the Bevy event loop.
 */
typedef void (*game_runtime_exit_callback)(void);
void game_runtime_set_exit_callback(game_runtime_exit_callback callback);

/* Switches to another relative script path inside the active asset directory. */
int game_runtime_switch_script(const char *script_path);

#ifdef __cplusplus
}
#endif

#endif
