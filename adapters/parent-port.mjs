import { installWorkspaceHook } from './workspace-hook.mjs';
// OpenMausBot v0.1.121 expects Electron's utilityProcess parentPort, while this local launcher uses Node IPC.
if (!process.send || !process.connected) throw new Error('The companion harness requires a private IPC parent.');
Object.defineProperty(process, 'parentPort', {
  value: {
    on(event, listener) { if (event === 'message') process.on('message', data => listener({ data })); },
    postMessage(data) { if (process.connected) process.send(data, () => {}); },
  },
});
const shutdown=()=>{if(process.listenerCount('SIGTERM'))process.emit('SIGTERM');else process.exit(0);};
process.on('message',message=>{if(message?.type==='companion:shutdown')shutdown();});
process.once('disconnect', shutdown);
installWorkspaceHook();
