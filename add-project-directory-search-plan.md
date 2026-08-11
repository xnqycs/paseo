# Add Project 目录搜索 TDD 开发计划

## 1. 计划信息

- **目标**：在 Add Project 流程中提供跨主机的目录搜索，让用户选择已存在的项目目录并进入新建 Workspace 流程。
- **方法**：以行为测试为契约，按 `Red -> Green -> Refactor` 逐个垂直切片交付。
- **范围**：文件系统搜索、WebSocket request/response、daemon client、Add Project 状态与 UI、真实浏览器 E2E、兼容性和性能验证。
- **不改动**：GitHub clone、系统目录选择器、New directory 的业务规则。它们只在共享的 Add Project 导航和目录查询缓存发生交互时做回归验证。
- **完成定义**：所有目标测试通过；`typecheck`、`lint`、格式检查通过；三轮独立验证有记录；无未解释的跨平台或协议兼容风险。

这份计划以仓库当前代码为基线。当前目录搜索主链路已经存在，计划中的测试用于固化行为、补齐缺口和验证后续改动；已经通过的现有测试不能被删除来制造“绿灯”。

## 2. 现状基线

### 2.1 代码入口

| 层          | 文件                                                 | 当前职责                                                                                                                   |
| ----------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 搜索引擎    | `packages/server/src/utils/directory-suggestions.ts` | 解析路径查询、遍历目录、过滤隐藏/Git ignored 项、模糊/后缀匹配、排序、限制扫描量和缓存。                                   |
| daemon RPC  | `packages/server/src/server/session.ts`              | 处理 `directory_suggestions_request`，决定主目录搜索或 Workspace 相对路径搜索，并返回 `entries` 与兼容字段 `directories`。 |
| Wire schema | `packages/protocol/src/messages.ts`                  | 声明 request/response 字段、`entries` 的 `file \| directory` 类型和 `requestId`。                                          |
| client      | `packages/client/src/daemon-client.ts`               | 发送 `getDirectorySuggestions`，按 `requestId` 等待 response。                                                             |
| 状态模型    | `packages/app/src/add-project-flow/model.ts`         | `host -> method -> directory-search` 页面栈、输入值、活动项、提交和错误状态。                                              |
| 选项构建    | `packages/app/src/add-project-flow/options.ts`       | 合并推荐目录和 daemon 目录，生成去重、排序、禁用状态一致的选择项。                                                         |
| UI          | `packages/app/src/components/add-project-flow.tsx`   | 250ms 输入防抖、查询状态、结果渲染、键盘选择、添加项目和错误反馈。                                                         |
| 浏览器契约  | `packages/app/e2e/browser/add-project-flow.spec.ts`  | 真实浏览器、真实 daemon、真实文件系统的 Add Project 流程。                                                                 |

### 2.2 已有测试资产

- `packages/server/src/utils/directory-suggestions.test.ts`：搜索引擎的临时目录测试，覆盖查询解析、排序、隐藏目录、Git ignore、符号链接、限制和缓存等行为。
- `packages/server/src/server/project-directory-service.test.ts`：New directory 的创建和回滚，作为相邻流程的回归保护。
- `packages/protocol/src/messages.stream-parsing.test.ts`、`packages/protocol/src/messages.project-command-center.test.ts`：Wire 消息解析与创建目录 RPC 契约。
- `packages/client/src/daemon-client.test.ts`：目录 suggestions request/response 相关性、字段和创建目录 dotted RPC。
- `packages/app/src/add-project-flow/model.test.ts`、`options.test.ts`：页面转移、键盘索引和选项构建的纯逻辑测试。
- `packages/app/e2e/browser/add-project-flow.spec.ts`：目录搜索键盘提交、离线主机、双主机、返回导航、布局和 New directory 的真实流程。
- `packages/server/src/server/daemon-client.e2e.test.ts`：真实 daemon 的目录搜索、根目录浏览、空查询、越界查询和结果格式。

## 3. 行为契约

### 3.1 用户流程

1. 用户打开 Add Project。
2. 没有可用主机时显示主机选择页；只有一个可用主机时直接进入 method 页；离线主机不参与选择。
3. 选择 `Search for directory` 后进入 `directory-search` 页，输入框获得焦点。
4. 输入经过固定防抖窗口后，客户端向选中的 daemon 查询。每次查询必须带 `hostId`、`query` 和唯一 `requestId`。
5. UI 显示 daemon 返回的目录和本地推荐目录，按稳定规则去重；目录搜索结果不在客户端重新解释路径语法或重新过滤 daemon 结果。
6. 用户可用鼠标、触摸或 `ArrowUp`/`ArrowDown`/`Enter` 选择结果。提交期间禁用输入和重复提交。
7. 成功时关闭弹层并进入 `/new`，路由携带 `serverId`、`projectId`、目录路径和显示名称；项目进入项目列表，Workspace 仍由新建 Workspace 页面创建。
8. 失败时保留当前页、输入和可操作错误；用户修正查询或再次提交即可恢复。

### 3.2 搜索语义

- 主目录搜索使用 daemon home 作为 root，返回绝对路径；`~`、绝对路径和带前缀的查询按 rooted policy 解析。
- Workspace/目录上下文搜索使用传入 `cwd` 作为 root，返回相对路径；空查询只浏览直接子目录。
- Add Project 只请求目录：`includeDirectories: true`、`includeFiles: false`、默认 `limit: 30`。这些值必须集中定义或由接口参数传入，禁止散落魔术数字。
- 搜索引擎负责模糊匹配、后缀匹配、大小写归一化、稳定排序、最大深度和最大扫描数。排序相同的结果使用稳定的路径和类型次序。
- 发现阶段跳过 `.git`、构建产物、依赖目录、Git ignored 和未获允许遍历的隐藏目录；用户明确输入的精确路径只检查 root containment 和实际 entry 类型。
- 所有路径在 `realpath` 后检查 `isPathInsideRoot`。符号链接不能把搜索结果带出 root；不存在、非目录、权限错误和越界输入返回空结果或明确 RPC error，不抛出未处理异常。
- 结果上限、最大深度、最大扫描量、缓存 TTL 和防抖时间均为命名配置项，可在测试中覆盖。

### 3.3 状态和失败反馈

| 状态          | 用户可见结果                                     | 可执行动作               |
| ------------- | ------------------------------------------------ | ------------------------ |
| 初始/空查询   | 推荐目录或空状态；不发送无意义的 home 全盘扫描。 | 输入查询或选择推荐目录。 |
| 查询中        | `Loading...`，保留上一页结构，不提交旧结果。     | 等待、修改查询或返回。   |
| 成功          | 稳定的目录行，活动项明确。                       | 点击或键盘提交。         |
| 无结果        | 明确的 empty 文案。                              | 修改查询、返回。         |
| 查询失败/断线 | 当前页显示 actionable error，错误不会只写日志。  | 重试或返回。             |
| 添加中        | 进度文案，输入不可编辑，重复提交被忽略。         | 等待。                   |
| 添加失败      | 仍在当前页显示添加失败原因，输入和返回可用。     | 修正路径、重试或返回。   |
| 添加成功      | 进入新 Workspace 路由并显示项目。                | 继续 Workspace 配置。    |

## 4. 设计约束

### 4.1 分层和单一职责

- 搜索引擎只处理文件系统和搜索策略，不依赖 React、daemon session 或 UI 文案。
- session handler 只负责校验后的 RPC 入参、选择搜索配置和响应映射；不要在这里复制遍历逻辑。
- client 只负责传输和相关性，不在 response 到达后再次筛选路径。
- `model.ts`/`options.ts` 保持纯函数，页面栈和选项规则可在 Vitest 中独立验证。
- component 只编排状态、查询和用户动作；新的复杂查询/提交逻辑先抽到可注入的 adapter 或纯函数。
- 所有外部依赖通过现有接口注入：临时文件系统代替 `fs` mock，真实 daemon 代替 RPC mock，浏览器 E2E 使用隔离 `PASEO_HOME`。

### 4.2 协议兼容

- 保留现有 `directory_suggestions_request`/`directory_suggestions_response` 对，response 继续发送 `directories` 投影和 typed `entries`。
- 新增字段只能是 optional，并提供合理默认；不删除、不收窄已有字段，不在 Wire schema 中使用 `.transform()`、`.catch()` 或 `.preprocess()`。
- 目录搜索功能通过已有可用主机/Add Project 能力进入。若后续需要单独 capability，先增加 `server_info.features.*`，在一个入口集中 gate，再让下游读取干净数据。
- 不增加新的 flat RPC 名称。真正的新 RPC 遵循 `domain.operation.request`/`.response`；旧名称迁移时在代码位置添加带版本和移除日期的 `COMPAT(...)` 标记。
- 新 app 连接旧 daemon、旧 app 连接新 daemon 都要有解析路径；兼容性测试必须说明两个方向的结果。

### 4.3 平台和 UI

- 共享组件默认跨平台；DOM 访问只在 `isWeb` 分支中使用。
- 不使用 `Platform.OS` 推断布局，不使用 `onPointerEnter`/`onPointerLeave`；键盘、触摸和桌面鼠标路径分别按现有 Add Project 模式测试。
- 复用现有 `FlowRow`、`ThemedTextInput`、testID、错误和进度样式。结果行、输入框、footer 使用稳定尺寸，查询结果变化不能造成 footer 布局跳动。
- 错误必须渲染在当前上下文；`Alert.alert()`、console 或日志不能作为 Web/Electron 的唯一反馈。

## 5. TDD 工作规则

每个切片只做一件行为：先写一个名称明确的失败测试，再写能通过它的最小实现，最后在所有测试保持绿色时重构。一个切片的完整记录格式如下：

```text
RED      添加一个描述用户/API 行为的测试，运行目标文件，确认失败原因是缺少目标行为。
GREEN    写最小生产代码，只解决该测试；不提前加入未验证的优化。
REFACTOR 运行同一测试后消除重复、命名意图、提取接口；每次小重构后立即重跑。
EVIDENCE 记录命令、通过数量、关键输出和仍存在的风险。
```

规则：

- 测试描述行为，避免断言私有函数、调用次数或实现细节，除非调用次数就是并发/幂等契约。
- 测试必须确定性：固定临时目录结构、固定 query、固定排序断言；不使用随机等待、条件断言或 `toBeTruthy()`。
- 先使用真实临时文件系统、真实 parser、真实 daemon；确需隔离时注入 adapter，不 mock `fs` 或 WebSocket 协议本身。
- 一个测试只引入一个最小行为。边缘情况在基础行为稳定后逐个加入。
- 每一轮 Red/Green/Refactor 后只运行受影响的测试文件；不要在本地运行整个 workspace 测试套件。
- 任何失败先修复生产代码或测试夹具的根因，禁止跳过、条件执行、放宽断言或删除回归测试。

## 6. 垂直切片实施顺序

### Slice 0：建立基线和测试夹具

**目标**：在修改行为前确认当前实现、测试入口和隔离环境。

1. **RED**：补一个最小的搜索引擎行为测试：`returns a matching child directory for a simple query`，使用 `mkdtemp` 创建 `projects/paseo`，断言只返回预期目录。
2. **GREEN**：若当前实现已满足，记录“基线已绿”；若基线分支失败，补齐最小 `searchDirectoryEntries` 入口。
3. **REFACTOR**：把临时 root、清理、`searchRelativeDirectoryEntries` helper 放入测试文件共享 helper；保证每个测试独立清理。
4. **证据**：`npx vitest run packages/server/src/utils/directory-suggestions.test.ts --bail=1`。

### Slice 1：最小目录发现和类型过滤

**目标**：只发现目录，并明确 file/directory 过滤契约。

1. **RED**：增加 `returns directories and excludes files when includeFiles is false`。
2. **GREEN**：实现最小 `readdir -> stat -> DirectorySuggestionEntry` 映射，默认只返回目录。
3. **RED**：增加 `returns files only when includeFiles is true`。
4. **GREEN**：补 `includeFiles` 分支，保留 `includeDirectories` 的独立语义。
5. **RED**：增加 `returns an empty list when both entry kinds are disabled`。
6. **GREEN**：在构建搜索输入时短路为空。
7. **REFACTOR**：提取 `getEntryKind`/entry filter，统一 `DirectorySuggestionEntry` 类型；避免 server session 重复把 entries 转成目录列表。
8. **验证**：目标 Vitest 文件；随后运行 `npm run typecheck --workspace=@getpaseo/server`。

### Slice 2：查询规范化、root containment 和结果格式

**目标**：确保搜索路径只在用户授权 root 内。

1. **RED**：增加 `returns relative paths for a workspace query`。
2. **GREEN**：实现 `pathFormat: relative` 的 root-relative 输出。
3. **RED**：增加 `accepts a rooted query with a configured alias`。
4. **GREEN**：支持 `rootAliases`、`~` 和 slash normalization。
5. **RED**：增加 `does not return a path outside the search root`、`does not follow an escaping symlink` 和 `returns no result for a missing root`。
6. **GREEN**：对解析后的路径执行 `realpath` 和 `isPathInsideRoot`，失败统一返回空结果。
7. **REFACTOR**：集中 `parseQuery`、`resolveDirectory` 和 containment helper；所有路径错误使用统一的可测试结果。
8. **验证**：增加 daemon E2E 中的 inside/outside 查询断言，确认真实 WebSocket 的输出仍为 relative/absolute 约定。

### Slice 3：匹配、排序和上限

**目标**：让用户在固定结果窗口内获得可预测的最佳候选。

1. **RED**：增加 `ranks an exact segment before a prefix and substring match`。
2. **GREEN**：实现最小 exact/prefix/substring 分层。
3. **RED**：增加 `matches a fuzzy subsequence in the final path segment`。
4. **GREEN**：补 fuzzy score，并按 score、深度、路径排序。
5. **RED**：增加 `matches a path suffix only at segment boundaries`。
6. **GREEN**：实现 `matchMode: suffix`，避免 `app` 匹配 `myapp` 的错误。
7. **RED**：增加 `returns deterministic results and respects the configured limit`。
8. **GREEN**：实现去重、稳定排序和 `limit` 归一化，限制最大值。
9. **REFACTOR**：把 rank 字段和比较器保持纯函数；命名 `DEFAULT_LIMIT`、`MAX_LIMIT` 等配置，测试覆盖 limit=0、超大值和相同 rank。
10. **验证**：同一 fixture 连续运行两次，断言完整数组相等；记录结果顺序。

### Slice 4：空查询、子目录浏览和过滤策略

**目标**：区分“搜索”与“浏览”，避免空 query 触发无界扫描。

1. **RED**：增加 `returns no home entries for a blank absolute search`。
2. **GREEN**：实现 `blankQueryBehavior: none`。
3. **RED**：增加 `lists only immediate workspace children for a blank query`。
4. **GREEN**：实现 `blankQueryBehavior: children` 和 query root 的直接子项。
5. **RED**：增加 `skips ignored build and dependency directories during discovery`。
6. **GREEN**：集中 ignored directory names，发现阶段跳过分支。
7. **RED**：增加 `traverses only explicitly allowed hidden workspace directories` 和 `does not suggest hidden entries`。
8. **GREEN**：实现 `WORKSPACE_SEARCH_HIDDEN_DIRECTORIES` 的遍历白名单与结果过滤。
9. **RED**：增加 `keeps an explicitly named ignored path retrievable when it stays inside root`。
10. **GREEN**：将 discovery filter 与 exact retrieval filter 分离。
11. **REFACTOR**：在函数注释中保留 discovery/retrieval 分离的原因，避免后续把安全边界改成 UI 过滤。
12. **验证**：`packages/server/src/utils/directory-suggestions.test.ts` 与 `packages/server/src/server/daemon-client.e2e.test.ts` 目标测试。

### Slice 5：边界、权限和扫描性能

**目标**：限制资源消耗并把失败变成可诊断的空结果或 RPC error。

1. **RED**：增加 `stops scanning after maxEntriesScanned` 和 `stops descending after maxDepth`。
2. **GREEN**：实现扫描计数、深度边界和 round-robin 分支遍历。
3. **RED**：增加 `returns an empty result when a child disappears during traversal`。
4. **GREEN**：把 `ENOENT`、`ENOTDIR` 视为当前候选不可用，继续其他分支。
5. **RED**：增加 `does not expose raw permission or unexpected filesystem exceptions to the caller`。
6. **GREEN**：在 session handler 统一捕获并填充 response `error`，不发送半截 entries。
7. **RED**：增加缓存失效测试：`reuses a listing within ttl and observes a changed directory after invalidation`；Windows 路径单独标记平台行为。
8. **GREEN**：只在现有 cache adapter/TTL 约束内实现缓存，不让缓存改变结果排序或安全过滤。
9. **REFACTOR**：把 TTL、最大 cache entries、平台能力命名为配置常量，清理重复错误映射。
10. **验证**：单测记录扫描上限；若修改热点遍历，补一次基准结果（fixture 大小、耗时、扫描数），不以单次 wall-clock 断言代替行为断言。

### Slice 6：Protocol schema 和 client 相关性

**目标**：把搜索引擎结果安全地传到 app，并防止旧响应覆盖新查询。

1. **RED**：在 `packages/protocol/src/messages.stream-parsing.test.ts` 增加 response 缺少 `entries` 时仍可解析，并将其归一为调用方可消费的空数组。
2. **GREEN**：保持 `entries` optional/default，保留 `directories` 字段；只在显式 normalization 层产生运行时默认。
3. **RED**：在 `packages/protocol/src/messages.project-command-center.test.ts` 增加 request 的最小 query、可选 cwd、kind filter、matchMode 和 limit 解析测试。
4. **GREEN**：实现纯 Zod wire schema，字段范围保持向后兼容。
5. **RED**：在 `packages/client/src/daemon-client.test.ts` 增加 `resolves only the response with the matching requestId` 和 `returns typed directory entries`。
6. **GREEN**：让 `getDirectorySuggestions` 使用现有 correlated request helper；不要在 client 层复制搜索算法。
7. **RED**：增加 `rejects a malformed response without leaking a pending request`。
8. **GREEN**：复用现有 response validator 和 pending cleanup。
9. **REFACTOR**：将 payload 类型从 protocol 推导，删除重复的 directories/entries 类型声明。
10. **验证**：协议测试、client 定向测试；若 protocol declarations 变化，先执行 `npm run build:client` 再继续 app/server 类型检查。

### Slice 7：daemon handler 的两个搜索上下文

**目标**：验证 session 为 home 和 workspace 选择正确参数，不把路径策略放到 UI。

1. **RED**：在 daemon E2E 增加 `returns absolute directories for a home search`。
2. **GREEN**：使用 daemon home 作为 root、rooted policy 和绝对格式。
3. **RED**：增加 `returns relative directories for a workspace search and respects gitignore`。
4. **GREEN**：使用 `cwd`、slashes policy、children blank behavior、Git ignore 和 workspace hidden allowlist。
5. **RED**：增加 `returns a correlated error response when the requested root is unavailable`。
6. **GREEN**：统一 session error response：`directories: []`、`entries: []`、`error`、原 requestId。
7. **REFACTOR**：提取 search context 配置构建函数；handler 只做解构、调用和 emit。
8. **验证**：`npx vitest run packages/server/src/server/daemon-client.e2e.test.ts --bail=1`；不重启主 daemon，使用测试隔离 daemon。

### Slice 8：Add Project 纯状态和选项

**目标**：先在无 React 环境下确定页面转移、选项合并和键盘行为。

1. **RED**：在 `model.test.ts` 增加 `opens directory-search with a clean query and active index`。
2. **GREEN**：只增加 `openDirectorySearchPage` 的最小状态。
3. **RED**：增加 `resets active index and error when the directory query changes`。
4. **GREEN**：让 `setAddProjectPageInput` 对 search page 清空错误并重置 index。
5. **RED**：增加 `moves over selectable directory rows and wraps at both ends`。
6. **GREEN**：复用 `moveAddProjectSelection`，禁用项不能成为活动项。
7. **RED**：在 `options.test.ts` 增加 `merges recommended and daemon directories once with stable order`。
8. **GREEN**：实现 path identity 去重和显示/提交路径分离。
9. **RED**：增加 `does not locally reinterpret a daemon result for a correlated query`。
10. **GREEN**：让 options builder 只处理展示合并，不解析 daemon query 语法、不做第二次 filesystem filter。
11. **REFACTOR**：把 path option 的 id、path、displayPath、disabled 规则命名清楚；去除推荐目录与 server 目录的重复判断。
12. **验证**：`npx vitest run packages/app/src/add-project-flow/model.test.ts packages/app/src/add-project-flow/options.test.ts --bail=1`。

### Slice 9：UI 查询生命周期

**目标**：把纯状态接入 Add Project modal，并覆盖成功、空、加载和失败状态。

1. **RED**：添加 browser test `directory search focuses input and renders a real matching directory`。
2. **GREEN**：接入现有 `useFetchQuery`、host client 和 `directory-search` rows，最小展示路径。
3. **RED**：添加 `debounces directory requests and ignores data for an older query`。
4. **GREEN**：使用 `queryKey: [flow, hostId, debouncedQuery]`、250ms 命名配置和 query equality guard。
5. **RED**：添加 `shows loading and then empty state without layout collapse`。
6. **GREEN**：渲染已有 testID 状态节点，固定 results/footer 容器尺寸。
7. **RED**：添加 `keeps a retryable query error visible in the same modal`。
8. **GREEN**：把 query error 渲染为 app UI，retry 通过重新输入或查询 key 触发。
9. **RED**：添加 `keeps the selected host in the request when another host is connected`。
10. **GREEN**：query key、client 和 submit route 全部使用当前 `hostId`，不依赖全局当前主机。
11. **REFACTOR**：将 query state、page status 和 rows 的映射抽成小函数；组件只保留编排逻辑。
12. **验证**：目标 browser spec；覆盖 Web 与 Electron web 入口，Native 的键盘捕获保持现有实现。

### Slice 10：提交、幂等和路由

**目标**：把一个真实结果完成为 Project，并处理用户动作失败。

1. **RED**：添加 `keyboard directory search adds the selected Project and opens a new workspace route`。
2. **GREEN**：调用现有 `openProject`，成功后使用 `buildNewWorkspaceRoute`，不在 UI 直接写项目存储。
3. **RED**：添加 `does not submit twice while add project is pending`。
4. **GREEN**：使用已有 `submissionInFlightRef` 和 `isSubmitting`，并断言 daemon 只收到一次 add request。
5. **RED**：添加 `shows directory not found and keeps the search page after add failure`。
6. **GREEN**：映射 `directory_not_found` 和通用异常为当前页错误，恢复 `isSubmitting: false`。
7. **RED**：添加 `returns from a result page without losing the query and closes only at the root`。
8. **GREEN**：复用页面栈 `backAddProjectPage`，保证 Escape、Back、鼠标返回一致。
9. **REFACTOR**：集中 `openAddedProject` 的成功/失败状态转换，避免 directory-search、browse、其他入口复制提交逻辑。
10. **验证**：真实浏览器 + 真实 daemon + 隔离项目清理；断言 URL、serverId、projectId、dir、显示名称和项目注册结果。

### Slice 11：多主机、断线和相邻流程回归

**目标**：证明搜索能力按 host 隔离，错误不会污染其他页面。

1. **RED**：添加 `searches the selected secondary host and opens its project`，使用 `startIsolatedHostDaemon` 与临时目录。
2. **GREEN**：确保 host client、request 和结果都从页面当前 `hostId` 派生。
3. **RED**：添加 `offline hosts are excluded and do not force host selection`。
4. **GREEN**：沿用 available host 过滤，不在目录搜索页兜底访问离线 host。
5. **RED**：添加 `shows a retryable error when the selected host disconnects during search`。
6. **GREEN**：显示 query error，保留输入；连接恢复后重新触发查询。
7. **RED**：运行现有 GitHub 和 New directory E2E，先记录任何回归失败。
8. **GREEN**：只修复共享查询状态、页面栈或 test helper 的根因；不为相邻流程复制目录搜索实现。
9. **REFACTOR**：提取 host/daemon fixture 清理，确保每个测试移除项目记录、关闭 client、删除临时目录。
10. **验证**：`npm run test:e2e --workspace=@getpaseo/app -- e2e/browser/add-project-flow.spec.ts`；必要时分离单个 test title 调试。

### Slice 12：协议漂移和跨平台证据

**目标**：在交付前锁住版本漂移和平台边界。

1. **RED**：增加旧 response（只有 `directories`、没有 `entries`）的解析测试，以及新 response 被旧字段读取的兼容性说明。
2. **GREEN**：保留 optional `entries` 的兼容投影，在非 Wire 层做默认归一化。
3. **RED**：在 POSIX 测试中覆盖 `/tmp`、`~`、slash；在 Windows 运行器覆盖 drive path、反斜杠和大小写边界。
4. **GREEN**：使用 `path`/`win32` 的现有实现，不引入平台专属字符串拼接。
5. **RED**：浏览器验证 Web/Electron 的错误渲染；移动端手工或 Maestro 验证输入、返回、键盘/触摸提交。
6. **GREEN**：只添加平台门控或 Metro 扩展文件，遵守 `docs/expo-router.md`、`docs/hover.md` 和 `docs/mobile-testing.md` 的既有模式。
7. **REFACTOR**：删除测试专用分支和临时日志；补齐 `docs/architecture.md` 或对应主题文档中真正改变的跨包约束。
8. **验证**：记录平台矩阵、旧/新版本组合、失败反馈截图或 Playwright 输出。

## 7. 测试矩阵和命令

### 7.1 定向测试

按改动范围选择命令，保持每次运行小而确定：

```bash
# server 搜索引擎
npx vitest run packages/server/src/utils/directory-suggestions.test.ts --bail=1

# server 真实 daemon / WebSocket
npx vitest run packages/server/src/server/daemon-client.e2e.test.ts --bail=1

# protocol
npx vitest run packages/protocol/src/messages.stream-parsing.test.ts packages/protocol/src/messages.project-command-center.test.ts --bail=1

# client
npx vitest run packages/client/src/daemon-client.test.ts --bail=1

# app 纯逻辑
npx vitest run packages/app/src/add-project-flow/model.test.ts packages/app/src/add-project-flow/options.test.ts --bail=1

# app 真实浏览器
npm run test:e2e --workspace=@getpaseo/app -- e2e/browser/add-project-flow.spec.ts
```

### 7.2 依赖构建和静态检查

协议或跨 workspace 类型变化时，先按依赖顺序构建：

```bash
npm run build:client
npm run build:server
npm run typecheck
npm run lint
npm run format:check
```

格式化使用仓库脚本：

```bash
npm run format:files -- add-project-directory-search-plan.md
```

文档改动本身不需要启动主 daemon；涉及运行验证时使用测试 fixture 或其他端口的隔离 daemon，不能重启 `6767` 上的主 daemon。

### 7.3 断言质量

- 断言完整 response shape、完整路径数组、错误代码/可见文案和最终路由参数。
- 断言失败后的用户动作：输入仍在、返回可用、重试可触发、重复提交被阻止。
- 断言资源清理：临时目录、项目记录、client、isolated daemon 全部释放。
- 性能测试记录扫描数、结果上限和缓存命中；不使用不稳定的单次耗时阈值替代行为测试。

## 8. 三轮递归验证

### Round 1：功能闭环

1. 执行受影响的 unit、protocol、client 和 daemon E2E 定向测试。
2. 修复失败后只重跑失败文件，再重跑本轮全部定向测试。
3. 记录 Red 测试曾经验证的缺口、Green 实现和 Refactor 后的结果。

### Round 2：集成和静态质量

1. 重新构建 `build:client`/`build:server`（按实际依赖选择）。
2. 执行 `npm run typecheck`、`npm run lint`、`npm run format:check`。
3. 运行 Add Project browser spec，至少覆盖默认主机、第二主机、离线主机、无结果、查询错误、添加错误和成功路由。
4. 修复任何跨包声明、testID、布局或清理问题后，重复本轮命令。

### Round 3：独立回归和平台证据

1. 在干净的隔离 `PASEO_HOME` 下重新运行真实浏览器流程，避免依赖前两轮缓存。
2. 检查 Web、Electron、POSIX 和 Windows 的路径/错误行为；移动端执行对应输入与返回冒烟。
3. 运行相邻的 GitHub clone、Browse、New directory、项目列表和新 Workspace 流程，确认共享状态没有回归。
4. 检查 `git diff`、未提交临时文件、测试资源清理和文档链接；保存命令输出、截图、平台矩阵和剩余风险。

## 9. 无法执行时的替代方案

按可行性从高到低采用以下三种方案，并在证据中标明实际使用的方案：

1. **完整路径**：本机启动测试所需的隔离 daemon，执行 unit + protocol/client + daemon E2E + app Playwright；适用于依赖完整 Node、Chromium 和文件系统的环境。
2. **部分路径**：若无法启动浏览器或 daemon，先执行真实临时文件系统的 server unit、protocol parser、client transport 和 app model/options 测试；把未覆盖的浏览器行为列为阻塞项，不能宣称功能完成。
3. **CI/人工路径**：若本机缺少目标平台或权限，在 CI 的 Linux/Windows 矩阵运行 daemon 和 Playwright；由设备或 Maestro 测试补 iOS/Android，提交原始输出、截图和失败日志。

无法执行某个命令时，先完成不依赖该环境的切片，随后记录：失败命令、环境原因、已执行覆盖、剩余风险和采用的替代方案。禁止用跳过测试、条件 skip 或 mock 真实边界来伪造通过。

## 10. 交付清单

### 行为和代码

- [ ] 搜索引擎覆盖最小查询、路径查询、空查询、模糊/后缀匹配、结果排序、上限、越界、symlink、隐藏/Git ignored、权限和消失 entry。
- [ ] daemon 明确区分 home absolute search 与 workspace relative search，错误 response 保留 requestId。
- [ ] protocol/client 保持旧字段解析能力，新增字段可选且没有 schema transform。
- [ ] Add Project 只向当前 host 查询，防抖和相关性防止旧结果覆盖新 query。
- [ ] UI 覆盖 pending、success、empty、failure；失败可见且可恢复，重复提交幂等。
- [ ] 成功路由和项目/Workspace 数据与现有 `openProject`、registry、`buildNewWorkspaceRoute` 契约一致。

### 测试和 QA

- [ ] 每个行为按 Red -> Green -> Refactor 完成并记录。
- [ ] unit、protocol、client、daemon E2E、app browser E2E 通过；测试使用真实依赖或明确注入 adapter。
- [ ] 完成三轮递归验证，保存命令输出和失败修复记录。
- [ ] 完成 Web、Electron、POSIX、Windows、iOS、Android 的适用平台说明。
- [ ] 项目记录、临时目录、client 和 isolated daemon 无泄漏。

### 文档和变更控制

- [ ] 代码注释只解释安全边界、兼容性或缓存/遍历原因，不复制实现细节。
- [ ] 行为或协议变化同步到拥有该主题的 `docs/` 文档；遵守“一个事实一份文档”。
- [ ] `rg "COMPAT\\("` 检查新增兼容 shim 是否有名称、版本和移除条件。
- [ ] `git diff --check`、格式、lint、typecheck 均通过，计划文档中的命令与仓库脚本一致。
- [ ] PR 说明列出变更文件、测试命令、三轮结果、平台证据、性能数据和剩余风险。

## 11. 风险和停止条件

| 风险                               | 预防                                                   | 停止条件                                 |
| ---------------------------------- | ------------------------------------------------------ | ---------------------------------------- |
| 搜索跨越 root 或 symlink 泄漏      | `realpath` 后 containment；unit + daemon E2E           | 任一越界用例返回路径，停止发布。         |
| 旧 response/旧 daemon 造成解析失败 | optional entries、directories projection、双向兼容测试 | 任一版本组合无法解析，停止协议发布。     |
| 快速输入出现旧结果或错误结果       | query key + query equality guard + requestId           | 可稳定复现 stale result，停止 UI 发布。  |
| 大 home/monorepo 卡顿              | limit、max depth、scan cap、缓存和基准                 | 超出资源预算或阻塞 UI，先修复再继续。    |
| 失败只写日志、用户无法恢复         | 渲染 error + retry/返回动作                            | 失败状态无可见操作，停止 QA。            |
| 项目或 daemon 测试泄漏状态         | fixture ownership、afterEach 清理、隔离 `PASEO_HOME`   | 后续测试看到前一测试项目，停止合并。     |
| Native/Web 行为分叉                | 平台门控规则、browser + device evidence                | 任一受支持平台崩溃或无法提交，停止发布。 |

只有在交付清单全部完成、停止条件全部解除、三轮验证证据可复核时，目录搜索计划才算完成。
