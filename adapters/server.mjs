import { createServer, request as httpRequest } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompanionRuntime, PROJECT, readJson } from './runtime.mjs';
import { toUtterances } from '../upstream/OpenMausBot/server/tts/speech-text.ts';
import { installRealtimeAsr } from './realtime-asr.mjs';
import { VoiceSession } from './voice-session.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};
const allowedApi = [
  ['POST', /^\/api\/attachments$/],
  ['GET', /^\/api\/attachments\/[a-f0-9-]+\.(png|jpg|gif|webp)$/],
  // Chat documents upload to native /api/files (v0.1.121 serves back only images and audio, so no GET rule).
  ['POST', /^\/api\/files$/],
  ['GET', /^\/api\/(health|edition|bots|config|events)$/],
  ['GET', /^\/api\/threads\/[\w-]+\/messages$/],
  ['POST', /^\/api\/threads\/[\w-]+\/messages\/[\w-]+\/file$/],
  ['GET', /^\/api\/bots\/[\w-]+\/memory\/(file|journal)$/],
  ['PUT', /^\/api\/bots\/[\w-]+\/memory\/file$/],
  ['POST', /^\/api\/bots\/[\w-]+\/memory\/journal\/[\w-]+\/revert$/],
  ['POST', /^\/api\/bots\/[\w-]+\/(interrupt|respond)$/],
  ['POST', /^\/api\/tts\/(prepare|speak)$/],
  ['GET', /^\/api\/tts\/voices$/],
  ['GET', /^\/api\/bots\/[\w-]+\/browser\/live$/],
  ['POST', /^\/api\/bots\/[\w-]+\/browser\/action$/],
  ['GET', /^\/api\/bots\/[\w-]+\/computer\/control$/],
  ['POST', /^\/api\/bots\/[\w-]+\/computer\/control$/],
];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
async function bodyBytes(req, max = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw fail('请求内容超过大小限制。', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  if (
    !String(req.headers['content-type'] || '')
      .toLowerCase()
      .startsWith('application/json')
  )
    throw fail('请求需要 JSON 格式。', 415);
  try {
    const data = JSON.parse((await bodyBytes(req)).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch (error) {
    if (error.status) throw error;
    throw fail('JSON 请求格式无效。');
  }
}
function equalToken(a, b) {
  const left = Buffer.from(a || ''),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function createCompanionServer(options = {}) {
  const runtime = options.runtime || new CompanionRuntime({ forceFixture: options.forceFixture });
  await runtime.start();
  const port = options.port ?? 5217;
  const origins = new Set([`http://127.0.0.1:${port}`, ...(options.devOrigin ? [options.devOrigin] : [])]);
  const cookieName = `companion_${port}`;
  const cookie = randomBytes(32).toString('base64url');
  const dist = join(PROJECT, 'app', 'dist');
  const sseConnections = new Set();
  const voiceSession = new VoiceSession({ changed: () => realtime.reset('语音已切换到另一个页面，这里已暂停。') });
  const json = (res, status, value) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(JSON.stringify(value));
  };
  const serviceResult = async (res, action) => {
    try {
      return json(res, 200, await action());
    } catch (error) {
      throw fail(error.message, error.status || 400);
    }
  };
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host;
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw fail('请求路径无效。', 403);
      const allowedHosts = new Set([
        `127.0.0.1:${port}`,
        ...(options.devOrigin ? [new URL(options.devOrigin).host] : []),
      ]);
      if (!allowedHosts.has(host)) throw fail('此服务仅接受指定的本地地址。', 403);
      if (req.headers.origin && !origins.has(req.headers.origin)) throw fail('拒绝跨来源请求。', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw fail('拒绝跨站点请求。', 403);
      const url = new URL(req.url, `http://${host}`);
      const path = url.pathname;
      const method = req.method || 'GET';
      const routeIsApi = path.startsWith('/api/') || path.startsWith('/companion/');
      if (routeIsApi && path !== '/companion/info') {
        const presented = (req.headers.cookie || '')
          .split(';')
          .map((value) => value.trim())
          .find((value) => value.startsWith(cookieName + '='))
          ?.slice(cookieName.length + 1);
        if (!equalToken(presented, cookie)) throw fail('请从本地助理页面重新连接。', 401);
      }
      if (path === '/companion/info' && method === 'GET') {
        res.setHeader('set-cookie', `${cookieName}=${cookie}; HttpOnly; SameSite=Strict; Path=/`);
        return json(res, 200, await runtime.info());
      }
      if (
        method !== 'GET' &&
        method !== 'HEAD' &&
        routeIsApi &&
        !req.headers.origin &&
        req.headers['sec-fetch-site'] !== undefined
      )
        throw fail('修改请求缺少来源。', 403);
      if (path === '/companion/settings/conversation' && method === 'GET')
        return json(res, 200, runtime.conversationSettings.snapshot());
      if (path === '/companion/settings/conversation' && method === 'POST')
        return json(res, 200, runtime.conversationSettings.update(await jsonBody(req)));
      if (path === '/companion/settings/events' && method === 'GET') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'x-accel-buffering': 'no',
        });
        const send = (value) => {
          if (!res.destroyed) res.write(`data: ${JSON.stringify(value)}\n\n`);
        };
        send(runtime.conversationSettings.snapshot());
        const unsubscribe = runtime.conversationSettings.subscribe(send),
          timer = setInterval(() => {
            if (!res.destroyed) res.write(': keepalive\n\n');
          }, 15000);
        sseConnections.add(res);
        res.on('close', () => {
          unsubscribe();
          clearInterval(timer);
          sseConnections.delete(res);
        });
        return;
      }
      if (path === '/companion/services' && method === 'GET') return json(res, 200, runtime.services.snapshot());
      if (path === '/companion/search' && method === 'GET') {
        if ([...url.searchParams.keys()].some((key) => key !== 'q')) throw fail('搜索参数无效。');
        return json(res, 200, await runtime.search(url.searchParams.get('q')));
      }
      const reaction = /^\/companion\/messages\/([\w-]+)\/reactions$/.exec(path);
      if (reaction && method === 'POST') return json(res, 200, await runtime.react(reaction[1], await jsonBody(req)));
      if (path === '/companion/today' && method === 'GET') return json(res, 200, await runtime.today());
      if (path === '/companion/brief' && method === 'GET') return json(res, 200, runtime.services.briefSettings());
      if (path === '/companion/brief' && method === 'POST') {
        const body = await jsonBody(req);
        return await serviceResult(res, () => runtime.services.setBrief(body));
      }
      if (path === '/companion/style' && method === 'GET') return json(res, 200, runtime.chiefStyle());
      if (path === '/companion/style' && method === 'POST') return json(res, 200, await runtime.setChiefStyle(await jsonBody(req)));
      // Secret cards: the value goes in the POST body once, is saved by the native settings route and never comes back.
      if (path === '/companion/cards/secret' && method === 'POST') return json(res, 200, await runtime.provideSecret(await jsonBody(req)));
      if (path === '/companion/cards/secret/dismiss' && method === 'POST') return json(res, 200, await runtime.dismissSecret(await jsonBody(req)));
      if (path === '/companion/cards/sign-in' && method === 'POST') return json(res, 200, await runtime.answerSignIn(await jsonBody(req)));
      if (path === '/companion/notifications' && method === 'GET') return json(res, 200, await runtime.notifications());
      if (path === '/companion/notifications/read-all' && method === 'POST') return json(res, 200, await runtime.readNotification('all'));
      const nativeRead = /^\/companion\/notifications\/native\/([\w-]+)\/read$/.exec(path);
      if (nativeRead && method === 'POST') return json(res, 200, await runtime.readNotification('native', nativeRead[1]));
      if (path === '/companion/mail' && method === 'GET') return json(res, 200, await runtime.mail.snapshot());
      if (path === '/companion/mail' && method === 'POST')
        return json(res, 201, await runtime.mail.add(await jsonBody(req)));
      const mailRepair = /^\/companion\/mail\/([\w-]+)\/repair$/.exec(path);
      if (mailRepair && method === 'POST')
        return json(res, 200, await runtime.mail.repair(mailRepair[1], await jsonBody(req)));
      const mailAction = /^\/companion\/mail\/([\w-]+)\/(test|disable|enable|reauth)$/.exec(path);
      if (mailAction && method === 'POST')
        return json(res, 200, await runtime.mail.action(mailAction[1], mailAction[2]));
      if (path === '/companion/routines' && method === 'GET') return json(res, 200, await runtime.workflows.snapshot());
      if (path === '/companion/goals' && method === 'GET') return json(res, 200, await runtime.goals.snapshot());
      if (path === '/companion/goals' && method === 'POST')
        return json(res, 201, await runtime.goals.create(await jsonBody(req)));
      const goalRoute = /^\/companion\/goals\/([\w-]+)(?:\/(send|pause))?$/.exec(path);
      if (goalRoute) {
        if (method === 'GET' && !goalRoute[2]) return json(res, 200, await runtime.goals.snapshot(goalRoute[1]));
        if (method === 'POST' && goalRoute[2])
          return json(
            res,
            200,
            goalRoute[2] === 'send'
              ? await runtime.goals.send(goalRoute[1], await jsonBody(req))
              : await runtime.goals.pause(goalRoute[1]),
          );
      }
      if (path === '/companion/routines' && method === 'POST')
        return json(res, 201, await runtime.workflows.create(await jsonBody(req)));
      const routineAction = /^\/companion\/routines\/([\w-]+)\/(pause|resume|run|cancel)$/.exec(path);
      if (routineAction && method === 'POST')
        return json(res, 200, await runtime.workflows.action(routineAction[1], routineAction[2]));
      const artifactRoute = /^\/companion\/work\/([\w-]+)\/artifacts(?:\/(preview|download))?$/.exec(path);
      if (artifactRoute) {
        const files = runtime.artifactFiles(artifactRoute[1]);
        if (!artifactRoute[2] && method === 'GET') return json(res, 200, { artifacts: files.listArtifacts() });
        if (method === 'POST' && artifactRoute[2]) {
          const input = await jsonBody(req);
          if (typeof input.path !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256 || ''))
            throw fail('文件标识无效。');
          if (artifactRoute[2] === 'preview') return json(res, 200, await files.preview(input.path, input.sha256));
          const { bytes, row } = files.verified(input.path, input.sha256);
          res.writeHead(200, {
            'content-type':
              row.kind === 'document'
                ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.path.split(/[\\/]/).at(-1))}`,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          });
          res.end(bytes);
          return;
        }
        throw fail('成果操作不存在。', 404);
      }
      if (path === '/companion/capabilities' && method === 'GET')
        return json(res, 200, await runtime.capabilities.snapshot());
      if (path === '/companion/desktop' && method === 'GET') return json(res, 200, runtime.desktopHost.status());
      if (path === '/companion/desktop' && method === 'POST') {
        const body = await jsonBody(req);
        if (!['install', 'start', 'stop'].includes(body.action) || Object.keys(body).length !== 1)
          throw fail('电脑连接操作无效。');
        if (body.action === 'stop') {
          const { bots } = await runtime.api(runtime.current, 'GET', '/api/bots');
          if (
            bots.some(
              (bot) =>
                [runtime.current.chiefId, ...runtime.current.helperIds].includes(bot.id) &&
                bot.computer === 'local' &&
                bot.tasks.some((task) => task.busy),
            )
          )
            throw fail('先停止使用这台电脑的工作，再关闭连接。', 409);
        }
        const result = await runtime.desktopHost[body.action]();
        if (body.action !== 'install') {
          runtime.capabilities.data.computerHostEnabled = body.action === 'start';
          runtime.capabilities.save();
        }
        return json(res, 200, result);
      }
      const desktopFrame = /^\/companion\/desktop\/([a-f0-9-]{36})\/frame$/.exec(path);
      if (desktopFrame && method === 'GET') {
        await runtime.capabilities.member(desktopFrame[1]);
        if (runtime.capabilities.settings(desktopFrame[1]).computer !== 'local')
          throw fail('先为这位助理启用本机电脑。', 403);
        const abort = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) abort.abort();
        });
        return json(res, 200, await runtime.desktopHost.frame(abort.signal));
      }
      const botCapabilities = /^\/companion\/capabilities\/bots\/([a-f0-9-]{36})$/.exec(path);
      if (botCapabilities && method === 'POST')
        return json(res, 200, await runtime.capabilities.configure(botCapabilities[1], await jsonBody(req)));
      const skills = /^\/companion\/skills\/([a-f0-9-]{36})(?:\/([a-z0-9-]{1,64}))?$/.exec(path);
      if (skills && method === 'GET')
        return json(
          res,
          200,
          await runtime.capabilities.skills(skills[1], skills[2] ? 'read' : 'list', undefined, skills[2]),
        );
      if (skills && method === 'POST' && ['create', 'import'].includes(skills[2]))
        return json(res, 201, await runtime.capabilities.skills(skills[1], skills[2], await jsonBody(req)));
      if (skills && method === 'PATCH' && skills[2])
        return json(res, 200, await runtime.capabilities.skills(skills[1], 'toggle', await jsonBody(req), skills[2]));
      if (path.startsWith('/companion/mcp/') && ['GET', 'POST', 'PUT', 'PATCH'].includes(method))
        return json(
          res,
          200,
          await runtime.capabilities.mcp(
            method,
            path.slice('/companion/mcp'.length),
            method === 'GET' ? undefined : await jsonBody(req),
          ),
        );
      if (path === '/companion/voice/session' && method === 'POST') {
        const body = await jsonBody(req);
        return await serviceResult(res, () => voiceSession.act(body.action, body.id));
      }
      if (path === '/companion/folders' && method === 'POST') {
        const body = await jsonBody(req);
        return await serviceResult(res, () => runtime.services.folders.grant(body.path, body.writable ?? false));
      }
      const folderAction = /^\/companion\/folders\/([\w-]+)\/(revoke|files)$/.exec(path);
      if (folderAction && method === 'POST')
        return await serviceResult(res, () =>
          folderAction[2] === 'revoke'
            ? runtime.services.folders.revoke(folderAction[1])
            : runtime.services.folders.list(folderAction[1]),
        );
      if (path === '/companion/preferences' && method === 'POST') {
        const body = await jsonBody(req);
        return await serviceResult(res, () => runtime.services.propose(body.text));
      }
      const preferenceAction = /^\/companion\/preferences\/([\w-]+)\/(confirm|reject|forget)$/.exec(path);
      if (preferenceAction && method === 'POST')
        return await serviceResult(res, () => runtime.services.preference(preferenceAction[1], preferenceAction[2]));
      if (path === '/companion/reminders' && method === 'POST') {
        const body = await jsonBody(req);
        return await serviceResult(res, () => runtime.services.createReminder(body));
      }
      const reminderAction = /^\/companion\/reminders\/([\w-]+)\/(cancel|pause|resume)$/.exec(path);
      if (reminderAction && method === 'POST')
        return await serviceResult(res, () => runtime.services.reminder(reminderAction[1], reminderAction[2]));
      const eventAction = /^\/companion\/notifications\/([\w-]+)\/read$/.exec(path);
      if (eventAction && method === 'POST') {
        const item = runtime.services.data.events.find((row) => row.id === eventAction[1]);
        if (!item) throw fail('提醒记录不存在。', 404);
        item.seen = true;
        runtime.services.save();
        return json(res, 200, { seen: true });
      }
      if (method !== 'GET' && method !== 'HEAD' && routeIsApi && !req.headers.origin) {
        // The cookie capability also permits local test clients; browsers always send an Origin on these mutations.
        if (req.headers['sec-fetch-site'] !== undefined) throw fail('修改请求缺少来源。', 403);
      }
      if (path === '/companion/send' && method === 'POST')
        return json(res, 202, await runtime.send(await jsonBody(req)));
      if (path === '/companion/team/specialists' && method === 'POST')
        return json(res, 201, await runtime.createSpecialist(await jsonBody(req)));
      if (path === '/companion/team/rename' && method === 'POST')
        return json(res, 200, await runtime.renameAssistant(await jsonBody(req)));
      if (path === '/companion/settings/model' && method === 'POST') {
        const previous = runtime.current?.sessionId;
        const result = await runtime.configureModel(await jsonBody(req));
        realtime.reset();
        if (previous !== result.sessionId) for (const stream of sseConnections) stream.destroy();
        return json(res, 200, result);
      }
      if (path === '/companion/settings/asr' && method === 'POST')
        return json(res, 200, runtime.configureAsr(await jsonBody(req)));
      if (path === '/companion/reachai/instances' && method === 'POST') {
        const abort = new AbortController();
        res.on('close', () => !res.writableEnded && abort.abort());
        return json(res, 200, await runtime.reachaiInstances(await jsonBody(req), abort.signal));
      }
      if (path === '/companion/settings/reachai' && method === 'POST') {
        const previous = runtime.current?.sessionId;
        const result = await runtime.configureReachai(await jsonBody(req));
        realtime.reset();
        if (previous !== result.sessionId) for (const stream of sseConnections) stream.destroy();
        return json(res, 200, result);
      }
      const evidence = /^\/companion\/work\/([\w-]+)\/evidence$/.exec(path);
      if (evidence && method === 'GET') return json(res, 200, await runtime.evidence(evidence[1]));
      const retry = /^\/companion\/work\/([\w-]+)\/retry$/.exec(path);
      if (retry && method === 'POST') return json(res, 202, await runtime.retryWork(retry[1], await jsonBody(req)));
      const addition = /^\/companion\/work\/([\w-]+)\/add$/.exec(path);
      if (addition && method === 'POST')
        return json(res, 202, await runtime.addToWork(addition[1], await jsonBody(req)));
      const reply = /^\/companion\/work\/([\w-]+)\/reply$/.exec(path);
      if (reply && method === 'POST') return json(res, 202, await runtime.replyToHelper(reply[1], await jsonBody(req)));
      if (path === '/companion/transcribe' && method === 'POST') {
        voiceSession.assert(req.headers['x-companion-voice-session']);
        const settings = readJson(runtime.settingsFile, {}).asr;
        const usingReachai = runtime.activeProvider() === 'reachai';
        if (!usingReachai && (!settings?.url || !settings.model)) throw fail('先连接语音识别服务。', 409);
        const contentType = req.headers['content-type'] || '';
        if (!contentType.startsWith('multipart/form-data;')) throw fail('录音格式无效。', 415);
        const incoming = new Request('http://127.0.0.1/upload', {
          method: 'POST',
          headers: { 'content-type': contentType },
          body: await bodyBytes(req, 12 * 1024 * 1024),
        });
        const input = await incoming.formData();
        const file = input.get('file');
        if (!(file instanceof File) || file.size === 0 || !/^(audio|video)\//.test(file.type))
          throw fail('没有收到有效录音。');
        const abort = new AbortController();
        res.on('close', () => !res.writableEnded && abort.abort());
        if (usingReachai) return json(res, 200, await runtime.reachaiClient().transcribe(file, abort.signal));
        const outgoing = new FormData();
        outgoing.append('file', file);
        outgoing.append('model', settings.model);
        outgoing.append('language', 'zh');
        const response = await fetch(settings.url, {
          method: 'POST',
          headers: settings.key ? { authorization: `Bearer ${settings.key}` } : {},
          body: outgoing,
          redirect: 'error',
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]),
        });
        if (!response.ok) throw fail(`识别服务返回 ${response.status}，请检查地址、模型和密钥。`, 502);
        const result = await response.json();
        if (typeof result.text !== 'string') throw fail('识别服务没有返回文字。', 502);
        return json(res, 200, { text: result.text.slice(0, 20000) });
      }
      if (
        runtime.activeProvider() === 'reachai' &&
        method === 'POST' &&
        ['/api/tts/prepare', '/api/tts/speak'].includes(path)
      ) {
        const body = await jsonBody(req);
        if (
          typeof body.text !== 'string' ||
          !body.text.trim() ||
          body.text.length > (path.endsWith('/prepare') ? 20000 : 500)
        )
          throw fail('播报内容为空或超过长度限制。');
        const client = runtime.reachaiClient();
        if (path.endsWith('/prepare'))
          return json(res, 200, {
            ready: !!client.config.ttsId,
            utterances: toUtterances(body.text, { maxChars: 240 }),
          });
        const abort = new AbortController();
        res.on('close', () => !res.writableEnded && abort.abort());
        const response = await client.speech(body.text.trim(), abort.signal);
        res.writeHead(200, {
          'content-type': 'audio/mpeg',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'x-companion-audio-mode': 'stream',
        });
        if (!response.body) throw fail('没有收到音频。', 502);
        let total = 0;
        for await (const chunk of response.body) {
          total += chunk.length;
          if (total > 16 * 1024 * 1024) throw fail('音频超过大小限制。', 502);
          if (!res.write(chunk))
            await new Promise((resolve, reject) => {
              const cleanup = () => {
                res.off('drain', drained);
                res.off('close', closed);
              };
              const drained = () => {
                cleanup();
                resolve();
              };
              const closed = () => {
                cleanup();
                reject(new Error('playback closed'));
              };
              res.once('drain', drained);
              res.once('close', closed);
            });
        }
        return res.end();
      }
      if (path === '/api/config' && method === 'PUT') {
        const body = await jsonBody(req);
        if (
          Object.keys(body).some((key) => key !== 'tts') ||
          !body.tts ||
          Object.keys(body.tts).some(
            (key) => !['provider', 'voice', 'key', 'fishKey', 'baseUrl', 'model', 'fishModel'].includes(key),
          )
        )
          throw fail('这个入口只保存声音设置。', 403);
        return json(res, 200, await runtime.api(runtime.current, method, path, body));
      }
      const nativeResponse = /^\/api\/bots\/([\w-]+)\/respond$/.exec(path);
      if (nativeResponse && method === 'POST') {
        const body = await jsonBody(req);
        await runtime.capabilities.member(nativeResponse[1]);
        const goal = runtime.goals.rows.find(
          (row) => row.chiefId === runtime.current.chiefId && row.threadId === body.threadId,
        );
        if (goal) return json(res, 200, await runtime.goals.respond(goal, nativeResponse[1], body));
        const skills = await runtime.api(runtime.current, 'GET', `/api/bots/${nativeResponse[1]}/skills`);
        if (body.reviewedSha256 || skills.staged?.length) runtime.capabilities.archiveNative('skill-review');
        return json(res, 200, await runtime.api(runtime.current, 'POST', path, body));
      }
      if (path.startsWith('/api/') && allowedApi.some(([verb, pattern]) => method === verb && pattern.test(path))) {
        const browserBot = /^\/api\/bots\/([\w-]+)\/(?:browser|computer)\//.exec(path);
        if (browserBot) await runtime.capabilities.member(browserBot[1]);
        const session = runtime.current;
        const target = new URL(path + url.search, session.url);
        const headers = {
          host: target.host,
          origin: session.url,
          ...(session.ownerToken ? { 'x-openmausbot-desktop-owner': session.ownerToken } : {}),
        };
        for (const name of ['content-type', 'last-event-id', 'accept'])
          if (req.headers[name]) headers[name] = req.headers[name];
        const proxy = httpRequest(target, { method, headers }, (upstream) => {
          const passthrough = {};
          for (const name of ['content-type', 'cache-control', 'content-disposition', 'content-length'])
            if (upstream.headers[name]) passthrough[name] = upstream.headers[name];
          res.writeHead(upstream.statusCode || 502, {
            ...passthrough,
            'x-content-type-options': 'nosniff',
            'cache-control': path === '/api/events' ? 'no-cache' : 'no-store',
          });
          upstream.pipe(res);
        });
        proxy.on('error', () => {
          if (!res.headersSent) json(res, 502, { error: '本地助理服务暂时未连接。' });
          else res.destroy();
        });
        if (path === '/api/events' || path.endsWith('/browser/live')) {
          sseConnections.add(proxy);
          res.on('close', () => {
            sseConnections.delete(proxy);
            proxy.destroy();
          });
        } else {
          proxy.setTimeout(60000, () => proxy.destroy());
          res.on('close', () => !res.writableEnded && proxy.destroy());
        }
        if (['POST', 'PUT', 'PATCH'].includes(method))
          proxy.end(await bodyBytes(req, path === '/api/attachments' || path === '/api/files' ? 10 * 1024 * 1024 : 1024 * 1024));
        else proxy.end();
        return;
      }
      if (routeIsApi) throw fail('这个入口不存在。', 404);
      if (!['GET', 'HEAD'].includes(method)) throw fail('方法不允许。', 405);
      let asset;
      try {
        asset = resolve(dist, '.' + decodeURIComponent(path === '/' ? '/index.html' : path));
      } catch {
        throw fail('路径无效。');
      }
      if (!asset.startsWith(resolve(dist) + '/') && !asset.startsWith(resolve(dist) + '\\'))
        throw fail('路径不允许。', 403);
      if (!existsSync(asset) || !statSync(asset).isFile()) throw fail('页面资源不存在，请先构建。', 404);
      // Silero runs the same-origin ONNX WASM backend. Allow its compilation
      // without enabling JavaScript eval, inline scripts, or remote code.
      res.writeHead(200, {
        'content-type': MIME[extname(asset)] || 'application/octet-stream',
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'same-origin',
        'content-security-policy':
          "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
      });
      if (method === 'HEAD') res.end();
      else createReadStream(asset).pipe(res);
    } catch (error) {
      if (res.headersSent) res.destroy();
      else
        json(res, error.status || 500, {
          error: error.status ? error.message : '处理未完成，请重试或检查本地服务日志。',
        });
    }
  });
  const realtime = installRealtimeAsr(server, (req) => {
    const streamUrl = new URL(req.url, `http://127.0.0.1:${port}`);
    if (
      streamUrl.pathname !== '/companion/asr/stream' ||
      req.headers.host !== `127.0.0.1:${port}` ||
      !origins.has(req.headers.origin)
    )
      throw fail('实时录音来源未授权。', 403);
    const presented = (req.headers.cookie || '')
      .split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith(cookieName + '='))
      ?.slice(cookieName.length + 1);
    if (!equalToken(presented, cookie)) throw fail('请重新连接本地页面。', 401);
    voiceSession.assert(streamUrl.searchParams.get('session'));
    const config = runtime.reachaiClient().config;
    if (config.asrMode !== 'realtime') throw fail('先在声音设置中启用实时识别。', 409);
    return config;
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  } catch (error) {
    await realtime.close();
    await runtime.close();
    throw error;
  }
  return {
    server,
    runtime,
    url: `http://127.0.0.1:${port}`,
    async close() {
      for (const stream of sseConnections) stream.destroy();
      await realtime.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await runtime.close();
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createCompanionServer({
    port: Number(process.env.COMPANION_PORT) || 5217,
    forceFixture: process.argv.includes('--fixture'),
  });
  console.log(JSON.stringify({ url: app.url, mode: app.runtime.current.mode, pid: process.pid }));
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (text) => {
    if (text.trim() === 'quit') void stop();
  });
}
