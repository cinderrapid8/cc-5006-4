# 坐标变换内核契约（engine/transform）

把镜像、缩放、裁剪与叠加坐标从界面事件中抽离后的唯一坐标内核。渲染
（`engine/filters.js`、`engine/render.js`）、选区/命中测试（`web/app.js`）与
导出都只通过本模块的接口取几何，不再各自手算比例或翻转。

## 三个显式坐标帧

| 帧 | 常量 | 含义 | 归属模块 |
|----|------|------|----------|
| 源像素 | `SOURCE_FRAME = 'coded'` | 存储采样 `width×height`，可能带旋转元数据与非方像素 | `sourceframe.js` |
| 工程画幅 | `PROJECT_FRAMES = ['display','output']` | 直立方像素 display、各步骤 tip、最终 output 画布 | `lineage.js` / `overlay.js` |
| 显示窗口 | `DEVICE_FRAME = 'device'` | 预览画布的 backing-store/CSS 像素，只受 `previewZoom` 影响 | `viewport.js` |

调用方必须知道自己在哪两个帧之间换算；模块不提供“自动判断当前空间”的入口。

## 模块与接口

- `guards.js`：契约守卫。所有数值入参必须是有限数，尺寸/缩放必须为正；
  缺失或非法参数**抛错，不允许用默认值冒充成功**（无 `undefined → 0/identity`）。
- `matrix.js`：2D 仿射矩阵原语 `IDENTITY`/`mul`/`applyMatrix`/`invert`，
  Canvas 列主序 `[a,b,c,d,e,f]`，奇异矩阵求逆抛错。
- `lineage.js`：工程帧内的镜像/裁剪/缩放步骤谱系。
  - `computeLineage(media, steps) → { spaces, tip, displayW, displayH }`
  - 每个步骤的 `inSpace` 必须等于当前 tip，否则抛错；先镜像后裁剪与先裁剪后
    镜像因此是两条不可互换的链。
  - `mapDisplayToSpace` / `mapSpaceToDisplay` / `mapPolyline`。
- `sourceframe.js`：coded→display。
  - `codedToDisplayMatrix(media)`：旋转 + PAR 的仿射矩阵，浏览器预览与
    ffmpeg `transpose`/`scale` 滤镜共用同一份几何描述。
  - `sourceFrame(media) → { transpose, needsScale, scale, matrix }`。
  - `transposeFor(rotation)`：ffmpeg 滤镜片段（无旋转返回 `null`）。
- `viewport.js`：output→device。`deviceCanvasSize`、`projectToDeviceMatrix`、
  `deviceToProject`（指针命中，内部封装 zoom 除法）。`previewZoom` 只在这里出现。
- `overlay.js`：tip→output 放置。`placementMatrix`、`tipToOutput`、
  `outputToTip`、`followLineToOutput`（display 点经谱系到 tip 再加放置平移）。
- `index.js`（Node）/ `browser.js`（浏览器 `window.DanceTransform`）：聚合入口。

## 兼容适配层

`engine/space.js` 保留旧入口 `DanceSpace`（Node 导出与浏览器全局同名同义），
函数直接委托 `engine/transform`，不存在第二套实现。旧调用方无需修改即可运行；
新代码应直接依赖 `engine/transform`。

## 等价边界（重构前后）

`tests/baseline/` 冻结重构前“镜像后缩放”工程及其重开副本的渲染帧
（PPM）与标记/锚点测量（`manifest.json`）。`tests/equivalence.test.js`
用重构后内核重渲染并断言：

- 全帧差异像素占比 = 0，sha256 与冻结帧逐字节相同；
- 移动标记质心误差 ≤ 0.5 px；
- 角部锚点各通道误差 ≤ 1；
- 直接渲染与“保存→校验加载→重渲染”的 sha256 相同。

期望值全部来自签入的 manifest，而非测试内默认值。
