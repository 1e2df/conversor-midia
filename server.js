// Conversor de links -> MP3 / MP4 (uso pessoal, roda localmente)
// Requer: Node 18+, yt-dlp e ffmpeg (winget install yt-dlp.yt-dlp)
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const PORT = process.env.PORT || 3000;
const TMP = path.join(os.tmpdir(), 'conversor-midia');
fs.mkdirSync(TMP, { recursive: true });

// ---------- localizar binÃ¡rios ----------
function findBin(name) {
  const exe = process.platform === 'win32' ? name + '.exe' : name;
  const candidates = [
    path.join(__dirname, 'bin', exe),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', exe),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'cloudflared', exe),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'cloudflared', exe),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  // instalaÃ§Ãµes do winget ficam em ...\WinGet\Packages\<pacote>\[subpasta\bin\]<exe>
  const pkgs = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
  if (pkgs && fs.existsSync(pkgs)) {
    const walk = (dir, depth) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isFile() && e.name.toLowerCase() === exe.toLowerCase()) return p;
        if (e.isDirectory() && depth > 0) { const r = walk(p, depth - 1); if (r) return r; }
      }
      return null;
    };
    const r = walk(pkgs, 3);
    if (r) return r;
  }
  try {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
    return execFileSync(cmd, [name], { encoding: 'utf8' }).split(/\r?\n/)[0].trim() || null;
  } catch { return null; }
}
const YTDLP = findBin('yt-dlp');
const FFMPEG = findBin('ffmpeg');
const DENO = findBin('deno'); // runtime JS que o yt-dlp usa para o YouTube
const CHILD_ENV = { ...process.env };
const extraPath = [FFMPEG, DENO].filter(Boolean).map((p) => path.dirname(p));
if (extraPath.length) CHILD_ENV.PATH = extraPath.join(path.delimiter) + path.delimiter + (process.env.PATH || '');

// ---------- acesso remoto ----------
const PAGES_URL = process.env.PAGES_URL || 'https://1e2df.github.io/conversor-midia/';
const ALLOWED_ORIGINS = [new URL(PAGES_URL).origin, 'localhost'];

// senha gerada na 1Âª execuÃ§Ã£o e guardada em config.json (fora do git)
const CONFIG_FILE = path.join(__dirname, 'config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}
if (!config.senha) {
  config.senha = crypto.randomBytes(6).toString('base64url');
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
const PASSWORD = process.env.SENHA || config.senha;

// pedidos que chegam pelo tÃºnel trazem o cabeÃ§alho cf-connecting-ip; os locais nÃ£o
const isRemote = (req) => !!req.headers['cf-connecting-ip'];
function authorized(req) {
  if (!isRemote(req)) return true;
  const a = Buffer.from(String(req.headers['x-senha'] || ''));
  const b = Buffer.from(PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- jobs ----------
const jobs = new Map(); // id -> { status, progress, speed, eta, title, file, error, dir, created }

function buildArgs(url, format, quality, dir) {
  const args = [
    '--no-playlist', '--newline', '--no-warnings', '--restrict-filenames',
    '--progress-template', 'download:PROG|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
    '--print', 'before_dl:TITLE|%(title)s', '--no-simulate',
    '-o', path.join(dir, '%(title).120B.%(ext)s'),
  ];
  if (FFMPEG) args.push('--ffmpeg-location', path.dirname(FFMPEG));
  if (format === 'mp3') {
    const kbps = ['320', '192', '128'].includes(quality) ? quality : '192';
    args.push('-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', kbps + 'K', '--embed-metadata');
  } else {
    const res = ['2160', '1080', '720', '480', '360'].includes(quality) ? `res:${quality},` : '';
    // prioriza H.264 + AAC para mÃ¡xima compatibilidade do .mp4
    args.push('-f', 'bv*+ba/b', '-S', `${res}vcodec:h264,acodec:m4a`, '--merge-output-format', 'mp4', '--remux-video', 'mp4');
  }
  args.push(url);
  return args;
}

function startJob(url, format, quality) {
  const id = crypto.randomBytes(8).toString('hex');
  const dir = path.join(TMP, id);
  fs.mkdirSync(dir, { recursive: true });
  const job = { status: 'baixando', progress: 0, speed: '', eta: '', title: '', file: null, error: null, dir, created: Date.now(), format };
  jobs.set(id, job);

  const proc = spawn(YTDLP, buildArgs(url, format, quality, dir), { windowsHide: true, env: CHILD_ENV });
  let stderr = '';
  const onLine = (line) => {
    if (line.startsWith('TITLE|')) { job.title = line.slice(6); return; }
    if (line.startsWith('PROG|')) {
      const [, pct, speed, eta] = line.split('|');
      const p = parseFloat(pct);
      if (!isNaN(p)) {
        if (p < job.progress - 50) job.status = 'baixando Ã¡udio'; // 2Âº stream (vÃ­deo + Ã¡udio separados)
        job.progress = Math.min(99, p);
      }
      job.speed = (speed || '').trim(); job.eta = (eta || '').trim();
      return;
    }
    if (/\[(ExtractAudio|Merger|VideoRemuxer|Metadata)\]/.test(line)) job.status = 'convertendo';
  };
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    const lines = buf.split(/\r?\n/); buf = lines.pop();
    lines.forEach(onLine);
  });
  proc.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
  proc.on('error', (e) => { job.status = 'erro'; job.error = e.message; });
  proc.on('close', (code) => {
    const want = '.' + format;
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(want));
    if (code === 0 && files.length) {
      job.file = path.join(dir, files[0]);
      job.status = 'pronto'; job.progress = 100;
      if (!job.title) job.title = path.parse(files[0]).name;
    } else {
      job.status = 'erro';
      const msg = (stderr.match(/ERROR:.*$/m) || [stderr.trim().split('\n').pop() || `yt-dlp saiu com cÃ³digo ${code}`])[0];
      job.error = friendlyError(msg);
    }
  });
  return id;
}

function friendlyError(msg) {
  if (/login|sign in|cookies|rate-limit|private/i.test(msg))
    return 'Este conteÃºdo exige login ou Ã© privado (comum no Instagram). Detalhe: ' + msg;
  if (/Unsupported URL/i.test(msg)) return 'Link nÃ£o suportado.';
  if (/ffmpeg|ffprobe/i.test(msg)) return 'ffmpeg nÃ£o encontrado. Instale com: winget install yt-dlp.FFmpeg';
  return msg.replace(/^ERROR:\s*/, '');
}

// limpeza: apaga arquivos com mais de 1 hora
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, j] of jobs) {
    if (j.created < cutoff) { fs.rm(j.dir, { recursive: true, force: true }, () => {}); jobs.delete(id); }
  }
}, 10 * 60 * 1000);

// ---------- HTTP ----------
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}
function isValidUrl(s) {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');

  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.some((o) => o === origin || (o === 'localhost' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Senha');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, 'docs', 'index.html')).pipe(res);
  }

  if (req.method === 'GET' && u.pathname === '/api/status') {
    return json(res, 200, { ytdlp: !!YTDLP, ffmpeg: !!FFMPEG, needsAuth: isRemote(req), authorized: authorized(req) });
  }

  // tudo abaixo (menos o download por id, que jÃ¡ Ã© um link secreto) exige senha quando vem pela internet
  if (u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/file/') && !authorized(req)) {
    return json(res, 401, { error: 'Senha incorreta.' });
  }

  if (req.method === 'POST' && u.pathname === '/api/convert') {
    if (!YTDLP) return json(res, 500, { error: 'yt-dlp nÃ£o encontrado. Instale com: winget install yt-dlp.yt-dlp' });
    const { url, format, quality } = await readBody(req);
    if (!isValidUrl(url)) return json(res, 400, { error: 'Cole um link vÃ¡lido (http/https).' });
    if (!['mp3', 'mp4'].includes(format)) return json(res, 400, { error: 'Formato invÃ¡lido.' });
    return json(res, 200, { id: startJob(url, format, String(quality || '')) });
  }

  let m;
  if (req.method === 'GET' && (m = u.pathname.match(/^\/api\/job\/([a-f0-9]{16})$/))) {
    const j = jobs.get(m[1]);
    if (!j) return json(res, 404, { error: 'Tarefa nÃ£o encontrada.' });
    const { status, progress, speed, eta, title, error } = j;
    return json(res, 200, { status, progress: Math.round(progress), speed, eta, title, error });
  }

  if (req.method === 'GET' && (m = u.pathname.match(/^\/api\/file\/([a-f0-9]{16})$/))) {
    const j = jobs.get(m[1]);
    if (!j || !j.file || !fs.existsSync(j.file)) return json(res, 404, { error: 'Arquivo nÃ£o disponÃ­vel.' });
    const name = path.basename(j.file);
    res.writeHead(200, {
      'Content-Type': j.format === 'mp3' ? 'audio/mpeg' : 'video/mp4',
      'Content-Length': fs.statSync(j.file).size,
      'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
    return fs.createReadStream(j.file).pipe(res);
  }

  json(res, 404, { error: 'NÃ£o encontrado' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Conversor rodando em http://localhost:${PORT}`);
  console.log(`yt-dlp: ${YTDLP || 'NÃƒO ENCONTRADO'}`);
  console.log(`ffmpeg: ${FFMPEG || 'NÃƒO ENCONTRADO'}`);
  if (process.env.TUNNEL !== '0') startTunnel();
});

// ---------- tÃºnel Cloudflare (expÃµe o servidor para o site no GitHub Pages) ----------
function startTunnel() {
  const bin = findBin('cloudflared');
  if (!bin) {
    console.log('\ncloudflared nÃ£o encontrado â€” sÃ³ uso local. Instale com: winget install Cloudflare.cloudflared');
    return;
  }
  console.log('\nAbrindo tÃºnel Cloudflare...');
  const t = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { windowsHide: true });
  let shown = false;
  const scan = (d) => {
    const m = d.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !shown) {
      shown = true;
      const link = `${PAGES_URL}?server=${encodeURIComponent(m[0])}`;
      fs.writeFileSync(path.join(__dirname, 'link-atual.txt'), link + '\n');
      console.log('\n==============================================================');
      console.log(' Abra este link (no PC ou no celular):');
      console.log(' ' + link);
      console.log(' Senha: ' + PASSWORD);
      console.log('==============================================================\n');
      if (process.platform === 'win32' && process.env.OPEN !== '0') spawn('cmd', ['/c', 'start', '', link], { windowsHide: true });
    }
  };
  t.stdout.on('data', scan);
  t.stderr.on('data', scan);
  t.on('close', (c) => console.log(`TÃºnel encerrado (cÃ³digo ${c}).`));
  process.on('exit', () => t.kill());
  process.on('SIGINT', () => process.exit());
}
