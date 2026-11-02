# dsh-sidebar-memo

右侧边栏的「备忘录」：一张和模型共写的清单，一个用户自己立下的目标簿，加上由 AI 落笔的日记。它注册进 DSH 自带的右侧边栏首页，和「工作区文件」「新建终端」「浏览器」共用同一套胶囊按钮、图标位和选中动画。

## 功能

**清单**。一条待办可以是只有一行标题的小事，也可以带一整段备注和一组步骤：

- 标题一行，长标题自然折行。
- 备注放长内容。`学院：…`、`条件：…`、`材料：…` 这类行会自动识别成键值排成两列；折叠时副行显示这些键本身。
- 步骤是一列可勾选的小项，副行显示进度。
- 旧数据不需要整理：第一行当标题、其余进备注，加载时自动升级。
- 就地编辑：双击标题改标题，展开备注后点「编辑」改正文；回车提交，Esc 放弃。

**目标**。第二个页签里立一个目标：一句话，外加一句可选的衡量标准；时间这类条件直接写进目标本身。目标卡会显示进度时间线和最近一次复盘。点「让 AI 复盘」，它会读取目标立下以来的全部日记，按设置里的口吻写一段点评：

- 毒舌：刻薄挖苦，只针对进度和行为，不碰外貌、家人、人格价值。
- 温柔：先接住情绪，再轻轻推一把。
- 机械：只列完成项、偏差和剩余天数。
- 自定义：按你自己写的一段口吻说明来。

点评调用一次模型的**最小推理档**（`reasoning.efforts[0]`），不占用会话轮次。立下目标时会自动跑第一次。

**日记**。跟在目标下面。正文由 AI 写，面板只读；你在下面把今天做了什么说给它，它用你的第一人称整理成一页，素材里有什么写什么，不编细节。可以按日期翻看，也可以在任意一天补一句。

**模型共写**。两个工具读写同一份数据。模型改动时面板会播放对应动画：新条目从下方淡入、勾选时描边、删除时收拢、写日记时装订线亮一下；标题行用一句话说明刚发生了什么，三秒后自己退场。

**全本地**。没有上传功能，日记和素材只留在这台机器上。

## 安装

把下面这段发给你的 AI 助手，让它替你装：

```text
把 https://github.com/Alamanes/dsh-sidebar-memo 装进我的 DSH profile：
1. 在 ~/.dsh/profiles/<profile>/package.json 的 dependencies 里加入
   "dsh-sidebar-memo": "github:Alamanes/dsh-sidebar-memo"
2. 把 "dsh-sidebar-memo" 加进同文件的 dsh.profile.bundles 列表
3. 在 profile 目录执行 pnpm install
4. 重启 DSH
```

本地开发时用 `link:` 代替 `github:`，改源码立即生效；前端那一半改动要重启 DSH 才会重新加载。

## 数据

全部在本地：

| 文件 | 内容 |
| --- | --- |
| `~/.dsh/storages/dsh-memo/todos.json` | 清单 |
| `~/.dsh/storages/dsh-memo/goals.json` | 目标、进度、复盘 |
| `~/.dsh/storages/dsh-memo/settings.json` | 复盘口吻与自定义说明 |
| `~/.dsh/storages/dsh-memo/diary/YYYY-MM-DD.md` | AI 写好的日记 |
| `~/.dsh/storages/dsh-memo/raw/YYYY-MM-DD.md` | 你口述的素材 |

目录可以用插件配置项的 `dataDir` 改。

## 工具

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `memo` | `op`（read/add/edit/done/del/clear）、`text`、`note`、`steps`、`id`、`goal` | 读或改清单；`goal` 是嵌套参数，见下 |
| `diary` | `op`（read/write）、`date`、`from`、`to`、`text`、`mode` | 读或写日记；`from`/`to` 一次读完一段 |

`memo.goal` 是用户自己的目标，和会话里的 Goal 工具不是一回事：

| 字段 | 说明 |
| --- | --- |
| `op` | `set` 新建或改写、`log` 记一笔进展、`review` 存点评、`done` 收尾、`drop` 删除 |
| `id` | 目标 ID，省略时作用于最新的未完成目标 |
| `text` / `note` | 目标本身、衡量标准（`set` 用） |
| `log` | 一条进展（`log` 用） |
| `review` | 点评正文（`review` 用） |

两个工具的 schema 都刻意做小：常在上下文里的东西，多一个属性就多一分开销。

## 项目结构

```text
src/index.js          宿主半边：提示段、两个工具、面板路由与两笔后台写作
src/host/store.js     清单 / 目标 / 日记 / 素材的文件存储与结构迁移
src/host/tools.js     memo 与 diary 两个工具
src/host/scribe.js    日记代笔与目标复盘的两段提示词
src/host/model.js     一次性模型调用：当前模型、最小推理档
lib/client.js         浏览器半边：右侧边栏标签类型与面板
lib/memo.css          面板样式，由 api/dsh-memo/style 提供给浏览器
lib/avatar.png        胶囊与标签页上的圆形标记
icon.png              插件列表里的图标
```

## 卸载

从 profile 的 `dsh.profile.bundles` 里删掉 `dsh-sidebar-memo`，再从 dependencies 删掉这一行，然后 `pnpm install` 并重启。数据目录会留着，要清掉就手动删 `~/.dsh/storages/dsh-memo`。

## 排错

| 现象 | 检查 |
| --- | --- |
| 首页没有「备忘录」 | 重启宿主后在控制台看 `dsh-sidebar-memo` 前缀的报错；确认依赖和 bundles 都写了 |
| 面板空白 | `api/dsh-memo/state` 是否 200，数据目录是否可写 |
| 没有样式 | `api/dsh-memo/style` 是否返回 CSS，`lib/memo.css` 是否在包里 |
| 复盘一直不出 | 模型设置里是否有可用模型；宿主日志里 `dsh-sidebar-memo: goal review failed` |
| 日记写不出来 | 同上，看 `diary write failed`；素材在 `raw/` 里不会丢 |

## 许可

MIT
