--!strict

type Actor = { id: string, x: number, y: number, alive: boolean }
type Point = { x: number, y: number }

local PLAYER_SPEED: number = 330
local BULLET_SPEED: number = 570
local ENEMY_SPEED: number = 145
local FIRE_DELAY: number = 0.18
local SPAWN_DELAY: number = 0.72

local player: Point = { x = 0, y = -300 }
local bullets: { Actor } = {}
local enemies: { Actor } = {}
local score: number = 0
local lives: number = 3
local next_id: number = 1
local fire_timer: number = 0
local spawn_timer: number = 0
local seed: number = 73129
local game_over: boolean = false
local was_firing: boolean = false

local function spawn_entity(kind: string, id: string, x: number, y: number)
    ecs_spawn_entity(id)
    ecs_insert_sprite(id, kind)
    ecs_set_transform(id, x, y)
end

local function random01(): number
    seed = (seed * 48271) % 2147483647
    return seed / 2147483647
end

local function reset_game()
    ecs_clear_world()
    player = { x = 0, y = -300 }
    bullets = {}
    enemies = {}
    score = 0
    lives = 3
    next_id = 1
    fire_timer = 0
    spawn_timer = 0.35
    seed = 73129
    game_over = false
    spawn_entity("player", "player", player.x, player.y)
    ecs_set_game_state(score, lives, "ARROWS/WASD + HOLD SPACE")
end

local function spawn_enemy()
    local enemy: Actor = {
        id = `enemy_{next_id}`,
        x = -250 + random01() * 500,
        y = 350,
        alive = true,
    }
    next_id += 1
    table.insert(enemies, enemy)
    spawn_entity("enemy", enemy.id, enemy.x, enemy.y)
end

local function shoot()
    local bullet: Actor = {
        id = `bullet_{next_id}`,
        x = player.x,
        y = player.y + 50,
        alive = true,
    }
    next_id += 1
    table.insert(bullets, bullet)
    spawn_entity("bullet", bullet.id, bullet.x, bullet.y)
end

local function hit(a: Point, b: Point, half_width: number, half_height: number): boolean
    return math.abs(a.x - b.x) < half_width and math.abs(a.y - b.y) < half_height
end

function on_script_loaded()
    reset_game()
end

function on_script_reloaded()
    reset_game()
end

function on_update(dt: number, input_x: number, input_y: number, firing: boolean)
    if game_over then
        if firing and not was_firing then reset_game() end
        was_firing = firing
        return
    end

    player.x = math.clamp(player.x + input_x * PLAYER_SPEED * dt, -260, 260)
    player.y = math.clamp(player.y + input_y * PLAYER_SPEED * dt, -335, 300)
    ecs_set_transform("player", player.x, player.y)

    fire_timer -= dt
    if firing and fire_timer <= 0 then
        shoot()
        fire_timer = FIRE_DELAY
    end

    spawn_timer -= dt
    if spawn_timer <= 0 then
        spawn_enemy()
        spawn_timer = SPAWN_DELAY
    end

    for _, bullet in bullets do
        bullet.y += BULLET_SPEED * dt
        if bullet.y > 420 then
            bullet.alive = false
            ecs_despawn_entity(bullet.id)
        else
            ecs_set_transform(bullet.id, bullet.x, bullet.y)
        end
    end

    for _, enemy in enemies do
        enemy.y -= ENEMY_SPEED * dt
        if enemy.y < -420 then
            enemy.alive = false
            lives -= 1
            ecs_despawn_entity(enemy.id)
        else
            ecs_set_transform(enemy.id, enemy.x, enemy.y)
        end
    end

    for _, bullet in bullets do
        if not bullet.alive then continue end
        for _, enemy in enemies do
            if enemy.alive and hit(bullet, enemy, 36, 42) then
                bullet.alive = false
                enemy.alive = false
                score += 100
                ecs_despawn_entity(bullet.id)
                ecs_despawn_entity(enemy.id)
                break
            end
        end
    end

    for _, enemy in enemies do
        if enemy.alive and hit(player, enemy, 55, 65) then
            enemy.alive = false
            lives -= 1
            ecs_despawn_entity(enemy.id)
        end
    end

    local live_bullets: { Actor } = {}
    for _, bullet in bullets do
        if bullet.alive then table.insert(live_bullets, bullet) end
    end
    bullets = live_bullets
    local live_enemies: { Actor } = {}
    for _, enemy in enemies do
        if enemy.alive then table.insert(live_enemies, enemy) end
    end
    enemies = live_enemies

    if lives <= 0 then
        lives = 0
        game_over = true
        ecs_set_game_state(score, lives, "GAME OVER - TAP SPACE TO RESTART")
    else
        ecs_set_game_state(score, lives, "")
    end
    was_firing = firing
end
