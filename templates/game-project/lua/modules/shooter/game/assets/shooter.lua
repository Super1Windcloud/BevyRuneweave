local PLAYER_SPEED = 330
local DESIGN_WIDTH = 600
local DESIGN_HEIGHT = 800
local BULLET_SPEED = 570
local ENEMY_SPEED = 145
local FIRE_DELAY = 0.18
local SPAWN_DELAY = 0.72
local DAMAGE_DELAY = 1.0
local SETTINGS_ICON_ID = "settings_icon"
local SETTINGS_MENU_IDS = { "settings_panel", "settings_title", "settings_restart", "settings_exit" }
local FULL_SAFE_AREA = {
    left = -DESIGN_WIDTH * 0.5,
    right = DESIGN_WIDTH * 0.5,
    bottom = -DESIGN_HEIGHT * 0.5,
    top = DESIGN_HEIGHT * 0.5,
    width = DESIGN_WIDTH,
    height = DESIGN_HEIGHT,
    leftInset = 0,
    rightInset = 0,
    bottomInset = 0,
    topInset = 0,
}
local SPRITES = {
    background = { path = "sprites/background.png", width = 600, height = 800 },
    player = { path = "sprites/player.png", width = 72, height = 88 },
    enemy = { path = "sprites/enemy.png", width = 66, height = 70 },
    bullet = { path = "sprites/bullet.png", width = 14, height = 34 },
    settings_icon = { path = "sprites/settings-icon.png", width = 64, height = 64 },
    settings_panel = { path = "sprites/settings-panel.png", width = 440, height = 320 },
}

local function create_world()
    return {
        entities = {},
        transforms = {},
        velocities = {},
        colliders = {},
        sprites = {},
        players = {},
        bullets = {},
        enemies = {},
        pending_despawn = {},
    }
end

local function create_resources()
    return {
        score = 0,
        lives = 3,
        next_id = 1,
        fire_timer = 0,
        spawn_timer = 0.35,
        damage_timer = 0,
        seed = 73129,
        game_over = false,
        restart_was_pressed = false,
        started = false,
        settings_open = false,
        pointer_was_pressed = false,
        pointer_x = 0,
        pointer_y = 0,
        play_left = FULL_SAFE_AREA.left,
        play_right = FULL_SAFE_AREA.right,
        play_width = DESIGN_WIDTH,
        safe_area = FULL_SAFE_AREA,
    }
end

local world = create_world()
local resources = create_resources()

local function spawn_entity(id, bundle)
    world.entities[id] = true
    world.transforms[id] = bundle.transform
    world.colliders[id] = bundle.collider
    world.sprites[id] = bundle.sprite
    if bundle.velocity then world.velocities[id] = bundle.velocity end
    if bundle.role == "player" then world.players[id] = true end
    if bundle.role == "bullet" then world.bullets[id] = true end
    if bundle.role == "enemy" then world.enemies[id] = true end

    scene_spawn(id, bundle.transform.x, bundle.transform.y, bundle.transform.z)
    scene_set_sprite(id, bundle.sprite.path, bundle.sprite.width, bundle.sprite.height)
end

local function queue_despawn(id)
    if world.entities[id] then world.pending_despawn[id] = true end
end

local function is_active(id)
    return world.entities[id] and not world.pending_despawn[id]
end

local function flush_entity_commands()
    for id in pairs(world.pending_despawn) do
        world.entities[id] = nil
        world.transforms[id] = nil
        world.velocities[id] = nil
        world.colliders[id] = nil
        world.sprites[id] = nil
        world.players[id] = nil
        world.bullets[id] = nil
        world.enemies[id] = nil
        scene_despawn(id)
    end
    world.pending_despawn = {}
end

local function random01()
    resources.seed = (resources.seed * 48271) % 2147483647
    return resources.seed / 2147483647
end

local function spawn_player()
    local min_y = resources.safe_area.bottom + SPRITES.player.height * 0.5 + 8
    local max_y = resources.safe_area.top - SPRITES.player.height * 0.5 - 8
    spawn_entity("player", {
        role = "player",
        sprite = SPRITES.player,
        transform = { x = 0, y = math.max(min_y, math.min(max_y, -300)), z = 3 },
        collider = { x = 25, y = 35 },
    })
end

local function spawn_enemy()
    local id = "enemy_" .. resources.next_id
    resources.next_id = resources.next_id + 1
    local min_x = resources.play_left + 50
    local max_x = resources.play_right - 50
    spawn_entity(id, {
        role = "enemy",
        sprite = SPRITES.enemy,
        transform = {
            x = min_x + random01() * math.max(0, max_x - min_x),
            y = resources.safe_area.top - SPRITES.enemy.height * 0.5 - 8,
            z = 2,
        },
        velocity = { x = 0, y = -ENEMY_SPEED },
        collider = { x = 30, y = 30 },
    })
end

local function spawn_bullet(player_transform)
    local id = "bullet_" .. resources.next_id
    resources.next_id = resources.next_id + 1
    spawn_entity(id, {
        role = "bullet",
        sprite = SPRITES.bullet,
        transform = { x = player_transform.x, y = player_transform.y + 50, z = 1 },
        velocity = { x = 0, y = BULLET_SPEED },
        collider = { x = 6, y = 12 },
    })
end

local function player_movement_system(frame)
    for id in pairs(world.players) do
        local transform = world.transforms[id]
        if transform and is_active(id) then
            local movement_x = frame.pointer.pressed and frame.pointer_delta_x
                or frame.input_x * PLAYER_SPEED * frame.dt
            local movement_y = frame.pointer.pressed and frame.pointer_delta_y
                or frame.input_y * PLAYER_SPEED * frame.dt
            local min_x = resources.play_left + SPRITES.player.width * 0.5
            local max_x = resources.play_right - SPRITES.player.width * 0.5
            local min_y = resources.safe_area.bottom + SPRITES.player.height * 0.5 + 8
            local max_y = resources.safe_area.top - SPRITES.player.height * 0.5 - 8
            transform.x = math.max(min_x, math.min(max_x, transform.x + movement_x))
            transform.y = math.max(min_y, math.min(max_y, transform.y + movement_y))
        end
    end
end

local function weapon_system(frame)
    resources.fire_timer = resources.fire_timer - frame.dt
    if resources.fire_timer > 0 then return end
    for id in pairs(world.players) do
        local transform = world.transforms[id]
        if transform and is_active(id) then spawn_bullet(transform) end
    end
    resources.fire_timer = FIRE_DELAY
end

local function enemy_spawn_system(frame)
    resources.spawn_timer = resources.spawn_timer - frame.dt
    if resources.spawn_timer <= 0 then
        spawn_enemy()
        resources.spawn_timer = SPAWN_DELAY
    end
end

local function movement_system(frame)
    for id, velocity in pairs(world.velocities) do
        local transform = world.transforms[id]
        if transform and is_active(id) then
            transform.x = transform.x + velocity.x * frame.dt
            transform.y = transform.y + velocity.y * frame.dt
        end
    end
end

local function bounds_system()
    for id in pairs(world.bullets) do
        local transform = world.transforms[id]
        if transform and transform.y + SPRITES.bullet.height * 0.5 >= resources.safe_area.top then
            queue_despawn(id)
        end
    end
    for id in pairs(world.enemies) do
        local transform = world.transforms[id]
        if transform and transform.y - SPRITES.enemy.height * 0.5 <= resources.safe_area.bottom then
            queue_despawn(id)
        end
    end
end

local function entities_overlap(left, right)
    local left_transform = world.transforms[left]
    local right_transform = world.transforms[right]
    local left_collider = world.colliders[left]
    local right_collider = world.colliders[right]
    if not left_transform or not right_transform or not left_collider or not right_collider then
        return false
    end
    return math.abs(left_transform.x - right_transform.x) < left_collider.x + right_collider.x
        and math.abs(left_transform.y - right_transform.y) < left_collider.y + right_collider.y
end

local function collision_system(frame)
    for bullet in pairs(world.bullets) do
        if is_active(bullet) then
            for enemy in pairs(world.enemies) do
                if is_active(enemy) and entities_overlap(bullet, enemy) then
                    queue_despawn(bullet)
                    queue_despawn(enemy)
                    resources.score = resources.score + 100
                    break
                end
            end
        end
    end
    resources.damage_timer = math.max(0, resources.damage_timer - frame.dt)
    if resources.damage_timer > 0 then return end
    for player in pairs(world.players) do
        if is_active(player) then
            for enemy in pairs(world.enemies) do
                if is_active(enemy) and entities_overlap(player, enemy) then
                    queue_despawn(enemy)
                    resources.lives = resources.lives - 1
                    resources.damage_timer = DAMAGE_DELAY
                    return
                end
            end
        end
    end
end

local function render_sync_system()
    for id, transform in pairs(world.transforms) do
        if is_active(id) then scene_set_transform(id, transform.x, transform.y, transform.z) end
    end
end

local function update_game_state(message)
    game_state_set(resources.score, resources.lives, message)
    local status = string.format("SCORE %05d    LIVES %d", resources.score, resources.lives)
    scene_set_text(
        "hud",
        message ~= "" and status .. "\n" .. message or status,
        math.max(18, math.min(25, resources.play_width / 18)),
        0.82,
        0.94,
        1.0,
        1.0,
        "top_left"
    )
end

local function responsive_layout()
    local icon_size = math.max(44, math.min(64, resources.play_width * 0.17))
    local icon_x = resources.play_right - icon_size * 0.5 - 12
    local icon_y = resources.safe_area.top - icon_size * 0.5 - 12
    local menu_scale = math.max(0.1, math.min(
        1,
        (resources.play_width - 24) / 440,
        (resources.safe_area.height - 24) / 320
    ))
    local menu_center_x = (resources.play_left + resources.play_right) * 0.5
    local menu_center_y = (resources.safe_area.top + resources.safe_area.bottom) * 0.5
    return {
        icon_size = icon_size,
        icon_x = icon_x,
        icon_y = icon_y,
        menu_center_x = menu_center_x,
        menu_center_y = menu_center_y,
        menu_width = 440 * menu_scale,
        menu_height = 320 * menu_scale,
        menu_scale = menu_scale,
        button_width = 356 * menu_scale,
        button_height = 72 * menu_scale,
        restart_y = menu_center_y + 20 * menu_scale,
        exit_y = menu_center_y - 86 * menu_scale,
    }
end

local function apply_responsive_layout()
    local layout = responsive_layout()
    scene_set_transform("hud", resources.play_left + 12, resources.safe_area.top - 12, 20)
    scene_set_transform(SETTINGS_ICON_ID, layout.icon_x, layout.icon_y, 50)
    scene_set_sprite(
        SETTINGS_ICON_ID,
        SPRITES.settings_icon.path,
        layout.icon_size,
        layout.icon_size
    )
    if not resources.settings_open then return end
    scene_set_sprite(
        "settings_panel",
        SPRITES.settings_panel.path,
        layout.menu_width,
        layout.menu_height
    )
    scene_set_transform("settings_panel", layout.menu_center_x, layout.menu_center_y, 40)
    scene_set_transform(
        "settings_title",
        layout.menu_center_x,
        layout.menu_center_y + 125 * layout.menu_scale,
        41
    )
    scene_set_transform("settings_restart", layout.menu_center_x, layout.restart_y, 41)
    scene_set_transform("settings_exit", layout.menu_center_x, layout.exit_y, 41)
    local title_size = math.max(16, 28 * layout.menu_scale)
    local button_size = math.max(15, 25 * layout.menu_scale)
    scene_set_text("settings_title", "SETTINGS", title_size, 0.91, 0.97, 0.98, 1, "center")
    scene_set_text("settings_restart", "RESTART", button_size, 0.91, 0.97, 0.98, 1, "center")
    scene_set_text("settings_exit", "EXIT GAME", button_size, 1, 0.72, 0.74, 1, "center")
end

local function constrain_foreground_to_safe_area()
    for id, transform in pairs(world.transforms) do
        local sprite = world.sprites[id]
        if sprite then
            transform.x = math.max(
                resources.play_left + sprite.width * 0.5,
                math.min(resources.play_right - sprite.width * 0.5, transform.x)
            )
            transform.y = math.max(
                resources.safe_area.bottom + sprite.height * 0.5,
                math.min(resources.safe_area.top - sprite.height * 0.5, transform.y)
            )
        end
    end
end

local function sync_responsive_layout(viewport_width, safe_area)
    local half_width = math.min(DESIGN_WIDTH, viewport_width) * 0.5
    local next_left = math.max(-half_width, safe_area.left)
    local next_right = math.min(half_width, safe_area.right)
    local unchanged = math.abs(resources.play_left - next_left) < 0.5
        and math.abs(resources.play_right - next_right) < 0.5
        and math.abs(resources.safe_area.top - safe_area.top) < 0.5
        and math.abs(resources.safe_area.bottom - safe_area.bottom) < 0.5
    if unchanged then return end
    resources.play_left = next_left
    resources.play_right = math.max(next_left + 1, next_right)
    resources.play_width = resources.play_right - resources.play_left
    resources.safe_area = safe_area
    constrain_foreground_to_safe_area()
    apply_responsive_layout()
    if resources.settings_open then update_game_state("PAUSED") end
end

local function game_state_system()
    if resources.lives <= 0 then
        resources.lives = 0
        resources.game_over = true
        update_game_state("CLICK / TOUCH / SPACE TO RESTART")
    else
        update_game_state("")
    end
end

local function spawn_scene()
    scene_spawn("background", 0, 0, -10)
    scene_set_sprite(
        "background",
        SPRITES.background.path,
        SPRITES.background.width,
        SPRITES.background.height
    )
    scene_spawn("hud", 0, 382, 20)
    scene_spawn(SETTINGS_ICON_ID, 0, 350, 50)
    scene_set_sprite(
        SETTINGS_ICON_ID,
        SPRITES.settings_icon.path,
        SPRITES.settings_icon.width,
        SPRITES.settings_icon.height
    )
    apply_responsive_layout()
end

local function set_settings_open(open)
    if resources.settings_open == open then return end
    resources.settings_open = open
    if not open then
        for _, id in ipairs(SETTINGS_MENU_IDS) do scene_despawn(id) end
        return
    end
    scene_spawn("settings_panel", 0, 0, 40)
    scene_set_sprite(
        "settings_panel",
        SPRITES.settings_panel.path,
        SPRITES.settings_panel.width,
        SPRITES.settings_panel.height
    )
    scene_spawn("settings_title", 0, 0, 41)
    scene_spawn("settings_restart", 0, 0, 41)
    scene_spawn("settings_exit", 0, 0, 41)
    apply_responsive_layout()
    update_game_state("PAUSED")
end

local function pointer_inside(pointer, center_x, center_y, width, height)
    return math.abs(pointer.x - center_x) <= width * 0.5
        and math.abs(pointer.y - center_y) <= height * 0.5
end

local update_schedule = {
    player_movement_system,
    weapon_system,
    enemy_spawn_system,
    movement_system,
    bounds_system,
    collision_system,
}

local function reset_game(started, viewport_width, safe_area)
    scene_clear()
    world = create_world()
    resources = create_resources()
    resources.started = started or false
    safe_area = safe_area or FULL_SAFE_AREA
    viewport_width = viewport_width or DESIGN_WIDTH
    local half_width = math.min(DESIGN_WIDTH, viewport_width) * 0.5
    resources.safe_area = safe_area
    resources.play_left = math.max(-half_width, safe_area.left)
    resources.play_right = math.max(
        resources.play_left + 1,
        math.min(half_width, safe_area.right)
    )
    resources.play_width = resources.play_right - resources.play_left
    spawn_scene()
    spawn_player()
    update_game_state(resources.started and "DRAG OR ARROWS/WASD - AUTO FIRE"
        or "CLICK / TOUCH / SPACE TO START")
end

local function handle_settings_input(pointer)
    local layout = responsive_layout()
    local toggle_pressed = input_key_just_pressed("Escape")
        or (pointer.justPressed
            and pointer_inside(pointer, layout.icon_x, layout.icon_y, layout.icon_size, layout.icon_size))
    if toggle_pressed then
        set_settings_open(not resources.settings_open)
        return true
    end
    if not resources.settings_open then return false end
    if not pointer.justPressed then return true end
    if pointer_inside(
        pointer,
        layout.menu_center_x,
        layout.restart_y,
        layout.button_width,
        layout.button_height
    ) then
        reset_game(true, pointer.viewportWidth, resources.safe_area)
    elseif pointer_inside(
        pointer,
        layout.menu_center_x,
        layout.exit_y,
        layout.button_width,
        layout.button_height
    ) then
        app_request_exit()
    end
    return true
end

function on_script_loaded()
    window_set_size(DESIGN_WIDTH, DESIGN_HEIGHT)
    reset_game(false, DESIGN_WIDTH, window_safe_area())
end

function on_script_reloaded()
    window_set_size(DESIGN_WIDTH, DESIGN_HEIGHT)
    reset_game(false, DESIGN_WIDTH, window_safe_area())
end

function on_update(dt)
    local pointer = input_primary_pointer()
    local safe_area = window_safe_area()
    sync_responsive_layout(pointer.viewportWidth, safe_area)
    if handle_settings_input(pointer) then
        resources.pointer_was_pressed = false
        return
    end
    local pointer_delta_x = 0
    local pointer_delta_y = 0
    if pointer.pressed and resources.pointer_was_pressed then
        pointer_delta_x = pointer.x - resources.pointer_x
        pointer_delta_y = pointer.y - resources.pointer_y
    end
    resources.pointer_was_pressed = pointer.pressed
    if pointer.pressed then
        resources.pointer_x = pointer.x
        resources.pointer_y = pointer.y
    end
    local input_x = (input_key_pressed("ArrowRight") or input_key_pressed("KeyD")) and 1 or 0
    input_x = input_x - ((input_key_pressed("ArrowLeft") or input_key_pressed("KeyA")) and 1 or 0)
    local input_y = (input_key_pressed("ArrowUp") or input_key_pressed("KeyW")) and 1 or 0
    input_y = input_y - ((input_key_pressed("ArrowDown") or input_key_pressed("KeyS")) and 1 or 0)
    local pointer_in_playfield = pointer.x >= resources.play_left
        and pointer.x <= resources.play_right
        and pointer.y >= resources.safe_area.bottom
        and pointer.y <= resources.safe_area.top
    local restart_pressed = input_key_pressed("Space")
        or (pointer.justPressed and pointer_in_playfield)
    if not resources.started then
        if restart_pressed and not resources.restart_was_pressed then
            resources.started = true
            update_game_state("DRAG OR ARROWS/WASD - AUTO FIRE")
        else
            resources.restart_was_pressed = restart_pressed
            update_game_state("CLICK / TOUCH / SPACE TO START")
            return
        end
    end
    if resources.game_over then
        if restart_pressed and not resources.restart_was_pressed then
            reset_game(true, pointer.viewportWidth, resources.safe_area)
        end
        resources.restart_was_pressed = restart_pressed
        return
    end

    local frame = {
        dt = dt,
        input_x = input_x,
        input_y = input_y,
        pointer = pointer,
        pointer_delta_x = pointer_delta_x,
        pointer_delta_y = pointer_delta_y,
    }
    for _, system in ipairs(update_schedule) do system(frame) end
    flush_entity_commands()
    game_state_system()
    render_sync_system()
    resources.restart_was_pressed = restart_pressed
end
