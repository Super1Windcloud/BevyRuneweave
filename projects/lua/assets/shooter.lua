local PLAYER_SPEED = 330
local BULLET_SPEED = 570
local ENEMY_SPEED = 145
local FIRE_DELAY = 0.18
local SPAWN_DELAY = 0.72
local DAMAGE_DELAY = 1.0

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

    ecs_spawn_entity(id)
    ecs_insert_sprite(id, bundle.sprite)
    ecs_set_transform(id, bundle.transform.x, bundle.transform.y)
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
        ecs_despawn_entity(id)
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
        sprite = "player",
        transform = { x = 0, y = -300 },
        collider = { x = 25, y = 35 },
    })
end

local function spawn_enemy()
    local id = "enemy_" .. resources.next_id
    resources.next_id = resources.next_id + 1
    spawn_entity(id, {
        role = "enemy",
        sprite = "enemy",
        transform = { x = -250 + random01() * 500, y = 350 },
        velocity = { x = 0, y = -ENEMY_SPEED },
        collider = { x = 30, y = 30 },
    })
end

local function spawn_bullet(player_transform)
    local id = "bullet_" .. resources.next_id
    resources.next_id = resources.next_id + 1
    spawn_entity(id, {
        role = "bullet",
        sprite = "bullet",
        transform = { x = player_transform.x, y = player_transform.y + 50 },
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
        if is_active(id) then ecs_set_transform(id, transform.x, transform.y) end
    end
end

local function game_state_system()
    if resources.lives <= 0 then
        resources.lives = 0
        resources.game_over = true
        ecs_set_game_state(resources.score, resources.lives, "GAME OVER - TAP SPACE TO RESTART")
    else
        ecs_set_game_state(resources.score, resources.lives, "")
    end
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
    ecs_clear_world()
    world = create_world()
    resources = create_resources()
    spawn_player()
    ecs_set_game_state(resources.score, resources.lives, "ARROWS/WASD - AUTO FIRE")
end

function on_script_loaded()
    reset_game()
end

function on_script_reloaded()
    reset_game()
end

function on_update(dt, input_x, input_y, restart_pressed)
    if not resources.started then
        if restart_pressed and not resources.restart_was_pressed then
            resources.started = true
            ecs_set_game_state(resources.score, resources.lives, "ARROWS/WASD - AUTO FIRE")
        else
            resources.restart_was_pressed = restart_pressed
            ecs_set_game_state(resources.score, resources.lives, "PRESS SPACE TO START")
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
