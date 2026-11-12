# 舞蹈教学视频制作台

把教师**全身演示**、**局部脚步**（带透明通道）与**参考线**组合进同一画面的编辑/导出系统。
后端用零依赖 Node.js 编排，真实渲染由 ffmpeg 完成；前端是原生 HTML/JS 画布编辑器。

## 运行

需要 ffmpeg/ffprobe（已使用 `~/.local/bin` 下的静态构建，7.0.2）。

```bash
node tests/make_fixtures.js   # 生成 4 个可验证素材（一次）
node engine/server.js         # 启动 http://localhost:8080
```

测试与演示：

```bash
node tests/engine.test.js             # 17 项引擎/像素级测试
node tests/transform_contract.test.js # 14 项坐标变换内核契约测试
node tests/equivalence.test.js        # 镜像后缩放+重开，对冻结帧的前后差分
node tests/e2e.test.js                # 上传→编辑→保存→后台渲染→下载 端到端
node tests/build_demo.js              # 构建并渲染完整演示工程
```

## 坐标变换内核（engine/transform）

镜像、缩放、裁剪与叠加坐标统一在可组合内核里，显式区分三个帧：

| 帧 | 含义 |
|----|------|
| `coded`（源像素） | 存储采样，可能带旋转元数据与非方像素 |
| `display`/`output`（工程画幅） | 直立方像素 display、步骤 tip、最终 output |
| `device`（显示窗口） | 预览画布像素，仅由 `ui.previewZoom` 决定 |

- `matrix.js` 仿射原语 · `lineage.js` 步骤谱系 · `sourceframe.js` coded→display
  （旋转+PAR，浏览器矩阵与 ffmpeg 滤镜同源）· `viewport.js` output→device ·
  `overlay.js` tip→output 放置。契约见 `engine/transform/CONTRACT.md`。
- 渲染（filters/render）、选区命中（web/app.js）、导出都只调用内核接口；
  入参非法即抛错，不以默认值伪装成功。
- `engine/space.js` 是保留给旧调用方的兼容适配层，`DanceSpace` 入口直接委托
  内核，没有第二套实现。

## 坐标空间模型（核心约束）

每个图层的每个可寻址像素都属于一个**具名空间**，变换步骤必须声明其 `inSpace`：

| 空间 | 含义 |
|------|------|
| `coded` | 存储的原始采样（`width×height`），可能带旋转元数据与非方像素 |
| `display` | 直立、方像素的编辑空间，由旋转元数据 + PAR 修正得到 |
| 镜像/裁切/缩放步骤 id | 该步骤产出的新末端空间（tip） |
| `output` | 最终工程画布，图层经 `placement` 放入 |

- 每一步的 `inSpace` 必须等于当前 tip，否则 `validateProject`/`computeLineage` 直接报错。
- 因此**先镜像后裁切**与**先裁切后镜像**是两条不同的步骤链：裁切矩形坐标处于不同空间，
  滤镜编译顺序也不同（`hflip,crop=...` vs `crop=...,hflip`）。见测试
  “mirror-then-crop and crop-then-mirror keep coordinates in their own spaces”。
- `engine/transform/lineage.js` 用仿射矩阵维护 display→任意末端空间的完整映射，
  参考线经同一矩阵精确变换；`engine/space.js` 仅作委托该内核的兼容适配层。

### 保留的素材信息（`engine/media.js`）

`probeMedia` 记录：原始 coded 尺寸、旋转元数据（解析 MP4 tkhd 显示矩阵）、
SAR/PAR 分数（如 `10:11`）、display 方像素尺寸、是否含 alpha、帧率、时长。

## 参考线的两种绑定（工程中分别表达）

- `mode:"follow"`：点坐标定义在**图层 display 空间**，镜像时随人体翻转（经图层 lineage 映射）。
- `mode:"fixed"`：点坐标定义在 **output 画布空间**，镜像时固定不动。

参考线渲染为带正确 straight-alpha 的 RGBA PNG 叠加层（自研 PNG 编码器 `engine/png.js`），
半透明边缘做 source-over 合成，不产生暗框。

## 透明度处理

- 图层不透明度用 `colorchannelmixer=aa=` 缩放 **straight alpha**，不做预乘，故无黑色描边。
- 透明素材（qtrle/VP9 alpha）边缘羽化测试验证：边缘像素为“源色+底色”的浅色混合，而非发黑。

## 时间线与源结束策略

每个叠加层有 `interval {start,end}` 与 `endPolicy`：

- `hide`：输入端 `-stream_loop -1` 循环，由 overlay 的 `enable='between(t,..)'` 完全掌控显隐。
- `freeze`：单次播放后 `tpad=stop_mode=clone` 克隆末帧，静帧保持到区间结束。

## 预览缩放只影响展示

`ui.previewZoom` 仅经 `engine/transform/viewport.js` 进入预览画布的 device
变换，渲染器从不读取它；测试以相同工程不同 zoom 导出，逐字节比对像素完全一致。

## 目录

```
engine/  transform/ 坐标变换内核（matrix·lineage·sourceframe·viewport·overlay，
                      契约见 CONTRACT.md）· space.js 旧入口兼容适配层
         media.js 探测 · project.js 工程模型/校验
         filters.js ffmpeg 滤镜图编译 · render.js 渲染执行 · png.js RGBA PNG
         mp4rotate.js 注入真实旋转元数据 · bitmap.js 测试位图/字体 · server.js HTTP API
web/     index.html style.css app.js（画布编辑器，只经 transform 内核取几何）
tests/   make_fixtures.js 合成素材 · engine.test.js · transform_contract.test.js
         equivalence.test.js（含 baseline/ 冻结帧）· e2e.test.js · build_demo.js
```

## 测试素材如何保证可验证

- `grid_master.mp4`：左侧 L（蓝）、右侧 R（橙）字母，160px 已知网格，角部锚点，移动舞步标记。
- `portrait_rot.mp4`：coded 1920×1080 + 真实 tkhd 旋转=90 元数据，直立后为 1080×1920。
- `ntsc_par.mp4`：coded 720×480、SAR 10:11，display 655×480，网格经 PAR 修正后单元格近正方形。
- `foot_alpha.mov`：qtrle RGBA，羽化 alpha 圆盘，专用于暴露暗边/预乘错误。
