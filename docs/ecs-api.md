# Runeweave ECS API

Runeweave 向 Lua 5.5、JavaScript 和 TypeScript 暴露同一组数据导向 API。
脚本声明 Entity、Component 和 Resource 数据，Bevy System 消费这些数据并决定如何
渲染、播放声音或执行其他宿主行为。

## 数据模型

Entity 使用稳定字符串作为脚本标识。Component 是附着在 Entity 上的命名值，Resource
是不属于单个 Entity 的命名全局值。值可以是 `null`、布尔、有限数字、字符串、数组或
字符串键对象。Lua 使用原生 table，JavaScript/TypeScript 使用原生 object/array。

写操作会立即更新脚本可见快照，因此同一回调内可以读取刚写入的数据；Bevy World 在
本帧的 `ApplyEcsCommands` 阶段统一同步。查询结果按 Entity ID 稳定排序。

每个 Bevy `App` 拥有独立的 ECS 桥接实例，多个 App 或测试不会共享脚本快照。每个
`ScriptAttachment` 还拥有独立实体命名空间，不同脚本可以复用相同 Entity ID；查询和
`ecs_world_clear()` 只影响当前脚本拥有的实体。一个实体在同一帧内发生的多次修改会先
合并为最终状态，再一次性提交到 Bevy World。Resource 仍是 App 级共享数据。
Owner ID 由桥接层根据 `ScriptAttachment` 的结构化身份分配，不依赖其显示字符串；同一
attachment 在热重载前后会解析到同一个 owner。

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

TypeScript 推荐通过 SDK 模块显式导入，构建时由 esbuild 打包为 QuickJS 可执行的单文件：

```typescript
import {
  getComponent,
  insertComponent,
  queryEntities,
  setResource,
  spawnEntity,
} from "./ecs.js";

spawnEntity("player");
insertComponent("player", "transform", { x: 0, y: -300 });
const renderables = queryEntities(["transform", "sprite"]);
const transform = getComponent("player", "transform");
setResource("game_state", { score: 0, lives: 3, message: "READY" });
```

SDK 源码见 `projects/ts/src/ecs.ts`。底层全局 C ABI 风格函数仍可供普通 JavaScript 使用：

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

## Lua

```lua
local ecs = require("runeweave.ecs")

ecs.entity_spawn("player")
ecs.component_insert("player", "transform", { x = 0, y = -300 })
ecs.component_insert("player", "sprite", { kind = "player" })

local renderables = ecs.query({ "transform", "sprite" })
local transform = ecs.component_get("player", "transform")

ecs.resource_set("game_state", {
    score = 0,
    lives = 3,
    message = "READY",
})
```

`runeweave.ecs` 是 Rust runtime 注册到 `package.loaded` 的虚拟模块，不对应磁盘文件。

## HTTP API

HTTP 请求在独立线程中执行，不阻塞 Bevy 主线程。GET/POST 立即返回数字请求 ID，脚本可在
后续帧调用 `poll`。每个请求超时为 30 秒，响应正文上限为 1 MiB。完成或失败结果在读取后
从队列删除，再次轮询同一 ID 会返回 `unknown`。

轮询结果：

| `state` | 附加字段 | 含义 |
| --- | --- | --- |
| `pending` | 无 | 请求仍在执行 |
| `complete` | `status`, `body` | 收到 HTTP 响应，包括 4xx/5xx |
| `error` | `error` | 网络、超时、读取或响应大小错误 |
| `unknown` | 无 | 请求 ID 不存在或结果已被读取 |

### TypeScript

```typescript
import { httpGet, httpPost, pollHttp } from "./network.js";

const getRequest = httpGet("https://example.com/state.json");
const postRequest = httpPost(
  "https://example.com/scores",
  JSON.stringify({ score: 100 }),
);

const result = pollHttp(getRequest);
if (result.state === "complete") {
  console.log(result.status, result.body);
} else if (result.state === "error") {
  console.log(result.error);
}
```

SDK 源码见 `projects/ts/src/network.ts`。普通 JavaScript 可直接调用：

```javascript
const request = http_get("https://example.com/state.json");
const result = http_poll(request);
```

### Lua

```lua
local network = require("runeweave.network")

local request = network.http_get("https://example.com/state.json")
local post_request = network.http_post(
    "https://example.com/scores",
    '{"score":100}',
    "application/json"
)

local result = network.poll(request)
if result.state == "complete" then
    print(result.status, result.body)
elseif result.state == "error" then
    print(result.error)
end
```

`runeweave.network` 同样是 runtime 注册的虚拟 Lua 模块。

## Rust 消费端

`RuneweaveEcsPlugin` 将脚本 Entity 同步为带有 `ScriptOwned`、`ScriptOwnerId`、
`ScriptEntityId` 和 `ScriptComponents` 的 Bevy Entity，并将全局数据同步到
`ScriptResources`。宿主系统
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
