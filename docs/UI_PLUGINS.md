# UI 插件开发指南(形象工坊)

Kun 的「形象工坊」允许任何人制作并安装自己的吉祥物形象包,
换掉工作台里的泳动小鸟、欢迎/睡觉/坐着的状态形象、会话出没彩蛋、完成庆祝,甚至主题色和进行中文案。

**iKun 模式就是最好的例子**:它不是硬编码的功能,而是一个随应用分发、
首次启动自动安装的 UI 插件(id 为 `ikun`,见 `src/main/ui-plugin-bundled.ts`)。
你在形象工坊里看到的 iKun 卡片,与任何第三方插件完全同级 —— 可以启用、停用,也可以删除。
(它额外享有一套手工制作的运球/快攻/喝奶茶动画,这部分由应用针对 `ikun` id 特殊点亮,
第三方插件则使用通用的泳动/状态动画框架。)

**一个 UI 插件就是一个文件夹**:`manifest.json` + 若干图片。没有任何代码 ——
插件是纯声明式的,应用不会执行插件内的任何脚本或样式。

```
my-plugin/
├── manifest.json
└── img/
    ├── swim.png
    ├── greet.png
    └── …
```

安装方式:`设置 → 形象工坊 → 安装插件文件夹…`,选中插件目录即可。
应用会校验 manifest 后把 **manifest 和被引用到的图片** 复制进应用数据目录
(`~/.kun/ui-plugins/<id>/`),源目录中的其它文件一律不会被复制。

官方示例见 [`examples/ui-plugins/starlight/`](../examples/ui-plugins/starlight/)。

## manifest.json 参考

```json
{
  "id": "starlight",
  "name": "星夜 Kun",
  "version": "1.0.0",
  "author": "你的名字",
  "description": "一句话介绍(可选,≤240 字符)",
  "figures": {
    "swim": "img/bird.png",
    "surf": "img/surf.png",
    "greet": "img/greet.png",
    "sleep": "img/sleep.png",
    "sit": "img/sit.png",
    "run": "img/run.png",
    "toggleIcon": "img/icon.png"
  },
  "labels": {
    "zh": { "working": "巡航中…" },
    "en": { "working": "Cruising…" }
  },
  "tokens": {
    "light": { "--ds-accent": "#7a5fd0" },
    "dark": { "--ds-accent": "#a78ff0" }
  },
  "features": { "cameos": true }
}
```

### 字段规则

| 字段 | 必填 | 规则 |
|---|---|---|
| `id` | ✓ | 2–40 位小写字母/数字/连字符;保留字 `default` / `kun` / `on` / `off` / `none` 不可用(`ikun` 被预装示例占用,重装会覆盖它) |
| `name` | ✓ | ≤60 字符 |
| `version` | ✓ | 语义化版本,如 `1.0.0` |
| `author` / `description` | | ≤80 / ≤240 字符 |
| `figures` | ✓ | 至少一个槽位;路径必须是插件目录内的相对路径,仅 `png/webp/jpg/jpeg/gif` |
| `labels` | | 仅 `zh` / `en` 两种语言;键限 `working` / `workingSprint` / `workingDive` / `workingSurf`;每条 ≤24 字符 |
| `tokens` | | 仅 `light` / `dark` 两个主题;键限 `--ds-*`;值禁止 `url()`、分号、花括号等(只允许颜色/渐变安全字符);总数 ≤60 |
| `features.cameos` | | `true` 时启用主会话两侧的不定时出没彩蛋 |

### 形象槽位(figures)

所有图片建议 **主体朝左**、透明背景、最长边 512px 左右。
缺失的槽位会回退到默认 Kun 美术或按下表的回退链借用你的其它槽位。

| 槽位 | 出现在哪里 | 缺失时回退 |
|---|---|---|
| `swim` | 回合进行中的泳动动画主体(推进/冲刺/潜入)、各处的最终兜底 | 默认 Kun 鸟 |
| `surf` | 泳动动画的冲浪姿态、庆祝「胜利巡游」 | `swim` |
| `greet` | 欢迎卡片、侧边栏轮播、出没「探头」、庆祝「跃起欢呼」 | `swim` |
| `sleep` | 运行时唤醒页、侧边栏轮播、出没「打盹」 | `sit` → `swim` |
| `sit` | 选择工作区空状态、侧边栏轮播、出没「歇脚」、庆祝「举杯」 | `greet` → `swim` |
| `run` | 出没「横穿/对穿」、庆祝「胜利巡游」 | `surf` → `swim` |
| `toggleIcon` | 形象工坊里的预览小图 | `swim` → `greet` … |

### 体积限制

- `manifest.json` ≤64KB;单张图片 ≤2MB;全部图片合计 ≤24MB。

## 安全模型(为什么这样设计)

1. **无代码执行**:插件不含 JS/HTML/CSS 文件;即使放了也不会被复制安装。
2. **白名单安装**:只复制 manifest 与被 `figures` 引用的图片;路径禁止 `..`、绝对路径与反斜杠。
3. **图片经主进程读取后以 data URL 注入**,渲染层不直接访问插件目录。
4. **主题 token 白名单**:键名必须是 `--ds-*`,值经过字符集校验,样式文本由应用生成,
   并锚定在 `html[data-ui-plugin='<id>']` 下,停用即移除。

## 调试技巧

- 安装失败时,设置页会列出 manifest 的具体校验错误。
- 修改插件后重新执行一次「安装插件文件夹…」即可覆盖更新(同 id 覆盖安装)。
- 可用的 `--ds-*` token 清单见 `src/renderer/src/styles/base-shell.css` 顶部的
  `:root` 与 `[data-theme='dark']` 两个变量块;最常用的是
  `--ds-accent` / `--ds-accent-soft` / `--ds-selection`。
