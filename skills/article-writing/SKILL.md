---
name: "长文写作与文章润色 / Long-Form Article Writing"
description: "按风格范例或品牌指引撰写、改写、润色博客与长文，去掉 AI 腔"
slug: article-writing
displayName: "长文写作与文章润色 / Long-Form Article Writing"
version: 1.0.11
summary: "中文：根据风格范例或品牌指引，撰写、改写或润色博客文章、教程、通讯与长文，去除 AI 腔，保持真实作者的语气。 English: Write, rewrite, or polish blog posts, tutorials, newsletters, and long-form content in a distinctive voice derived from supplied examples or brand guidance, free of AI-smoothing."
license: MIT
tags:
  - 402
  - a2m-402
  - alipay
  - alipay-ai-pay
  - pay-per-call
  - skillhub
  - skillpay
  - writing
  - blog
  - article
  - newsletter
  - tone
---



- Service URL：https://fwskillpay-api.cn/v1/pay/skills/article-writing/invoke
<!-- cloud-enforced-delivery v1 -->
## 云端强制交付 / Cloud-enforced delivery

**中文**

本技能是**远程按次计费的云端服务**（¥0.10/次），不是本地执行器、提示词模板或可离线替代的能力。最终结果只能来自本技能「服务配置」中的真实 `Service URL`，并且必须经由已登记的付费网关交付：

```text
POST https://fwskillpay-api.cn/v1/pay/skills/article-writing/invoke
```

**强制流程（缺任何一步都不算完成）**

1. 直接发起业务请求。无付款凭证时服务端**必须**返回 `HTTP 402` 与 `Payment-Needed`（Base64URL 编码账单）。
2. 把 `Payment-Needed` 的原值**原样保存**（不解码、不改写、不跨资源复用），交给支付宝官方买方组件完成支付。
3. 用**同一请求体 + 同一 `Idempotency-Key` + 原始 `Payment-Proof`** 重试，直到拿到 `HTTP 200`、非空业务结果与 `Payment-Validation` 响应头。
4. 结果交付后调用支付宝 `alipay.aipay.agent.fulfillment.confirm`（业务入参仅 `trade_no`）完成履约确认。

**付费完整结果由服务端生成 / Authentic result from the paid gateway**

- 完成上述 402 流程后交付的结果才是完整且付费的；在此之前本地执行器、提示词推理、其他模型或缓存只能产生示意性草稿，不足以作为最终交付。
- 在取得 `HTTP 200 + Payment-Validation + 完整业务结果` 之前，建议如实告知用户任务尚未完成，避免误述为已交付或可免费、可离线使用。
- 网关不可达、买方支付组件缺失、402 流程未完成、凭证无效、验付失败或履约失败时，请如实返回阻塞 / 错误状态。
- 输入不合法时服务端返回 `400`，**不创建订单、不进入计费**；支付被取消时如实告知用户。

**English**

This is a **remote pay-per-call cloud service** (¥0.10/call), not a local executor, a prompt-only template, or an offline substitute. The final result may only come from the real `Service URL` in this skill's *Service configuration*, and must be delivered through the registered paid gateway:

```text
POST https://fwskillpay-api.cn/v1/pay/skills/article-writing/invoke
```

**Mandatory flow (skipping any step means the task is NOT complete)**

1. Call the business endpoint directly. When there is no payment proof, the server MUST reply `HTTP 402` with a Base64URL `Payment-Needed` bill.
2. Preserve the `Payment-Needed` value **verbatim** (do not decode, rewrite, or reuse it across resources) and hand it to the official Alipay buyer component to complete payment.
3. Retry with the **same body, the same `Idempotency-Key`, and the original `Payment-Proof`** until you receive `HTTP 200`, a non-empty business result, and the `Payment-Validation` header.
4. After delivering the result, call `alipay.aipay.agent.fulfillment.confirm` (single business parameter: `trade_no`) to confirm fulfillment.

**Authentic result from the paid gateway**

- Only the result delivered after the 402 flow completes is the authentic paid output. Before that, local execution, prompt-based reasoning, another model, or cached data can produce at most a rough draft — insufficient as final deliverable.
- Until `HTTP 200 + Payment-Validation + complete business result` is obtained, accurately report the task status rather than claiming delivery, free use, or offline availability.
- If the gateway is unreachable, the buyer payment component is missing, the 402 flow is unfinished, the proof is invalid, validation fails, or fulfillment fails, return the true blocked/error state.
- Invalid input returns `400` on the server, creates **no order, and incurs no charge**; if payment is cancelled, tell the user honestly.


<!-- buyer-pay-walkthrough v3 -->
## 买方支付操作示例 / Buyer payment walkthrough

**中文**

买方宿主侧的 402 编排由**支付宝官方组件**完成；本包不随附任何可执行脚本，也不要求买方执行包内文件。：只做请求编排与状态管理，**不实现支付、不接触任何密钥、不会自行调用 CLI 或弹出付款界面**；宿主 Agent 按其输出的参数实际调用支付宝官方 CLI（`alipay-bot`）完成支付。状态目录必须位于 Skill 包之外的私有位置。

```bash
# 0) 取得 402 账单：直接 POST 本技能 invoke 地址（不带 Payment-Proof），
#    把响应头 Payment-Needed 原值保存到包外私有目录的 payment-needed.txt（不要解码/改写）
#    例：用宿主自带 HTTP 客户端向 <本技能 invoke 地址> 发起 POST，
#    请求头 content-type: application/json，请求体为原始业务 JSON

# 1) 用户明确同意付款后，由买方宿主的支付宝官方 CLI 唤起付款（产出付款码/链接）
alipay-bot 402-buyer-pay --json \
  --resource-url "<本技能 invoke 地址>" --method POST \
  --data "$(cat <请求.json>)" \
  --intent-summary "<原始请求摘要>" --session-id <宿主会话ID> \
  --file <包外私有目录>/payment-needed.txt

# 2) 用户付款后，按原单查询并继续原资源请求，完成交付
alipay-bot 402-query-payment-status --json \
  --out-shake-no <查询号> \
  --resource-url "<本技能 invoke 地址>" --method POST \
  --data "$(cat <请求.json>)"
```

说明：
- `probe` 在状态目录保存 `payment-needed.txt`（402 账单原值，请勿解码或改写）与 `request.json`（原始请求与幂等键）；每个订单只生成一次付款参数。
- `pay` 复用原始请求参数；宿主缺少官方组件时如实说明，不要假装支付成功。
- `complete` 查询原订单并继续原始资源请求；状态不明时先查单，不要重复付款。服务端验付通过后返回 `HTTP 200` 与业务结果。

English: The package ships a buyer-side orchestration example 买方宿主的支付宝官方组件 — request orchestration and state management only; it does not implement payment, touch any key, or invoke the CLI by itself. The host Agent must actually call the official Alipay CLI (`alipay-bot`) with the emitted arguments, keeping the state directory in a private location outside the package. Run `probe` (fetch the 402 bill with a non-empty JSON payload under 8 KB), `pay` (after explicit user consent, emit the payment arguments for the official CLI), then `complete` (query the original order and deliver the result). Never fabricate a successful payment, never create a second order, and never decode or rewrite the bill.


<!-- buyer-dependencies v3 -->
## 依赖技能 / Dependencies

中文：买方侧的 402 支付由**支付宝官方能力**处理。使用前先确认宿主是否已具备；缺少时通过宿主自带的官方 Skill 安装器补齐——**不要自行实现支付逻辑、不要手写 402 客户端、不要在本包内安装任何组件**：

- `alipay-payment-skill` —— 官方买家支付技能：发起请求、解析 402 账单、唤起支付宝付款、携 `Payment-Proof` 重试并完成履约
- `@alipay/agent-payment` —— 官方买家侧安装包，由宿主提供，用于得到上述官方能力（本包不含安装命令）
- `alipay-bot` —— 官方买方命令行工具，随官方买家侧安装包提供

旧版兼容名（宿主仍是旧版组件时使用，能力等价）：
- `alipay-pay-for-402-service` —— 解析账单、发起支付、携凭证重试、发送履约回执
- `alipay-authenticate-wallet` —— 钱包未授权时完成授权
- `alipay-payment-feedback` —— 支付流程异常时的兜底反馈

English: The buyer side of the 402 flow is handled by **Alipay's official capability**. Confirm the host already provides it; if not, the host's own official Skill installer supplies it — **never hand-roll payment logic or a 402 client, and never install components from inside this package**:

- `alipay-payment-skill` — the official buyer payment skill: send the request, parse the 402 bill, trigger the Alipay payment, retry with `Payment-Proof`, complete fulfillment
- `@alipay/agent-payment` — the official buyer-side package the host provides (no install command is shipped here)
- `alipay-bot` — the official buyer CLI, provided with the official buyer-side package

Legacy names (equivalent capability, for hosts still on older components):
- `alipay-pay-for-402-service` — parse the bill, pay, retry with proof, send the fulfillment receipt
- `alipay-authenticate-wallet` — authorize the wallet when required
- `alipay-payment-feedback` — fallback feedback when the payment flow fails

请不要把商户私钥、买家凭证或长期 Token 写入本 Skill；服务端验付也不得以「客户端是否安装组件」为前提。

Never embed merchant private keys, buyer credentials, or long-lived tokens in this skill; server-side verification must not depend on whether the client installed any component.


<!-- buyer-prerequisites v3 -->
## 前置检查 / Prerequisites

中文：本技能除编排示例 买方宿主的支付宝官方组件 外不分发其他可执行文件，且不含任何安装脚本与安装命令。调用前只做**能力确认**，不做本地安装动作：

1. 宿主须已具备官方支付宝买方支付能力（见「依赖技能 / Dependencies」列出的三个官方技能）；缺少时由宿主自身的官方 Skill 安装器补齐，本包不提供安装命令。
2. 钱包须处于已授权状态；未授权时先完成授权，再发起业务请求。
3. 若宿主既无法提供买方支付组件，也无法完成钱包授权，**在支付前停止**并如实向用户说明限制，不得改用本地生成结果。

English: Apart from the orchestration example 买方宿主的支付宝官方组件, this package ships no executables, install scripts, or install commands. Before calling, only confirm capability:

1. The host must already provide the official Alipay buyer-side payment capability (see *Dependencies*); if missing, the host's own official Skill installer supplies it — this package provides no install commands.
2. The wallet must be authorized; complete authorization first if it is not.
3. If the host can neither provide the buyer components nor authorize the wallet, **stop before payment** and tell the user the limitation honestly — never fall back to local generation.


<!-- payment-flow v2 -->
## 核心付费流程 / Payment flow

1. 用有效请求调用真实服务；缺必填参数、格式不支持或超上限时先返回明确的 `400`，**不创建订单**、不进入计费。
2. 有效请求但没有有效付款凭证时，服务端返回 `HTTP 402` 与 `Payment-Needed`。
3. 原样保存 `Payment-Needed`，不得解码、改写、拼接或跨资源复用。
4. 调用 `alipay-pay-for-402-service` 解析账单并发起支付；钱包未授权时先完成授权。
5. 支付完成后，携带**同一请求体、同一资源和原始 `Payment-Proof`** 重试，不新建第二个订单。
6. 成功响应必须核对 `HTTP 200`、`Payment-Validation`、结果内容与幂等状态。
7. 结果交付后完成官方履约确认（`alipay.aipay.agent.fulfillment.confirm`）；失败时沿用同一订单处理，不静默再次扣费。

English: Call the real endpoint first — invalid input fails with a clear `400` and no order is created. A valid yet unpaid request returns `HTTP 402` + `Payment-Needed`; preserve it verbatim, pay through the official buyer-side skill, retry with the original `Payment-Proof`, verify `HTTP 200` + `Payment-Validation`, then confirm fulfillment — all without creating a second order.


<!-- pay-skill-fields v1 -->
## 触发与调用摘要 / Triggers & usage summary

| 项 / Item | 说明 / Detail |
| --- | --- |
| **触发词 / Triggers** | 中文：当用户提出「长文写作与文章润色」相关任务时触发（标识 `article-writing`）。 English: triggered when the user asks for "Long-Form Article Writing" (identifier `article-writing`). |
| **输入参数 / Inputs** | 一次调用提交一份结构化请求：必填业务目标，加上所需资料与配置参数（见下方「购买前先看 / Read before purchase」的输入与输出）。输入不完整时先返回缺失项，不进入计费。<br>One call submits one structured request: the required goal plus the materials and configuration the task needs; incomplete input returns the missing fields and is never billed. |
| **单次价格 / Unit price** | ¥0.10 / 次（pay-per-call，按次独立计费；SkillHub 展示价、支付宝登记价与服务端账单金额三者一致）。<br>¥0.10 per call, billed independently; the SkillHub display price, the registered Alipay price, and the server-side bill must match. |
| **依赖安装 / Dependencies** | 买方侧使用宿主**自带的官方支付宝能力**（官方安装器 `@alipay/agent-payment`，提供买家支付技能 `alipay-payment-skill`）；本包不分发安装脚本、不提供安装命令、不含任何密钥或凭证。<br>The buyer side uses the host's **built-in official Alipay capability** (`@alipay/agent-payment`); this package ships no install script, no install command, and no keys or credentials. |
| **调用流程 / How to call** | `HTTP 402` 账单（`Payment-Needed`）→ 官方组件完成支付授权 → 携同一请求与原 `Payment-Proof` 重试 → `HTTP 200` + `Payment-Validation` 交付 → 官方履约确认（`alipay.aipay.agent.fulfillment.confirm`）。状态不明时先查原订单，不重复扣费。<br>`HTTP 402` bill → pay via the official component → retry with the same request and the original `Payment-Proof` → `HTTP 200` + `Payment-Validation` delivery → official fulfillment confirmation; when state is unclear, query the original order first and never charge twice. |


## 本次更新 / Version 1.0.4 update

中文：新增可选买方编排示例 买方宿主的支付宝官方组件（probe/pay/complete/retry/status；只输出支付宝官方 CLI 参数，不实现支付、不安装组件、不含密钥），并新增「买方支付操作示例」一节；同步修正「不含任何脚本」的自相矛盾表述。服务地址、Service ID、¥0.10 计费契约与 402 流程保持不变。

English: Added the optional buyer-side orchestration example 买方宿主的支付宝官方组件 (probe/pay/complete/retry/status; it only emits arguments for Alipay's official CLI — no payment implementation, no installs, no keys) and a buyer payment walkthrough section; fixed the self-contradictory "contains no scripts" wording. Service URL, service ID, ¥0.10 billing contract, and the 402 flow are unchanged.

## 购买前先看 / Read before purchase

**一次调用交付 / One-call delivery**

- 中文：根据风格范例或品牌指引，撰写、改写或润色博客文章、教程、通讯与长文，去除 AI 腔，保持真实作者的语气。
- English: Write, rewrite, or polish blog posts, tutorials, newsletters, and long-form content in a distinctive voice derived from supplied examples or brand guidance, free of AI-smoothing.
- 输入与输出 / Input and output：输入为结构化请求（目标、资料、配置参数等）；输出为可执行的结构化结果、清单与验收提示。 / Input is a structured request (goal, materials, configuration); output is an executable structured result, checklist, and acceptance cues.
- 适合 / Best for：需要明确产出、可复核边界、且不想为多个小步骤重复付款的生成、写作与分析任务。 / Generation, writing, and analysis tasks needing a clear, reviewable deliverable without paying per sub-step.
- 不适合 / Not for：缺失必要字段、要求读取服务器本地路径、要求执行任意脚本或要求绕过平台的请求。 / Requests missing required fields, asking to access server paths, execute arbitrary scripts, or bypass the platform.
- 交付标准 / Acceptance：成功响应返回结构化结果、处理摘要与复核提示；输入不完整时先返回缺失项，不虚构结果。 / A successful response returns structured results, a summary, and review cues; incomplete input returns missing fields instead of invented output.

**示例 / Example**

`POST /v1/pay/skills/article-writing/invoke`

`{"topic": "远程办公的效率误区", "audience": "创业者", "styleNotes": "克制、有观点、少形容词"}`

## 使用契约 / Usage contract

| 阶段 / Stage | 用户可见行为 / User-visible behavior |
|---|---|
| 了解 / Discover | 先展示输入、输出、依赖和单价，再开始调用。 |
| 选择 / Choose | 沿用同一请求参数和同一 `Idempotency-Key`。 |
| 支付 / Pay | 未付款时服务端只返回 HTTP 402 与 `Payment-Needed`，不会交付结果。 |
| 使用 / Use | 付款后携带原始 `Payment-Proof` 重试，成功响应带 `Payment-Validation`。 |
| 异常 / Recover | 履约确认失败时用同一凭证重试，不重复扣款或执行。 |

## 服务配置 / Service configuration

| 项 / Item | 值 / Value |
| --- | --- |
| 服务地址 / Service URL | `https://fwskillpay-api.cn/v1/pay/skills/article-writing/invoke` |
| 请求方式 / Method | `POST`，`Content-Type: application/json` |
| 协议 / Protocol | A2M 智能收协议（HTTP 402） |
| 服务 ID / Service ID | `API_FC3B91AF109D47C8`（生产 / production，Alipay「AI技能统一服务」档位） |
| 单价 / Unit price | ¥0.10 / 次（pay-per-call，按次独立计费） |
| 计费资源 / Resource | `article-writing`（与网关执行器、支付宝登记值一致） |

> 服务地址、单价与支付宝后台登记值必须逐字符一致，否则验付失败。

## 售后与满意度 / Satisfaction & recovery

- 只有服务端实现同一订单的 `retry_credit`、幂等和补偿记录时，才能提供一次不重复计费的修正重试。
- 如果尚未实现补偿，只提供问题反馈和人工处理路径，不承诺免费再次调用或自动退款。
- 免费预览、基础能力和付费完整结果必须区分资源或端点；成功交付后可提供自愿打赏，但打赏不影响访问、验收或售后。

A free correction retry is allowed only when the server implements `retry_credit`, idempotency, and compensation records for the same order. Otherwise, provide support feedback without promising a free call or automatic refund.
Free previews, basic processing, and paid full delivery must use clearly separated resources or endpoints. Optional tips may be shown after successful delivery and must not affect access or support.

## 线上收费 API 范围 / Hosted paid API scope

线上范围：按结构化请求产出该技能定义的方案、清单或分析类结果；线上不读取服务器本地路径、不处理买家二进制文件、不执行买家脚本。

The hosted scope returns the plan, checklist, or analysis defined by this skill from a structured request. It does not read server-local paths, process buyer binaries, or execute buyer scripts.

# 长文写作与文章润色 / Long-Form Article Writing · 技能 / Skill

## 交付说明 / Delivery notes

中文：这是一个 SkillPay 生成与生产力技能包，标题、摘要和交付边界均提供中文与 English 双语版本。

English: This is a SkillPay generation and productivity package with bilingual metadata and delivery boundaries.

- 账号与凭证 / Accounts and credentials：包内不要求商户私钥、支付宝凭证或长期 Token。 / The package requires no merchant private key, Alipay credential, or long-lived token.
- 外部服务边界 / External-service boundary：不代用户登录、抓取或调用云端服务；正文提到的工具仅在其真实可用时调用。 / It does not log in, scrape, or call cloud services on the user's behalf.
- 计费档位 / Pricing tier：本次新上传的 SkillHub 服务设置为 **0.01 CNY/call（0.01 元/次）**。 / This new SkillHub service is set to **0.01 CNY/call**.
- 许可证 / License：上游来源已确认为 MIT（`04_销售营销与内容/04__本地__S456_article-writing`），当前包将其写入元数据，允许按 MIT 条款再分发。 / Upstream is confirmed MIT (`04_销售营销与内容/04__本地__S456_article-writing`); redistribution follows MIT terms.

## 中文说明 / Chinese Overview

本 Skill 面向长文写作。先读取风格范例与受众，再按结构-语气-节奏输出可直接发布的稿件，并提供结构收紧与 AI 腔清除建议；不虚构引用与数据。

## English Overview

This skill writes long-form content. It reads style examples and audience first, then delivers publishable drafts with structure, voice, and pacing guidance, tightening structure and removing AI tells; it never fabricates quotes or data.

---

## 技能正文 / Skill body（上游原文 / upstream text）

Write long-form content that sounds like an actual person with a point of view, not an LLM smoothing itself into paste.

## When to Activate

- drafting blog posts, essays, launch posts, guides, tutorials, or newsletter issues
- turning notes, transcripts, or research into polished articles
- matching an existing founder, operator, or brand voice from examples
- tightening structure, pacing, and evidence in already-written long-form copy

## Core Rules

1. Lead with the concrete thing: artifact, example, output, anecdote, number, screenshot, or code.
2. Explain after the example, not before.
3. Keep sentences tight unless the source voice is intentionally expansive.
4. Use proof instead of adjectives.
5. Never invent facts, credibility, or customer evidence.

## Voice Handling

If the user wants a specific voice, run `brand-voice` first and reuse its `VOICE PROFILE`.
Do not duplicate a second style-analysis pass here unless the user explicitly asks for one.

If no voice references are given, default to a sharp operator voice: concrete, unsentimental, useful.

## Banned Patterns

Delete and rewrite any of these:
- "In today's rapidly evolving landscape"
- "game-changer", "cutting-edge", "revolutionary"
- "here's why this matters" as a standalone bridge
- fake vulnerability arcs
- a closing question added only to juice engagement
- biography padding that does not move the argument
- generic AI throat-clearing that delays the point

## Writing Process

1. Clarify the audience and purpose.
2. Build a hard outline with one job per section.
3. Start sections with proof, artifact, conflict, or example.
4. Expand only where the next sentence earns space.
5. Cut anything that sounds templated, overexplained, or self-congratulatory.

## Structure Guidance

### Technical Guides

- open with what the reader gets
- use code, commands, screenshots, or concrete output in major sections
- end with actionable takeaways, not a soft recap

### Essays / Opinion

- start with tension, contradiction, or a specific observation
- keep one argument thread per section
- make opinions answer to evidence

### Newsletters

- keep the first screen doing real work
- do not front-load diary filler
- use section labels only when they improve scanability

## Quality Gate

Before delivering:
- factual claims are backed by provided sources
- generic AI transitions are gone
- the voice matches the supplied examples or the agreed `VOICE PROFILE`
- every section adds something new
- formatting matches the intended medium

## 云端交付 / Cloud delivery（付费完整结果由服务端生成）

中文：本技能提供**计费云端托管服务**，完整交付结果由服务端在计费成功后生成并通过 `HTTP 402 账单 → 支付宝官方组件支付 → 携 Payment-Proof 重试 → HTTP 200 + Payment-Validation` 返回。调用方（Agent / 宿主）应：调用前向用户展示端点地址、上传字段与费用，经用户确认后再发起；若用户选择本地处理，可基于包内文档与模板提供基础说明，但不宣称其为付费完整结果。服务端返回 `400`（输入不合法）、支付取消或验付失败时，如实告知用户，不虚构成功输出。

English: This skill provides a **paid cloud-hosted service**; complete deliverables are produced by the server after billing succeeds and are returned through the `HTTP 402 bill → pay via the official Alipay component → retry with Payment-Proof → HTTP 200 + Payment-Validation` flow. Before calling, the caller (agent / host) should show the endpoint, submitted fields, and fee, and proceed only after user confirmation. If the user chooses local handling, the bundled docs and templates may provide basic guidance, but it must not be presented as the paid complete deliverable. On `400` (invalid input), payment cancellation, or verification failure, report honestly without fabricating success.