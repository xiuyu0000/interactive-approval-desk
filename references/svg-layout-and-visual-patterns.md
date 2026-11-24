# SVG Zero-Overlap Layout & Visual Component Patterns

This reference documents the exact geometric layout algorithms and reusable visual patterns for building zero-overlap interactive approval desks.

Scope (v3.7): these rules are for SVG you place by hand (`viewAll()`, item figures) and for the template's sandbox. The card pictures added in v3.7 (`vis`: versus, tree, scale, flow, seq, layers, bars) are drawn by the template with grid and flex layout from data, so they cannot overlap and need no coordinates; prefer them to hand-drawn item figures. (v3.7.1) They do not replace the sandbox: a round about structure still gets one, and a sandbox needs coordinates only for the optional panorama (`viewAll()`), because the template draws the swimlanes and per-entity views from `OBJ`, `FLOWS` and `PANO_EDGES` (Patterns B and C). Those views still have a fixed 1200 × 575 canvas: at most 5 objects per column, link labels up to 13 characters (`test.js` fails anything that leaves the canvas or overflows its label).

## 0. The Four Zero-Overlap Rules (moved from SKILL.md in v3.6)

The sections below give exact coordinate templates. The template's swimlane and ego views have their own collision-checked geometry (Patterns B and C below); Rules 1–4 apply whenever you place boxes by hand (`viewAll()`, item figures). Always apply these four layout rules when generating SVG diagrams:

- **Rule 1 - Order Nodes to Prevent Cross-Column X-Crossings**: Place upstream source entities in Column 1 (`x = 45..275`), processing/agent hubs in Column 2 (`x = 465..735`), and downstream outputs in Column 3 (`x = 925..1155`). Put global governing goals in a top full-width banner (`y = 14..82`) and feedback return loops in a bottom bus channel (`y = 536`).
- **Rule 2 - Use 190px Obstacle-Free Wiring Corridors**: Keep `x = 275..465` (Corridor 1) and `x = 735..925` (Corridor 2) completely free of entity cards. Constrain edge pill widths to `<= 156px` so every pill has at least `17px` of visible line margin on both sides.
- **Rule 3 - Use Double-Bezier Horizontal Pill Tangents in Swimlanes**: In 3-column swimlane views, sort edge pills vertically in each corridor, enforce a minimum vertical center separation of `40px`, and route each curve horizontally through the left and right edges of its pill box:
  `M x1 y1 C c1x y1, c1x py, pxL py` (into pill left edge) and `M pxR py C c2x py, c2x y2, x2 y2` (out of pill right edge).
- **Rule 4 - Put Dense Explanations Inside Cards, Not on Wires**: Keep wire pill labels under 12 characters. Put multi-line rules, invariants, and examples inside generously sized Column 2 hub cards (`280px` wide).

---

## 1. Canvas Coordinate System (`viewBox="0 0 1200 575"`)

Use a fixed `1200 x 575` SVG coordinate grid with dark high-contrast styling (`#0f172a` canvas background, `#1e293b` zone borders) so colored layer badges and animated dashed flow lines stand out clearly.

### Standard 3-Column + 2-Corridor Geometry

| Region | X Range | Width | Purpose |
| --- | --- | --- | --- |
| **Top Banner (Optional)** | `x = 45..1155, y = 14..82` | `1110px` | Global governing entity (e.g. User Goal `O1` commanding downstream stages) |
| **Left Gutter** | `x = 12..44` | `32px` | Local vertical split/return channel (e.g. `O8 -> O2` split) |
| **Column 1 (Left)** | `x = 45..275` | `230px` | Upstream Human/Input entities (e.g. `O8`, `O3`, `O2`, `O4`) |
| **Corridor 1 (Gap 1)** | `x = 275..465` | `190px` | **Obstacle-free wiring corridor 1** (Center `mx = 370`, max pill width `156px`) |
| **Column 2 (Middle)** | `x = 465..735` | `270px` | Processing hubs / Agent layer entities (e.g. `O5`, `O6`, Triage/Audit Gatekeepers) |
| **Corridor 2 (Gap 2)** | `x = 735..925` | `190px` | **Obstacle-free wiring corridor 2** (Center `mx = 830`, max pill width `156px`) |
| **Column 3 (Right)** | `x = 925..1155` | `230px` | Downstream Output / Delivery / External entities (e.g. `O9`, `O7`, External Agents) |
| **Right Gutter** | `x = 1156..1185` | `29px` | Vertical drop channel to bottom feedback bus |
| **Bottom Feedback Bus** | `y = 525..555` | `1135px` | Long-range return loop (e.g. `O7 Share -> O4 Peer Feedback -> O3 Idea`) |

---

## 2. Pattern A: 100% Straight-Line Planar Panorama

To prevent diagonal lines from crossing in the Panorama view:

1. **Align Y-Ranges Across Adjacent Columns**:
   - Size the Column 2 boxes (`O5` at `y = 114..254`, `O6` at `y = 270..500`) so their vertical spans overlap the vertical spans of the Column 1 boxes (`O3` at `y = 214..298`, `O2` at `y = 316..400`, `O4` at `y = 418..500`) and Column 3 boxes (`O9` at `y = 114..206`, `O7` at `y = 224..370`, `EXT` at `y = 388..500`).
2. **Draw Pure Horizontal Tracks (`hTrack`)**:
   - Because source and target boxes share overlapping Y intervals, every cross-column connection is a horizontal line `y = const` (`y = 226, 284, 358, 456` in Corridor 1; `y = 158, 236, 315, 444` in Corridor 2).
   - Parallel horizontal lines at `>= 50px` vertical separation never intersect and their centered pill labels (`height = 23px`) never collide.

In `round_template/page.src.html` the panorama is drawn by the round's own `viewAll()` (data file) with the template's helpers, whose signatures are stable:

```javascript
// defs()                                   → <defs> with one arrow marker per layer colour (call once per view)
// node(id, x, y, w, h, extraLines?)        → entity box for OBJ[id]; dashed when its status contains "待定"
// hTrack(x1, x2, y, from, to, label, item, dashed?) → straight horizontal edge + label pill; the pill jumps to item
// wire(d, color, markerKey, from, to, dashed?)      → any SVG path as an edge (e.g. a vertical drop inside a column)
// pill(cx, cy, label, color, item, owner)  → label pill on its own; owner = "from>to" so the collision check skips its own wire
// COL.goal / human / gate / agent / out    → layer colours
function viewAll() {
  let s = defs();
  s += node("REP", 45, 200, 230, 110);
  s += node("AGT", 465, 150, 270, 120);
  s += hTrack(275, 465, 230, "REP", "AGT", "提交周报", "R01-01");   // y = 230 lies inside both boxes' y-ranges
  return s;
}
```

`round_template/sample/data_r01.js` has a complete panorama. The swimlane (Pattern B) and ego-network (Pattern C) views below are built into the template; their geometry is documented here for reference.

---

## 3. Pattern B: Dedicated 3-Column Swimlane with Double-Bezier Pill Tangents

When the user selects a specific workflow or mechanism (`F1..F9` or `M1..M6`), render only the participating entities in 3 columns (`col1: x=24, w=250`, `col2: x=460, w=280`, `col3: x=926, w=250`).

To ensure curves never pass behind another edge's pill box and always enter/exit their own pill box horizontally:

1. Compute the natural midpoint `py = Math.round((y1 + y2) / 2)` for each link in the corridor.
2. Sort links in the corridor by `py` and enforce a minimum vertical spacing of `40px`:
   ```javascript
   for (let i = 1; i < computed.length; i++) {
     if (computed[i].py - computed[i - 1].py < 40) {
       computed[i].py = computed[i - 1].py + 40;
     }
   }
   ```
3. Split each curve into two horizontal-tangent Cubic Beziers meeting at the left edge (`pxL = mx - pw/2`) and right edge (`pxR = mx + pw/2`) of the pill box:
   ```javascript
   const c1x = Math.round((item.x1 + pxL) / 2);
   const c2x = Math.round((pxR + item.x2) / 2);
   const pathLeft  = `M ${item.x1} ${item.y1} C ${c1x} ${item.y1}, ${c1x} ${item.py}, ${pxL} ${item.py}`;
   const pathRight = `M ${pxR} ${item.py} C ${c2x} ${item.py}, ${c2x} ${item.y2}, ${item.x2} ${item.y2}`;
   ```

---

## 4. Pattern C: Single-Entity Ego-Network Star View

When the user clicks an entity chip or table row (the template's `viewObj`):

- **Left Column (`x = 32, w = 315`)**: all upstream sources (`从哪来 / 由谁产生`), each box labelled with the edge it arrives by; up to 74px tall, stacked with 14px gaps and centred.
- **Center Card (`x = 430, y = 120, w = 340, h = 330`)**: the focused entity — name, up to four of its `lines`, then layer, producer, editor, lifecycle and status (labels from `OBJ_LABELS`; the label column widens for longer labels and values are clipped to fit), and a `看相关条目` button when the entity has an `item`.
- **Right Column (`x = 853, w = 315`)**: all downstream targets (`到哪去 / 被谁使用`).
- Edges fan in to `(428, 285)` and out from `(770, 285)` with single cubic Béziers.

---

## 5. Pattern D: High-Clarity Inline Micro-Visualizations

For complex individual review items, embed a targeted visual as the item's `fig` (raw HTML; give its SVG markers ids that are unique on the page). These are figure ideas from earlier rounds, not shipped components — draw them per round:

1. **Multi-Source Convergence Diagram (`hyp`)**: 3 stacked source cards on the left -> smooth fan-in curves -> center unified list card -> right status audit card.
2. **Decision Gate & Isolation Triage (`triage`)**: Input box -> diamond/amber gatekeeper box (`相关吗？人工标注优先`) -> upper branch (`✅ 相关：深度整理 -> O6/O5`) and lower branch (`⏸️ 无关：只打标签 -> ❄️ 冻结目标区 / 📦 未分类隔离区`).
3. **Dual-Column Merge UI Mockup (`dual`)**: Left pane (`👤 左栏：主文档`) + Right pane (`🤖 右栏：AI 修改副本` with checkboxes `☐ / ☑`) + center animated green arrow (`👈 勾选合入`).
4. **3-Way Reviewer Gate (`review`)**: Generator AI -> Reviewer Agent (`逐条对照原文`) -> 3 horizontal outputs (`✅ 一致：开放` / `🤔 不确定：交给你审` / `❌ 不一致：退回重写` with dashed loopback).
5. **Fact vs. Inference UI Comparison (`fact_infer`)**: Side-by-side cards showing how factual claims carry clickable `[🔗 出处: ...]` badges while AI inferences carry `[💡 AI 推理]` badges plus `[✓ 采纳 (转假设)]` and `[✕ 忽略 (留底可找回)]` buttons.
6. **Schema / Frontmatter Diff Card (`okf_card`)**: Side-by-side monospace YAML comparison highlighting newly added required fields in amber (`#fde68a`).
