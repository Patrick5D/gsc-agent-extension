/**
 * [INPUT]: 接收单条操作、批次请求、停止请求、历史查询和自检。
 * [OUTPUT]: 提供单条操作、批次启动、进度、停止、历史和自检工具。
 * [POS]: 通过本机套接字调用 Chrome，不接触 Google 凭据。
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
const modeSchema = z.enum(['submit','inspect','if_unindexed']).default('submit');
const skipHours = z.number().finite().nonnegative().default(0).describe('仅在指定小时内有已确认提交记录时跳过，默认关闭。只检查模式忽略此项。');
const intervalSchema = z.number().finite().min(0).max(3600).default(defaults.intervalSeconds).describe('每次确认提交后等待的秒数，默认 ' + defaults.intervalSeconds + '。只读检查之间最多等 3 秒。');
const output = value => ({content:[{type:'text', text:JSON.stringify(value)}]});

const server = new McpServer({ name: 'gsc-agent', version });
server.registerTool('gsc_request_indexing', {
  description: '在用户已连接的 GSC 标签页为单个 URL 请求编入索引。请允许最多 ' + Math.ceil(defaults.requestTimeoutMs / 1000) + ' 秒；客户端超时较短时改用 gsc_start_batch。未确认时请查看页面。',
  inputSchema: { url:urlSchema, skip_recent_hours:skipHours, mode:modeSchema.describe('submit 请求重抓，inspect 只检查，if_unindexed 只提交明确未收录的页面') }
}, async ({url, mode, skip_recent_hours}) => {
  const running = await activeBatch();
  if (running) return {isError:true, ...output({error:'批次 ' + running.id + ' 正在使用浏览器，请等待结束或调用 gsc_stop_batch'})};
  const result = await runUrl(url, mode, skip_recent_hours);
  return { isError: Boolean(result.error), ...output(result) };
});
server.registerTool('gsc_submission_history', {
  description: '查询本机通过本工具发起的操作，按开始时间倒序。started 表示还没有最终结果。',
  inputSchema: {
    url: z.string().url().optional(),
    status: z.enum(['started','submitted','blocked','unconfirmed','error','inspected','already_indexed','recently_submitted']).optional(),
    limit: z.number().int().min(1).max(100).default(20)
  }
}, async filters => output(await readHistory({...filters, url:filters.url && new URL(filters.url).href})));
server.registerTool('gsc_start_batch', {
  description:'后台顺序处理 URL，同批去重，返回批次 ID。同一时间只运行一个批次。用 gsc_batch_status 查询直到结束。',
  inputSchema:{urls:z.array(urlSchema).min(1).max(500), skip_recent_hours:skipHours, mode:modeSchema, interval_seconds:intervalSchema}
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
  inputSchema:{}
}, async () => output(await doctor()));
await server.connect(new StdioServerTransport());
