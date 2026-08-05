# Runeweave ECS API

Runeweave 向 Lua 5.5、Luau、JavaScript 和 TypeScript 暴露同一组数据导向 API。
脚本声明 Entity、Component 和 Resource 数据，Bevy System 消费这些数据并决定如何
渲染、播放声音或执行其他宿主行为。

## 数据模型

Entity 使用稳定字符串作为脚本标识。Component 是附着在 Entity 上的命名值，Resource
是不属于单个 Entity 的命名全局值。值可以是 `null`、布尔、有限数字、字符串、数组或
字符串键对象。Lua/Luau 使用原生 table，JavaScript/TypeScript 使用原生 object/array。

写操作会立即更新脚本可见快照，因此同一回调内可以读取刚写入的数据；Bevy World 在
本帧的 `ApplyEcsCommands` 阶段统一同步。查询结果按 Entity ID 稳定排序。

## API

| API | 语义 |
| --- | --- |
| `ecs_world_clear()` | 销毁所有脚本拥有的 Entity；不删除 Resource |
| `ecs_entity_spawn(id)` | 创建或替换一个 Entity |
| `ecs_entity_exists(id)` | 判断 Entity 是否存在 |
| `ecs_entity_despawn(id)` | 销毁 Entity；不存在时返回 `false` |
| `ecs_component_insert(id, name, value)` | 插入或替换 Component；Entity 不存在时返回 `false` |
| `ecs_component_get(id, name)` | 返回 Component；不存在时返回 `nil`/`null` |
| `ecs_component_has(id, name)` | 判断 Entity 是否具有 Component |
| `ecs_component_remove(id, name)` | 删除 Component；不存在时返回 `false` |
| `ecs_query(required)` | 返回同时具有所有指定 Component 的 Entity ID |
| `ecs_resource_set(name, value)` | 插入或替换 Resource |
| `ecs_resource_get(name)` | 返回 Resource；不存在时返回 `nil`/`null` |
| `ecs_resource_remove(name)` | 删除 Resource；不存在时返回 `false` |

## JavaScript / TypeScript

```javascript
ecs_entity_spawn("player");
ecs_component_insert("player", "transform", { x: 0, y: -300 });
ecs_component_insert("player", "sprite", { kind: "player" });

const renderables = ecs_query(["transform", "sprite"]);
const transform = ecs_component_get("player", "transform");

ecs_resource_set("game_state", {
  score: 0,
  lives: 3,
  message: "READY",
});
```

TypeScript 全局声明见 `projects/ts/src/runeweave.d.ts`。

## Lua / Luau

```lua
ecs_entity_spawn("player")
ecs_component_insert("player", "transform", { x = 0, y = -300 })
ecs_component_insert("player", "sprite", { kind = "player" })

local renderables = ecs_query({ "transform", "sprite" })
local transform = ecs_component_get("player", "transform")

ecs_resource_set("game_state", {
    score = 0,
    lives = 3,
    message = "READY",
})
```

## Rust 消费端

`RuneweaveEcsPlugin` 将脚本 Entity 同步为带有 `ScriptOwned`、`ScriptEntityId` 和
`ScriptComponents` 的 Bevy Entity，并将全局数据同步到 `ScriptResources`。宿主系统
查询这些类型，将逻辑组件解释为自己的强类型渲染、物理或音频组件。Runeweave 核心
不会硬编码业务组件名或资源结构。

```rust
fn inspect_scripts(query: Query<(&ScriptEntityId, &ScriptComponents)>) {
    for (id, components) in &query {
        if let Some(transform) = components.get("transform") {
            // Validate the schema, then materialize the application's Bevy component.
        }
    }
}
```
