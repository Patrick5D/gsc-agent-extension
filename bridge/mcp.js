/**
 * [INPUT]: 接收单条检查、单条提交、批次请求、停止请求、历史查询和自检。
 * [OUTPUT]: 提供检查、提交、批次启动、进度、停止、历史和自检工具。
 * [POS]: 通过本机套接字调用 Chrome，不接触 Google 凭据。查收录默认只读，提交须用户同意。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { runUrl } from './run.js';
import { readHistory } from './history.js';
import { startBatch, readBatch, stopBatch, activeBatch } from './batch.js';
import { doctor } from './doctor.js';
import { version, defaults } from './config.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
// 每个无效网址只报一条原因。
const urlSchema = z.string().superRefine((value, ctx) => {
  const url = URL.canParse(value) ? new URL(value) : null;
  const message = !url || !['http:', 'https:'].includes(url.protocol) ? '请输入完整的 http(s) 网址'
    : url.username || url.password ? '网址不可包含账户密码' : '';
  if (message) ctx.addIssue({code: z.ZodIssueCode.custom, message});
});
// 检查不消耗配额，查收录时默认用它；提交会消耗每个资源每天约 10 次的配额。
const APPROVAL = '会消耗该资源每天约 10 次的提交配额。只在用户本轮明确同意提交这些网址后使用；用户只问收录情况时不要提交。';
const REASON = '结果中的 reason 是 GSC 报告的状态行，未收录时含具体原因，请转告用户。';
const submitMode = z.enum(['submit','if_unindexed']).default('submit').describe('submit 直接请求重抓，if_unindexed 先检查，明确未收录才提交');
const batchMode = z.enum(['inspect','submit','if_unindexed']).default('inspect').describe('默认 inspect 只检查。submit 与 if_unindexed 会提交：' + APPROVAL);
const skipHours = z.number().finite().nonnegative().default(0).describe('仅在指定小时内有已确认提交记录时跳过，默认关闭。只检查模式忽略此项。');
const intervalSchema = z.number().finite().min(0).max(3600).default(defaults.intervalSeconds).describe('每次确认提交后等待的秒数，默认 ' + defaults.intervalSeconds + '。只读检查之间最多等 3 秒。');
const output = value => ({content:[{type:'text', text:JSON.stringify(value)}]});

const server = new McpServer({ name: 'gsc-agent', version });
const timeout = '请允许最多 ' + Math.ceil(defaults.requestTimeoutMs / 1000) + ' 秒；客户端超时较短时改用 gsc_start_batch。';
async function single(url, mode, skipRecentHours) {
  const running = await activeBatch();
  if (running) return {isError:true, ...output({error:'批次 ' + running.id + ' 正在使用浏览器，请等待结束或调用 gsc_stop_batch'})};
  const result = await runUrl(url, mode, skipRecentHours);
  return { isError: Boolean(result.error), ...output(result) };
}
server.registerTool('gsc_inspect_url', {
  description: '只读检查单个 URL 是否已被 Google 收录，不提交、不消耗配额。用户问收录情况时用它。' + timeout + REASON,
  inputSchema: { url:urlSchema }
}, async ({url}) => single(url, 'inspect'));
server.registerTool('gsc_request_indexing', {
  description: '在 GSC 为单个 URL 请求编入索引。' + APPROVAL + '只想知道是否收录请用 gsc_inspect_url。' + timeout + '未确认时请查看页面。' + REASON,
  inputSchema: { url:urlSchema, skip_recent_hours:skipHours, mode:submitMode }
}, async ({url, mode, skip_recent_hours}) => single(url, mode, skip_recent_hours));
server.registerTool('gsc_submission_history', {
  description: '查询本机通过本工具发起的操作，按开始时间倒序。started 表示还没有最终结果。',
  inputSchema: {
    url: z.string().url().optional(),
    status: z.enum(['started','submitted','blocked','unconfirmed','error','inspected','already_indexed','recently_submitted']).optional(),
    limit: z.number().int().min(1).max(100).default(20)
  }
}, async filters => output(await readHistory({...filters, url:filters.url && new URL(filters.url).href})));
server.registerTool('gsc_start_batch', {
  description:'后台顺序检查或提交 URL，同批去重，返回批次 ID。默认只检查。同一时间只运行一个批次。用 gsc_batch_status 查询直到结束。',
  inputSchema:{urls:z.array(urlSchema).min(1).max(500), skip_recent_hours:skipHours, mode:batchMode, interval_seconds:intervalSchema}
}, async ({urls,mode,skip_recent_hours,interval_seconds}) => output(await startBatch(urls,mode,skip_recent_hours,interval_seconds)));
server.registerTool('gsc_batch_status', {
  description:'读取批次进度、每条结果和未开始网址；nextAt 表示下一条的开始时间。只续跑 remaining 中的 URL。',
  inputSchema:{id:z.string().uuid()}
}, async ({id}) => output(await readBatch(id)));
server.registerTool('gsc_stop_batch', {
  description:'请求停止批次。进行中的网址会先执行完，随后状态变为 cancelled。',
  inputSchema:{id:z.string().uuid()}
}, async ({id}) => output(await stopBatch(id)));
server.registerTool('gsc_doctor', {
  description:'检查本机安装、浏览器连接和扩展版本。工具报连接错误时先调用它，按 fix 提示用户处理。',
  inputSchema:{page:z.boolean().default(false).describe('同时在真实 GSC 页面只读核对文案规则：展开资源列表，检查当前资源首页，不提交，约需 10–30 秒。找不到检查框、等不到报告或缺少 reason 时使用')}
}, async ({page}) => output(await doctor({page})));
await server.connect(new StdioServerTransport());
