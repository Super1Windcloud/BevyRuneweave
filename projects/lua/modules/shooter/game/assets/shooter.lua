local PLAYER_SPEED = 330
local BULLET_SPEED = 570
local ENEMY_SPEED = 145
local FIRE_DELAY = 0.18
local SPAWN_DELAY = 0.72
local DAMAGE_DELAY = 1.0
local SPRITES = {
    background = { path = "sprites/background.png", width = 600, height = 800 },
    player = { path = "sprites/player.png", width = 72, height = 88 },
    enemy = { path = "sprites/enemy.png", width = 66, height = 70 },
    bullet = { path = "sprites/bullet.png", width = 14, height = 34 },
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
    spawn_entity("player", {
        role = "player",
        sprite = SPRITES.player,
        transform = { x = 0, y = -300, z = 3 },
        collider = { x = 25, y = 35 },
    })
end

local function spawn_enemy()
    local id = "enemy_" .. resources.next_id
    resources.next_id = resources.next_id + 1
    spawn_entity(id, {
        role = "enemy",
        sprite = SPRITES.enemy,
        transform = { x = -250 + random01() * 500, y = 350, z = 2 },
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
            transform.x = math.max(-260, math.min(260, transform.x + frame.input_x * PLAYER_SPEED * frame.dt))
            transform.y = math.max(-335, math.min(300, transform.y + frame.input_y * PLAYER_SPEED * frame.dt))
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
        if transform and transform.y > 420 then queue_despawn(id) end
    end
    for id in pairs(world.enemies) do
        local transform = world.transforms[id]
        if transform and transform.y < -420 then queue_despawn(id) end
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
        25,
        0.82,
        0.94,
        1.0,
        1.0,
        "top_center"
    )
end

local function game_state_system()
    if resources.lives <= 0 then
        resources.lives = 0
        resources.game_over = true
        update_game_state("GAME OVER - TAP SPACE TO RESTART")
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
end

local update_schedule = {
    player_movement_system,
    weapon_system,
    enemy_spawn_system,
    movement_system,
    bounds_system,
    collision_system,
}

local function reset_game()
    scene_clear()
    world = create_world()
    resources = create_resources()
    spawn_scene()
    spawn_player()
    update_game_state("ARROWS/WASD - AUTO FIRE")
end

function on_script_loaded()
    reset_game()
end

function on_script_reloaded()
    reset_game()
end

function on_update(dt)
    local input_x = (input_key_pressed("ArrowRight") or input_key_pressed("KeyD")) and 1 or 0
    input_x = input_x - ((input_key_pressed("ArrowLeft") or input_key_pressed("KeyA")) and 1 or 0)
    local input_y = (input_key_pressed("ArrowUp") or input_key_pressed("KeyW")) and 1 or 0
    input_y = input_y - ((input_key_pressed("ArrowDown") or input_key_pressed("KeyS")) and 1 or 0)
    local restart_pressed = input_key_pressed("Space")
    if not resources.started then
        if restart_pressed and not resources.restart_was_pressed then
            resources.started = true
            update_game_state("ARROWS/WASD - AUTO FIRE")
        else
            resources.restart_was_pressed = restart_pressed
            update_game_state("PRESS SPACE TO START")
            return
        end
    end
    if resources.game_over then
        if restart_pressed and not resources.restart_was_pressed then reset_game() end
        resources.restart_was_pressed = restart_pressed
        return
    end

    local frame = { dt = dt, input_x = input_x, input_y = input_y }
    for _, system in ipairs(update_schedule) do system(frame) end
    flush_entity_commands()
    game_state_system()
    render_sync_system()
    resources.restart_was_pressed = restart_pressed
end
