const { spawn, execSync } = require('child_process');
const net = require('net');

const ROOT = __dirname;
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const BOT_PORT = parseInt(process.env.BOT_API_PORT || '3001', 10);
const DASH_PORT = 4567;

let bot, dashboard;

function portInUse(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => { s.close(); resolve(true); });
    s.once('listening', () => { s.close(); resolve(false); });
    s.listen(port);
  });
}

function killByPattern(pattern, excludePid) {
  try {
    const exclude = excludePid || process.pid;
    const out = execSync(`pgrep -f "${pattern}" 2>/dev/null`, { encoding: 'utf-8', timeout: 3000 }).trim();
    if (out) {
      const pids = out.split('\n').filter(Boolean).filter(p => parseInt(p) !== exclude);
      if (pids.length) execSync(`kill -9 ${pids.join(' ')} 2>/dev/null`, { stdio: 'ignore', timeout: 3000 });
    }
  } catch {}
}

function killProc(proc) {
  if (!proc) return;
  proc.removeAllListeners();
  try { execSync(`kill -9 -${proc.pid} 2>/dev/null`, { stdio: 'ignore', timeout: 3000 }); } catch {}
  try { execSync(`kill -9 ${proc.pid} 2>/dev/null`, { stdio: 'ignore', timeout: 3000 }); } catch {}
}

async function freePort(port, killPatterns) {
  for (const p of killPatterns) killByPattern(p, process.pid);
  await new Promise(r => setTimeout(r, 600));
  if (await portInUse(port)) {
    for (const p of killPatterns) killByPattern(p, process.pid);
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function waitPortFree(port, timeout = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!(await portInUse(port))) return;
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`${YELLOW}[WARN]${RESET} Port ${port} still in use after ${timeout}ms`);
}

function makeProcess(name, label, cmd, args) {
  const proc = spawn(cmd, args, { cwd: ROOT, shell: true, stdio: 'pipe', detached: true });
  const tag = `${label}[${name}]${RESET}`;
  proc.stdout.on('data', d => process.stdout.write(`${tag} ${d}`));
  proc.stderr.on('data', d => process.stderr.write(`${RED}${tag}${RESET} ${d}`));
  proc.on('error', e => console.error(`${RED}${tag}${RESET} Error: ${e.message}`));
  return proc;
}

async function startBot() {
  killProc(bot); bot = null;
  console.log(`${YELLOW}[BOT]${RESET} Freeing port ${BOT_PORT}...`);
  await freePort(BOT_PORT, ['tsx.*src/index', 'tsx.*index\\.ts']);
  await waitPortFree(BOT_PORT);
  console.log(`${YELLOW}[BOT]${RESET} Starting...`);
  bot = makeProcess('BOT', CYAN, 'npm', ['run', 'dev:bot']);
  bot.on('exit', code => {
    if (bot) console.log(`${YELLOW}[BOT]${RESET} Exited (code ${code})`);
  });
}

async function startDashboard() {
  killProc(dashboard); dashboard = null;
  console.log(`${YELLOW}[DASH]${RESET} Freeing port ${DASH_PORT}...`);
  await freePort(DASH_PORT, ['node.*--watch.*server\\.js', 'node.*server\\.js']);
  await waitPortFree(DASH_PORT);
  console.log(`${YELLOW}[DASH]${RESET} Starting...`);
  dashboard = makeProcess('DASH', GREEN, 'npm', ['run', 'dev:dashboard']);
  dashboard.on('exit', code => {
    if (dashboard) console.log(`${YELLOW}[DASH]${RESET} Exited (code ${code})`);
  });
}

async function stopAll() {
  killProc(bot); bot = null;
  killProc(dashboard); dashboard = null;
  killByPattern('tsx.*src/index', process.pid);
  await new Promise(r => setTimeout(r, 300));
}

process.on('SIGINT', async () => { await stopAll(); process.exit(0); });
process.on('SIGTERM', async () => { await stopAll(); process.exit(0); });
process.on('exit', () => killByPattern('tsx.*src/index', process.pid));

function clearConsole() { process.stdout.write('\x1bc'); }

console.log(`${BOLD}${CYAN}╔══════════════════════════════════╗${RESET}`);
console.log(`${BOLD}${CYAN}║       Gapat Bot Dev Runner       ║${RESET}`);
console.log(`${BOLD}${CYAN}╚══════════════════════════════════╝${RESET}`);
console.log('');
console.log(`Commands:`);
console.log(`  ${GREEN}rs bot${RESET}        Restart bot only`);
console.log(`  ${GREEN}rs dashboard${RESET}  Restart dashboard only`);
console.log(`  ${GREEN}rs all${RESET}        Restart both`);
console.log(`  ${GREEN}rs${RESET}            Restart both (alias)`);
console.log(`  ${GREEN}clear${RESET}         Clear terminal`);
console.log(`  ${GREEN}quit${RESET}          Stop all and exit`);
console.log('');

startBot();
startDashboard();

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (input) => {
  const cmd = input.trim().toLowerCase();
  if (cmd === 'rs bot' || cmd === 'rs b') {
    console.log(`${YELLOW}♻ Restarting bot...${RESET}`);
    startBot();
  } else if (cmd === 'rs dashboard' || cmd === 'rs d' || cmd === 'rs dash') {
    console.log(`${YELLOW}♻ Restarting dashboard...${RESET}`);
    startDashboard();
  } else if (cmd === 'rs all' || cmd === 'rs' || cmd === 'rs a') {
    console.log(`${YELLOW}♻ Restarting both...${RESET}`);
    startBot();
    startDashboard();
  } else if (cmd === 'clear' || cmd === 'cls') {
    clearConsole();
  } else if (cmd === 'quit' || cmd === 'exit') {
    console.log(`${YELLOW}Shutting down...${RESET}`);
    stopAll().then(() => process.exit(0));
  }
});