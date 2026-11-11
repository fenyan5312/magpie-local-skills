#!/usr/bin/env node
/**
 * Optional buyer-side orchestration for the article-writing paid endpoint.
 * Payment and proof handling stay in Alipay's official alipay-bot CLI.
 * No shell is used; no key or Payment-Proof is stored by this helper.
 *
 * v5-merged (20261008): 以 v4（钱包闸门 check-wallet bound 前置 + record-poll + afterPayment 引导）为基底，
 * 移植旧发布链模板的 resume-pay / restage 恢复命令、查单号格式与跨订单校验；
 * 账单金额与支付宝服务档位改由包内 SKILL.md 动态核对，不再硬编码 ¥0.10 / API_FC3B91AF109D47C8，
 * 使同一份助手可服务于 0.01 / 0.10 / 0.99 三档价位的任何包。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ALIPAY_BOT = 'alipay-bot';
const SKILL_SLUG = 'article-writing';
const FILE_REQUEST = 'request.json';
const FILE_BILL = 'payment-needed.txt';
const FILE_STATE = 'session.json';
const FILE_SOURCE_PAYLOAD = 'input-payload.json';
const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class StopError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

function stop(message, code = 1) {
  throw new StopError(message, code);
}

function parseFlags() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      'state-dir': { type: 'string' },
      'payload-file': { type: 'string' },
      'session-id': { type: 'string' },
      'intent-summary': { type: 'string' },
      'trade-no': { type: 'string' },
      'out-shake-no': { type: 'string' },
      'confirm-data-transfer': { type: 'boolean', default: false },
      'confirm-payment': { type: 'boolean', default: false },
      'confirm-cli-not-started': { type: 'boolean', default: false },
      'confirm-ref-expired': { type: 'boolean', default: false },
      'confirm-resource-delivered': { type: 'boolean', default: false },
      'confirm-wallet-bound': { type: 'boolean', default: false },
      'poll-output': { type: 'string' },
      'confirm-ack-failed': { type: 'boolean', default: false },
      'confirm-recovery-requested': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  return { command: positionals[0], flags: values };
}

function printUsage() {
  console.log(`SkillPay 买方付费编排（不安装组件、不实现支付、不保存凭证）

  probe     对登记的 HTTPS 服务发起一次原始请求，保存本轮 402 账单
            --state-dir <私有目录> --payload-file <JSON 文件> --confirm-data-transfer [--url <Service URL>]
  pay       用户明确同意后，生成交给宿主 Agent 的官方买方 CLI 参数
            --state-dir <私有目录> --session-id <宿主会话 ID>
            --intent-summary <原始请求：本次业务目的摘要> --confirm-payment
  resume-pay 仅在确认官方 CLI 从未启动时，恢复输出同一笔付款参数
            --state-dir <私有目录> --session-id <同一宿主会话 ID>
            --intent-summary <同一原始请求摘要> --confirm-cli-not-started
  record-poll 官方轮询到终态后，把终态与交易号记进状态目录（可选，只留证据不存凭证）
            --state-dir <私有目录> --poll-output <官方 poll 输出文件>
  complete  生成查询原订单并取回资源的官方 CLI 参数
            --state-dir <私有目录> (--trade-no <交易号> | --out-shake-no <查询号>)
  retry     再次生成原订单查询参数；不重新下单或付款
            --state-dir <私有目录> (--trade-no <交易号> | --out-shake-no <查询号>)
  restage   官方 CLI 明确报告引用过期后，为原订单重暂存完全相同的请求体
            --state-dir <私有目录> --confirm-ref-expired --confirm-data-transfer
  ack       仅在官方回执明确失败且用户后续要求恢复时使用
            --state-dir <私有目录> --trade-no <交易号> --confirm-resource-delivered --confirm-ack-failed --confirm-recovery-requested
  status    只显示脱敏状态，不打印请求体、账单或凭证
            --state-dir <私有目录>

状态目录含原请求与 Payment-Needed；请放在技能包目录之外的私有目录，勿上传或分享。
`);
}

function requireStateDir(flags) {
  if (!flags['state-dir']) stop('缺少 --state-dir；状态必须保存在技能包目录之外的私有目录。');
  const dir = path.resolve(flags['state-dir']);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const canonicalPackage = fs.realpathSync(PACKAGE_DIR);
  const canonicalDir = fs.realpathSync(dir);
  const relative = path.relative(canonicalPackage, canonicalDir);
  const insidePackage = relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  if (insidePackage) stop('状态目录不能位于技能包内（包括目录链接），避免把请求或账单打进 ZIP。');
  if (process.platform !== 'win32') fs.chmodSync(canonicalDir, 0o700);
  return canonicalDir;
}

function writePrivate(file, data) {
  fs.writeFileSync(file, data, { encoding: 'utf8', mode: 0o600 });
}

function parsePayload(fileName) {
  if (!fileName) stop('缺少 --payload-file；请按输入契约准备包外 JSON 文件。', 2);
  const file = path.resolve(fileName);
  if (!fs.existsSync(file)) stop('请求文件不存在。', 2);
  const payload = fs.readFileSync(file, 'utf8');
  let value;
  try { value = JSON.parse(payload); } catch { stop('请求体不是有效 JSON。', 2); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) {
    stop('请求体必须是非空顶层 JSON 对象，按本技能输入章节填写；不使用其他技能的 goal/dataset 模板。', 2);
  }
  // The registered server validates task-specific fields before issuing a bill.
  return payload;
}

function validateServiceUrl(raw) {
  const skillFile = path.join(PACKAGE_DIR, 'SKILL.md');
  if (!fs.existsSync(skillFile)) stop('包内缺少 SKILL.md，无法确认登记的服务地址。');
  const skillText = fs.readFileSync(skillFile, 'utf8');
  const tableMatch = skillText.match(/^\|\s*服务地址\s*\/\s*Service URL\s*\|\s*`([^`]+)`\s*\|/m);
  const listMatch = skillText.match(/^\s*-\s*Service URL[：:]\s*`?([^\s`|]+)`?\s*$/mi);
  const registeredUrl = tableMatch?.[1] ?? listMatch?.[1];
  if (!registeredUrl) stop('SKILL.md 中未找到登记的 Service URL（支持服务配置表或 Service URL 列表）。');
  let url;
  let expected;
  try {
    expected = new URL(registeredUrl);
    url = new URL(raw || process.env.SKILLPAY_RESOURCE_URL || registeredUrl);
  } catch {
    stop('Service URL 格式无效。');
  }
  if (expected.protocol !== 'https:' || expected.username || expected.password || expected.search || expected.hash
      || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || url.href !== expected.href) {
    stop('仅允许调用 SKILL.md 登记的 HTTPS article-writing invoke URL；不要把请求体发送到其他地址。');
  }
  return url.href;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  writePrivate(file, JSON.stringify(value, null, 2));
}

function loadRequest(stateDir) {
  const file = path.join(stateDir, FILE_REQUEST);
  if (!fs.existsSync(file)) stop(`状态目录缺少 ${FILE_REQUEST}；请先取得本轮账单。`);
  return readJson(file);
}

function loadState(stateDir) {
  const file = path.join(stateDir, FILE_STATE);
  return fs.existsSync(file) ? readJson(file) : {};
}

function saveState(stateDir, state) {
  writeJson(path.join(stateDir, FILE_STATE), state);
}

async function fetchOnce(url, options) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(15000), redirect: 'error' });
}

const STAGE_SERVER_MAX_BYTES = Number(process.env.SKILLPAY_STAGE_MAX_BYTES) || 8 * 1024 * 1024;

/**
 * 大载荷先暂存到服务端，换取短时效引用 $ref；之后 probe / pay / complete
 * 全程只传 {"$ref": "..."}（约 40 字节），绕开 Windows 命令行 argv 上限
 * （cmd.exe 约 8KB，CreateProcess 约 32KB）。载荷内容不打印、不落状态目录。
 */
async function stageLargePayload(invokeUrl, payload) {
  const bytes = Buffer.byteLength(payload, 'utf8');
  // Reserve room for URL, headers and shell escaping below Windows cmd's limit.
  const inlineCap = 4096;
  const configured = Number(process.env.SKILLPAY_STAGE_THRESHOLD_BYTES);
  const threshold = Number.isFinite(configured) && configured > 0 ? Math.min(configured, inlineCap) : inlineCap;
  const serverCap = Math.min(Number(process.env.SKILLPAY_STAGE_MAX_BYTES) || 8 * 1024 * 1024, 8 * 1024 * 1024);
  if (bytes > serverCap) stop(`请求体 ${bytes} 字节，超过暂存上限 ${serverCap} 字节。`, 2);
  if (bytes <= threshold) return { payload, ref: null, bytes };
  if (process.env.SKILLPAY_DISABLE_STAGE === '1') {
    if (bytes > inlineCap) stop('大载荷需要同域暂存；暂存已禁用，停止，不能放宽环境变量绕过命令行上限。', 2);
    return { payload, ref: null, bytes };
  }
  const stageUrl = invokeUrl.replace(/\/invoke\/?$/, '/stage');
  if (stageUrl === invokeUrl) stop('服务地址没有同域暂存入口，不能发送大载荷到命令行。', 2);
  try {
    const response = await fetch(stageUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
      signal: AbortSignal.timeout(60000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const ref = data && typeof data.$ref === 'string' ? data.$ref : null;
    if (!ref || !/^stg_[A-Za-z0-9_-]{16,64}$/.test(ref)) throw new Error('暂存响应没有有效的短引用');
    const compact = JSON.stringify({ $ref: ref });
    console.log(`大载荷已暂存：${bytes} 字节 → 短引用（CLI 传参 ${Buffer.byteLength(compact, 'utf8')} 字节）。`);
    if (data.expiresAt) console.log(`暂存有效期至 ${data.expiresAt}；过期后先核查原订单，付款后不得重新建单。`);
    return { payload: compact, ref, bytes };
  } catch (error) {
    // No fallback that could recreate WinError 206 or execute unpaid local work.
    stop(`同域暂存失败，停止付款参数生成：${String(error?.message || error)}。先核查暂存服务，再重试经修正的新请求。`, 2);
  }
}

/**
 * 期望金额与服务档位从包内 SKILL.md 动态读取，不再硬编码：SKILL.md 是发布链写入
 * 价格与服务 ID 的唯一真源，账单与登记不一致说明包配置错误或账单被调包，都拒绝付款。
 * SKILL.md 没有 API_ 服务 ID 的老包只做金额+资源核对（金额本身已锁定支付宝档位）。
 */
let registeredBillExpectations = null;
function registeredBillExpectationsOnce() {
  if (registeredBillExpectations) return registeredBillExpectations;
  const skillFile = path.join(PACKAGE_DIR, 'SKILL.md');
  if (!fs.existsSync(skillFile)) stop('包内缺少 SKILL.md，无法核对账单金额与登记价格；停止，不付款。', 2);
  const md = fs.readFileSync(skillFile, 'utf8');
  const priceMatch = md.match(/¥\s?(\d+\.\d{2})/);
  if (!priceMatch) stop('SKILL.md 中未找到 ¥x.xx 形式的登记价格；停止，不核对账单。', 2);
  const ids = [...new Set(md.match(/API_[0-9A-F]{16}/g) || [])];
  if (ids.length > 1) stop('SKILL.md 中出现多个互不相同的服务 ID，包配置自相矛盾；停止，不付款。', 2);
  registeredBillExpectations = { amount: priceMatch[1], serviceId: ids[0] || null };
  return registeredBillExpectations;
}

function validateReceivedBill(bill, requestUrl) {
  let parsed;
  try { parsed = JSON.parse(Buffer.from(bill, 'base64url').toString('utf8')); }
  catch { stop('402 账单不能按登记协议解析；停止，不生成付款指令。', 2); }
  const protocol = parsed?.protocol;
  const method = parsed?.method;
  const resource = new URL(requestUrl).pathname.split('/').filter(Boolean).at(-2);
  const expected = registeredBillExpectationsOnce();
  if (!protocol || Number(protocol.amount).toFixed(2) !== expected.amount || protocol.currency !== 'CNY') {
    stop(`402 账单金额或币种与本包登记 ¥${expected.amount} / CNY 不一致；停止，不付款。`, 2);
  }
  if (protocol.resource_id !== resource) {
    stop('402 账单资源与登记服务 URL 不一致；停止，不付款。', 2);
  }
  if (expected.serviceId && method?.service_id !== expected.serviceId) {
    stop('402 账单支付宝服务档位与 SKILL.md 登记的服务 ID 不一致；停止，不付款。', 2);
  }
  if (!protocol.out_trade_no || !Number.isFinite(Date.parse(protocol.pay_before)) || Date.parse(protocol.pay_before) <= Date.now()) {
    stop('402 账单订单号或有效期无效；停止，不付款，先核查原订单。', 2);
  }
  // This comparison is not signature verification. Pass the original opaque
  // header unchanged to the official CLI for authentication and user checkout.
}

async function cmdProbe(flags) {
  if (!flags['confirm-data-transfer']) stop('缺少 --confirm-data-transfer：须先向用户说明接收方、处理目的、输入范围、暂存期限与本地 CLI 数据边界，并取得明确同意。', 2);
  const stateDir = requireStateDir(flags);
  if (fs.existsSync(path.join(stateDir, FILE_REQUEST))) stop('该状态目录已记录原请求；不得再次 probe 或重新暂存。未付款异常先核查，付款后仅 complete/retry 查询原订单。', 2);

  const url = validateServiceUrl(flags.url);
  const originalPayload = parsePayload(flags['payload-file']);
  const originalPayloadSha256 = crypto.createHash('sha256').update(originalPayload, 'utf8').digest('hex');
  const stagedPayload = await stageLargePayload(url, originalPayload);
  const payload = stagedPayload.payload;
  if (stagedPayload.ref) writePrivate(path.join(stateDir, FILE_SOURCE_PAYLOAD), originalPayload);
  const method = 'POST';
  const requestFile = path.join(stateDir, FILE_REQUEST);
  const billFile = path.join(stateDir, FILE_BILL);
  const previousState = loadState(stateDir);
  let request;

  if (fs.existsSync(requestFile)) {
    request = loadRequest(stateDir);
    if (request.url !== url || request.method !== method || request.payload !== payload) {
      stop('该状态目录已绑定另一请求；每个订单请使用新的私有状态目录。');
    }
    if (fs.existsSync(billFile)) stop('本轮账单已保存；不要再次 probe。请继续 pay 或查询原订单。');
    if (previousState.probeStatus === 429) stop('此状态目录已记录 HTTP 429。停止本批次，不得再次 probe；请记录并等待平台恢复。', 2);
    if (previousState.probeStartedAt) stop('此状态目录已发起 probe；即使未收到响应，也不得重放或新建订单。先核查原请求状态。', 2);
    if (previousState.probeStatus !== undefined) stop(`此状态目录已收到 HTTP ${previousState.probeStatus}；不重复发起请求。按状态记录处理，必要时使用新的状态目录提交经修正的新请求。`, 2);
  } else {
    request = {
      url,
      method,
      idemKey: `${SKILL_SLUG.split('-')[0]}-${crypto.randomUUID()}`,
      payload,
      originalPayloadSha256,
      createdAt: new Date().toISOString(),
    };
    writeJson(requestFile, request);
  }

  saveState(stateDir, { ...loadState(stateDir), probeStartedAt: new Date().toISOString() });
  let response;
  try {
    response = await fetchOnce(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': request.idemKey,
      },
      body: payload,
    });
  } catch (error) {
    saveState(stateDir, { ...loadState(stateDir), probeStatus: 'unknown', probeAt: new Date().toISOString() });
    stop(`网络请求结果未知：${error?.cause?.code || error?.message || 'network error'}。此状态目录已锁定，勿重复 probe；先检查原订单与服务端日志。`, 2);
  }

  if (response.status === 429) {
    saveState(stateDir, { ...loadState(stateDir), probeStatus: 429, probeAt: new Date().toISOString() });
    stop('服务返回 HTTP 429。立即停止，不自动重试；按平台要求记录并等待。', 2);
  }
  if (response.status !== 402) {
    saveState(stateDir, { ...loadState(stateDir), probeStatus: response.status, probeAt: new Date().toISOString() });
    if (response.status === 200) {
      // No payment proof was sent by probe; fail closed on an unexpected 200.
      stop('未付款 probe 意外返回 HTTP 200（未收到 402 账单）；按服务契约异常停止，不读取或展示响应体。用户拒绝付款或取消时停止付费服务，不进行本地代做或任何免费回退。', 2);
    }
    if (response.status === 400) stop('服务返回 HTTP 400；输入无效且不应创建账单，请修正请求后使用新的状态目录。', 2);
    stop(`服务返回 HTTP ${response.status}，未进入付款流程；不要重复付款或猜测结果。`, 2);
  }

  const bill = response.headers.get('payment-needed');
  if (!bill) {
    saveState(stateDir, { ...loadState(stateDir), probeStatus: '402_missing_payment_needed', probeAt: new Date().toISOString() });
    stop('服务返回 HTTP 402 但没有 Payment-Needed，停止并报告服务契约异常。', 2);
  }
  validateReceivedBill(bill, request.url);
  writePrivate(billFile, bill);
  let summary = {};
  try {
    summary = JSON.parse(Buffer.from(bill, 'base64url').toString('utf8'));
  } catch {
    // Preserve the opaque header exactly; never rewrite it.
  }
  const protocol = summary.protocol || summary;
  const methodInfo = summary.method || {};
  saveState(stateDir, { ...loadState(stateDir), probeStatus: 402, billReceivedAt: new Date().toISOString() });
  console.log('已取得本轮 402 账单（原值已保存，未改写）：');
  console.log(`  金额：${protocol.amount || '?'} ${protocol.currency || ''}`);
  console.log(`  资源：${protocol.resource_id || methodInfo.service_id || '未解析'}`);
  console.log(`  截止时间：${protocol.pay_before || '以账单为准'}`);
  console.log('下一步：调用前已取得该金额授权时，核验账单一致后立即运行 pay --confirm-payment，并实际执行生成的官方指令。');
}

function commonResourceArgs(request) {
  if (Buffer.byteLength(request.payload, 'utf8') > 4096) stop('原请求尚未转换为短引用，不能交给官方 CLI；核查原订单，不得重复付款。', 2);
  return [
    '-r', request.url,
    '-m', request.method,
    '-d', request.payload,
    '-H', 'Content-Type:application/json',
    '-H', `Idempotency-Key:${request.idemKey}`,
  ];
}

/**
 * 生成付款指令之前，确认本上下文已开通支付宝 AI 支付能力。
 * 未开通时 `402-buyer-pay` 依然会创建真实收单交易并出码：钱被扣走，Payment-Proof 却取不回来，
 * 网关永远无法验付与交付，也不会自动退款（10-05 实测 ¥0.10 就是这个下场）。
 * 只读调用官方二进制的 check-wallet；不经 shell、不读密钥、不落盘任何凭证。
 * 该命令在未开通时也以非零码退出但 stdout 是合法 JSON，因此先读 stdout 再判失败。
 */
function assertWalletAuthorizedForPayment(flags) {
  if (flags['confirm-wallet-bound']) return;
  let parsed = null;
  let lastError = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
    for (const bin of [ALIPAY_BOT, 'alipay-bot.exe', 'alipay-bot.cmd']) {
      try {
        parsed = JSON.parse(execFileSync(bin, ['check-wallet', '--json'],
          { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }));
        break;
      } catch (error) {
        lastError = error;
        const stdout = error && typeof error.stdout === 'string' ? error.stdout.trim() : '';
        if (stdout.startsWith('{')) {
          try {
            parsed = JSON.parse(stdout);
            break;
          } catch { /* 继续按失败处理 */ }
        }
        // Windows 新版 node 拒绝无 shell 启动 .cmd（EINVAL）：当作"这个候选不可用"继续试下一个，
        // 而不是当成查询失败——否则只装 .cmd 包装的宿主会被永久误拒。
        if (!error || (error.code !== 'ENOENT' && error.code !== 'EINVAL' && error.code !== 'EPERM')) break;
      }
    }
  }
  if (!parsed) {
    stop('无法确认本机支付宝 AI 支付能力开通状态（'
      + String(lastError && lastError.message || lastError).slice(0, 120)
      + '）。状态未知时不生成付款指令；请宿主实际运行 alipay-bot check-wallet，'
      + '确认为 bound 后加 --confirm-wallet-bound 重试。');
  }
  const status = String(parsed && parsed.status || '').toLowerCase();
  if (status === 'bound' || status === 'active' || status === 'authorized') return;
  if (String(parsed && parsed.code) === '500' && !parsed.status) {
    stop('支付宝支付能力查询暂时不可用（check-wallet 返回查询失败）。这是官方接口的临时状态，'
        + '不代表未开通；状态未知时不生成付款指令，请稍后重试 `alipay-bot check-wallet`。');
  }
  stop('本上下文尚未开通支付宝 AI 支付能力（check-wallet 返回 ' + (status || 'unknown') + '）。'
      + '此时付款依然会被真实扣走，但支付凭证取不回来，会留下已扣款未交付的订单，因此拒绝生成付款指令。'
      + '请由用户本人在付款将要执行的同一目录下完成：alipay-bot apply-wallet → 在支付宝内授权 → '
      + 'alipay-bot bind-wallet -c "<授权码>"，再用 alipay-bot check-wallet 确认 bound。');
}

/**
 * 可选：把官方轮询的终态记进状态目录。只存判定用字段（终态、时间、交易号），
 * 不存 payment_proof、client_session 或支付链接；它不解锁任何流程，仅留证据。
 */
async function cmdRecordPoll(flags) {
  const stateDir = requireStateDir(flags);
  const file = flags['poll-output'];
  if (!file) stop('缺少 --poll-output；请传入官方 poll-payment-status 的输出文件。');
  const target = path.resolve(file);
  if (!fs.existsSync(target)) stop('--poll-output 指定的文件不存在。');
  let outcome = null;
  try {
    outcome = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    const text = fs.readFileSync(target, 'utf8');
    outcome = { status: /success|TRADE_SUCCESS/i.test(text) ? 'SUCCESS' : 'UNKNOWN' };
  }
  const rawStatus = String(outcome.status || outcome.trade_status || outcome.state || '').toUpperCase();
  const success = /SUCCESS/.test(rawStatus);
  if (!success && !/CLOSED|TIMEOUT|FAILED|ERROR|CANCEL/.test(rawStatus)) {
    stop('轮询结果不是终态（status=' + (rawStatus || 'unknown') + '），请继续轮询到终态后再记录。');
  }
  const tradeNo = String(outcome.tradeNo || outcome.trade_no || '');
  saveState(stateDir, {
    ...loadState(stateDir),
    pollReceiptAt: new Date().toISOString(),
    pollReceiptStatus: success ? 'success' : 'terminal-failure',
    ...(/^[0-9A-Za-z]{20,40}$/.test(tradeNo) ? { pollReceiptTradeNo: tradeNo } : {}),
  });
  console.log(JSON.stringify({
    recorded: true,
    terminal: success ? 'success' : 'failure',
    note: success ? '现在可以运行 complete 查询原订单；凭证仍只在宿主会话内脱敏使用。'
      : '该单未成功支付。不要重新下单或二次付款，先向用户确认是否愿意重试。',
  }, null, 2));
}

function paymentArgs(request, flags) {
  if (!flags['session-id']) stop('缺少 --session-id（宿主会话标识）。');
  if (flags['session-id'].length > 256) stop('--session-id 长度异常。');
  const intentSummary = flags['intent-summary']?.trim();
  if (!intentSummary || !intentSummary.startsWith('原始请求：')
      || !intentSummary.slice('原始请求：'.length).trim() || intentSummary.length > 1024) {
    stop('必须提供不超过 1024 字符、以“原始请求：”开头的本次业务目的摘要；概括用户的业务目标，不复制密钥、个人信息或完整输入数据。');
  }
  const args = [
    '402-buyer-pay', '--session-id', flags['session-id'], '-f', FILE_BILL,
    ...commonResourceArgs(request), '--intent-summary', intentSummary,
  ];
  const fingerprint = crypto.createHash('sha256')
    .update(JSON.stringify({ args, url: request.url, idemKey: request.idemKey }))
    .digest('hex');
  return { args, fingerprint };
}

function emitPaymentArgs(stateDir, args, resume) {
  console.log(JSON.stringify({
    executable: ALIPAY_BOT,
    workingDirectory: loadState(stateDir).cliWorkingDirectory || stateDir,
    args: args.map((value, index) => index > 0 && args[index - 1] === '-f' ? path.join(stateDir, FILE_BILL) : value),
    paymentStatus: resume ? 'resume_parameters_prepared_cli_not_confirmed_started' : 'parameters_prepared_cli_not_confirmed_started',
    afterPayment: {
      why: 'Payment-Proof 由官方组件在支付进行过程中捕获；本命令打印后进程即退出，事后 complete 可能取不到凭证。',
      poll: 'alipay-bot poll-payment-status --payment-link "<CLI 返回的支付链接>" --interval 3000 --max-attempts 40',
      record: '到终态后可运行 record-poll 把结果记进状态目录（只记终态与交易号，不记凭证）。',
      then: '再用 complete 查询原订单；不要重新下单或二次付款。',
    },
    resultHandling: 'OPEN_LINK_CREATED 或 success:true 只表示生成操作入口，不能认定已付款或已交付。完整展示本次官方 MEDIA；如页面要求绑定或提示请勿重复绑定，停止重发，处理本宿主授权。只有原订单的官方查询及有效业务结果可支持交付。',
    instruction: resume
      ? '仅当已确认此前从未启动官方 CLI 时执行这条原订单参数；若是否启动不确定，禁止执行，先查询本次官方 CLI 记录。'
      : '仅在用户已明确同意金额后，由宿主 Agent 将 executable 与 args 交给官方 CLI 执行；付款成败以官方 CLI 输出及原订单查单为准。',
  }, null, 2));
}

async function cmdPay(flags) {
  const stateDir = requireStateDir(flags);
  if (!flags['confirm-payment']) stop('缺少 --confirm-payment。该标志仅在用户已明确同意本次金额后使用；本脚本只生成官方 CLI 参数，不会启动付款。');
  assertWalletAuthorizedForPayment(flags);
  const request = loadRequest(stateDir);
  const state = loadState(stateDir);
  if (state.probeStatus !== 402) stop('本状态目录没有已确认的 HTTP 402 账单；不得发起付款。', 2);
  if (state.payHandoffPreparedAt || state.payHandoffIssuedAt) {
    stop('本订单的付款参数此前已准备；本脚本不能判断官方 CLI 是否启动。确认 CLI 从未启动时使用 resume-pay；若状态不确定，禁止重发并查询官方记录。', 2);
  }
  const billFile = path.join(stateDir, FILE_BILL);
  if (!fs.existsSync(billFile)) stop(`状态目录缺少本轮 ${FILE_BILL}；请勿复用其他订单账单。`);
  validateReceivedBill(fs.readFileSync(billFile, 'utf8'), request.url);
  const { args, fingerprint } = paymentArgs(request, flags);
  saveState(stateDir, {
    ...state, cliWorkingDirectory: fs.realpathSync(process.cwd()), payHandoffPreparedAt: new Date().toISOString(),
    payArgsFingerprint: fingerprint, paymentStatus: 'parameters_prepared_cli_not_confirmed_started',
  });
  emitPaymentArgs(stateDir, args, false);
}

async function cmdResumePay(flags) {
  if (!flags['confirm-cli-not-started']) {
    stop('恢复付款参数前必须确认官方 alipay-bot 从未启动；若运行状态不确定，不要重发，请从本次 CLI 输出/记录查询原订单。', 2);
  }
  const stateDir = requireStateDir(flags);
  const request = loadRequest(stateDir);
  const state = loadState(stateDir);
  if (state.probeStatus !== 402 || !state.payHandoffPreparedAt || !fs.existsSync(path.join(stateDir, FILE_BILL))) {
    stop('状态目录没有可恢复的本轮付款参数；不得创建新账单。', 2);
  }
  assertWalletAuthorizedForPayment(flags);
  if (state.officialCliStartedAt) stop('本订单已有官方 CLI 启动记录；禁止 resume-pay，请查询原订单。', 2);
  if (state.payResumeIssuedAt) {
    stop('恢复参数已输出过一次；此后是否启动官方 CLI 无法由本脚本判断。禁止继续重发，先查官方 CLI 记录。', 2);
  }
  const { args, fingerprint } = paymentArgs(request, flags);
  if (fingerprint !== state.payArgsFingerprint) {
    stop('当前宿主会话或业务摘要与原付款参数不一致；停止恢复。只能查询本轮官方订单。', 2);
  }
  saveState(stateDir, {
    ...state, payResumeIssuedAt: new Date().toISOString(),
    paymentStatus: 'resume_parameters_prepared_cli_not_confirmed_started',
  });
  emitPaymentArgs(stateDir, args, true);
}

async function cmdRestage(flags) {
  if (!flags['confirm-ref-expired']) {
    stop('仅在本次官方 CLI 明确报告 STAGE_REF_NOT_FOUND / 引用已过期时重暂存；这会再次向同一服务发送原始请求体。', 2);
  }
  if (!flags['confirm-data-transfer']) {
    stop('重暂存会再次发送原始请求体；缺少 --confirm-data-transfer，停止。', 2);
  }
  const stateDir = requireStateDir(flags);
  const request = loadRequest(stateDir);
  const state = loadState(stateDir);
  if (state.probeStatus !== 402 || !state.payHandoffPreparedAt) {
    stop('仅已取得 402 且已准备原订单付款参数后，才允许恢复暂存引用；不会创建新账单。', 2);
  }
  if ((Number(state.stageRecoveryCount) || 0) >= 1) {
    stop('同一订单的暂存引用恢复次数已达上限；停止继续传输，请核查原订单或联系服务维护者。', 2);
  }
  const sourceFile = path.join(stateDir, FILE_SOURCE_PAYLOAD);
  if (!fs.existsSync(sourceFile)) {
    stop('私有状态目录没有原始大载荷副本；停止，不能用占位引用或新请求替代原订单。', 2);
  }
  const originalPayload = fs.readFileSync(sourceFile, 'utf8');
  const digest = crypto.createHash('sha256').update(originalPayload, 'utf8').digest('hex');
  if (!request.originalPayloadSha256 || digest !== request.originalPayloadSha256) {
    stop('原始请求体校验不匹配；停止，不更改原订单。', 2);
  }
  const stagedPayload = await stageLargePayload(request.url, originalPayload);
  if (!stagedPayload.ref) stop('原始请求不需要暂存；停止，不更改订单。', 2);
  writeJson(path.join(stateDir, FILE_REQUEST), { ...request, payload: stagedPayload.payload });
  saveState(stateDir, {
    ...state,
    stageRecoveryAt: new Date().toISOString(),
    stageRecoveryCount: (state.stageRecoveryCount || 0) + 1,
    stageRecoveryStatus: 'new_ref_ready_same_payload_same_idempotency_key',
  });
  console.log('原始请求体 SHA-256 匹配，已为同一请求和原幂等键生成新引用。没有 probe、没有创建账单；接下来只查询/恢复原订单。');
}

async function queryOriginalOrder(flags, action) {
  const stateDir = requireStateDir(flags);
  const request = loadRequest(stateDir);
  const state = loadState(stateDir);
  if (!state.payHandoffPreparedAt && !state.payHandoffIssuedAt) stop('尚无已准备的本订单付款流程；不得猜测交易号或虚构支付状态。', 2);
  const tradeNo = flags['trade-no'];
  const outShakeNo = flags['out-shake-no'];
  if (Boolean(tradeNo) === Boolean(outShakeNo)) stop(`提供且仅提供一个订单查询号：--trade-no 或 --out-shake-no。`);
  if (outShakeNo && !/^\d{10}8282\d{18}$/.test(outShakeNo)) stop('查询号必须使用官方本次输出的有效 32 位订单号，不得混用商户订单号或支付宝交易号。', 2);
  if (tradeNo && !/^[A-Za-z0-9_.-]{1,128}$/.test(tradeNo)) stop('交易号格式不符合官方查询契约。', 2);
  if (outShakeNo && state.officialObservation?.outShakeNo && outShakeNo !== state.officialObservation.outShakeNo) stop('查询号与本状态目录的官方记录不一致，停止跨订单查询。', 2);
  if (tradeNo && state.officialObservation?.tradeNo && tradeNo !== state.officialObservation.tradeNo) stop('交易号与本状态目录的官方记录不一致，停止跨订单查询。', 2);
  const args = [
    '402-query-payment-status',
    ...(tradeNo ? ['-t', tradeNo] : ['--out-shake-no', outShakeNo]),
    ...commonResourceArgs(request),
  ];
  const handoffAt = new Date().toISOString();
  saveState(stateDir, { ...state, [`${action}HandoffIssuedAt`]: handoffAt });
  console.log(JSON.stringify({
    executable: ALIPAY_BOT,
    workingDirectory: state.cliWorkingDirectory || stateDir,
    args,
    paymentStatus: 'not_verified_by_this_helper',
    instruction: '将参数交给宿主 Agent 调用官方 CLI，只查询/恢复指定原订单；本 helper 不会付款、验付或声称履约成功。',
  }, null, 2));
}

async function cmdComplete(flags) {
  return queryOriginalOrder(flags, 'complete');
}

async function cmdRetry(flags) {
  return queryOriginalOrder(flags, 'retry');
}

async function cmdAck(flags) {
  if (!flags['confirm-ack-failed'] || !flags['confirm-recovery-requested']) stop('官方 buyer-pay/query 在取得资源后会自动发送回执；只有同次官方输出明确表示回执失败并给出交易号，且用户后续明确要求恢复时，才可生成一次独立 ACK。不得正常流程重复回执。', 2);
  const stateDir = requireStateDir(flags);
  const state = loadState(stateDir);
  if (!state.payHandoffPreparedAt && !state.payHandoffIssuedAt) stop('本订单尚未交给官方支付流程；不能生成履约回执。');
  if (!flags['confirm-resource-delivered']) stop('只有在官方 CLI 返回非空资源且已向用户交付后，才能执行 ack。');
  const tradeNo = flags['trade-no'];
  if (!tradeNo || tradeNo.length > 128) stop('ack 需要官方 CLI 本轮输出的 tradeNo；不得使用 outShakeNo。');
  if (state.fulfillmentAckHandoffIssuedAt) stop('本状态目录已生成过履约回执参数；不要重复提交。');
  const args = ['402-buyer-fulfillment-ack', '-t', tradeNo];
  saveState(stateDir, {
    ...state,
    fulfillmentAckHandoffIssuedAt: new Date().toISOString(),
    fulfillmentAckTradeNo: tradeNo,
  });
  console.log(JSON.stringify({
    executable: ALIPAY_BOT,
    args,
    fulfillmentStatus: 'not_verified_by_this_helper',
    instruction: '将参数交给宿主 Agent 调用官方 CLI；本 helper 不会执行回执，也不声称回执成功。',
  }, null, 2));
}

function cmdStatus(flags) {
  const stateDir = requireStateDir(flags);
  const requestFile = path.join(stateDir, FILE_REQUEST);
  if (!fs.existsSync(requestFile)) stop(`状态目录中还没有请求记录；请先运行 probe。`);
  const request = loadRequest(stateDir);
  const state = loadState(stateDir);
  console.log(`服务：${request.url}`);
  console.log(`方法：${request.method}`);
  console.log(`幂等键：${request.idemKey}`);
  console.log(`Payment-Needed：${fs.existsSync(path.join(stateDir, FILE_BILL)) ? '已保存（原值）' : '尚未保存'}`);
  console.log(`probe 状态：${state.probeStatus ?? '未知'}`);
  console.log(`付款参数已准备（待宿主执行官方 CLI）：${state.payHandoffPreparedAt ? '是' : '否'}${state.payResumeIssuedAt ? '；resume 参数已输出过一次' : ''}`);
  console.log(`付款 CLI 参数已交给宿主 Agent：${(state.payHandoffIssuedAt || state.payHandoffPreparedAt) ? '是；支付结果未知，查官方 CLI/原订单' : '否'}`);
  console.log(`最近查单参数交接：${state.completeHandoffIssuedAt || state.retryHandoffIssuedAt || '无'}`);
  console.log(`买方履约回执参数已交接：${state.fulfillmentAckHandoffIssuedAt ? '是；结果以官方 CLI 为准' : '否'}`);
  console.log('为保护隐私，状态回读不显示请求体、账单内容、会话 ID 或 Payment-Proof。');
}

const { command, flags } = parseFlags();
if (flags.help || !command) {
  printUsage();
  process.exitCode = flags.help || command ? 0 : 1;
} else {
  const handlers = { probe: cmdProbe, pay: cmdPay, 'resume-pay': cmdResumePay, 'record-poll': cmdRecordPoll, restage: cmdRestage, complete: cmdComplete, retry: cmdRetry, ack: cmdAck, status: cmdStatus };
  const handler = handlers[command];
  if (!handler) {
    console.error(`错误：未知子命令 ${command}。可用：probe / pay / resume-pay / record-poll / restage / complete / retry / ack / status`);
    process.exitCode = 1;
  } else {
    try {
      await handler(flags);
    } catch (error) {
      if (error instanceof StopError) {
        console.error(`停止：${error.message}`);
        process.exitCode = error.code;
      } else {
        console.error(`停止：${error?.message || 'unexpected error'}`);
        process.exitCode = 1;
      }
    }
  }
}
