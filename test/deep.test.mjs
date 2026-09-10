/* Глибша перевірка: супутники, комета, продуктивність, клавіатура,
   резервний режим без astronomy-engine. Запуск: node test/deep.test.mjs */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, createReadStream, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import http from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const serveDir = join(root, '.testserve');
const shots = join(root, 'shots');
mkdirSync(shots, { recursive: true });

const raw = readFileSync(join(root, 'index.html'), 'utf8');
const local = (s) => s
  .replace('https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/astronomy.browser.min.js',
           '/vendor/astronomy.browser.min.js')
  .replace('https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js',
           '/vendor/three-build/three.module.js')
  .replace('https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/',
           '/vendor/three-addons/');
writeFileSync(join(serveDir, 'index.html'), local(raw));
/* Той самий файл, але з навмисно битим шляхом до бібліотеки —
   так перевіряємо резервний кеплерівський режим. */
writeFileSync(join(serveDir, 'offline.html'),
  local(raw).replace('/vendor/astronomy.browser.min.js', '/vendor/nope-404.js'));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const p = join(serveDir, u === '/' ? 'index.html' : u);
  try {
    if (!statSync(p).isFile()) throw new Error('dir');
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    createReadStream(p).pipe(res);
  } catch { res.writeHead(404); res.end('nope'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

let fail = 0;
const problems = [];
const check = (cond, msg) => { if (!cond) { fail += 1; problems.push(msg); } };

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 }, locale: 'uk-UA', colorScheme: 'dark',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => {
  try { localStorage.setItem('sonyachna-systema.v1', JSON.stringify({ seen: true, rate: 'pause' })); } catch {}
});
await page.goto(`${base}/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(2200);

/* Двигун справді підхопився. */
const mode = await page.evaluate(() => (window.Astronomy ? 'engine' : 'none'));
check(mode === 'engine', 'astronomy-engine не завантажився в основному режимі');

/* Земля з Місяцем. */
await page.click('#chips .chip[data-id="earth"]');
await page.waitForTimeout(2200);
const moon = await page.evaluate(() => {
  const m = document.querySelector('#labels .lbl.small');
  const list = Array.from(document.querySelectorAll('#labels .lbl'))
    .filter((n) => n.classList.contains('on')).map((n) => n.textContent);
  return { labels: list, hasMoon: list.includes('Місяць') };
});
check(moon.hasMoon, `біля Землі не видно Місяця, підписи: ${moon.labels.join(', ')}`);
await page.screenshot({ path: join(shots, 'deep-earth.png') });

/* Юпітер із галілеєвими супутниками. */
await page.click('#chips .chip[data-id="jupiter"]');
await page.waitForTimeout(2400);
const gal = await page.evaluate(() => {
  const on = Array.from(document.querySelectorAll('#labels .lbl'))
    .filter((n) => n.classList.contains('on')).map((n) => n.textContent);
  return { on, names: ['Іо', 'Європа', 'Ганімед', 'Каллісто'].filter((n) => on.includes(n)) };
});
check(gal.names.length === 4,
  `галілеєвих супутників видно ${gal.names.length}/4 — ${gal.on.join(', ')}`);
await page.screenshot({ path: join(shots, 'deep-jupiter.png') });

/* Комета: у 2061-му вона має бути яскравою й близько до Сонця. */
await page.click('#card-close');
await page.click('#btn-fit');
await page.waitForTimeout(1700);
const comet = await page.evaluate(() => {
  const target = new Date('2061-07-28T00:00:00Z');
  const days = Math.round((target - Date.now()) / 86400000);
  const s = document.getElementById('time-slider');
  s.max = String(Math.max(Number(s.max), days));
  s.value = String(days);
  s.dispatchEvent(new Event('input', { bubbles: true }));
  return days;
});
await page.waitForTimeout(900);
const cometState = await page.evaluate(() => ({
  date: document.getElementById('time-date').textContent,
  opacity: window.World ? window.World.comet.head.material.opacity : null,
}));
check(/2061/.test(cometState.date), `не долетіли до 2061: «${cometState.date}»`);
await page.screenshot({ path: join(shots, 'deep-comet.png') });

/* Клавіатура: пробіл ставить час на паузу і знімає з неї. */
await page.click('#btn-now');
await page.waitForTimeout(400);
await page.locator('#gl').focus();
const beforeRate = await page.evaluate(() => document.querySelector('#rates .rate[aria-pressed="true"]')?.dataset.rate);
await page.keyboard.press('Space');
await page.waitForTimeout(250);
const afterRate = await page.evaluate(() => document.querySelector('#rates .rate[aria-pressed="true"]')?.dataset.rate);
check(beforeRate !== afterRate, `пробіл не перемкнув темп (${beforeRate} → ${afterRate})`);

await page.keyboard.press('4');
await page.waitForTimeout(1600);
const byKey = await page.evaluate(() => document.getElementById('card-name').textContent);
check(byKey === 'Марс', `клавіша 4 відкрила «${byKey}» замість Марса`);

await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check(await page.evaluate(() => document.getElementById('card').hidden), 'Esc не закрив картку');

/* Продуктивність: середній кадр у прольоті над системою. */
await page.evaluate(() => {
  const s = document.getElementById('rates').querySelector('[data-rate="year"]');
  s.click();
});
const fps = await page.evaluate(() => new Promise((resolve) => {
  let frames = 0;
  const t0 = performance.now();
  const tick = () => {
    frames += 1;
    if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
    else resolve(Math.round((frames * 1000) / (performance.now() - t0)));
  };
  requestAnimationFrame(tick);
}));
console.log(`  кадрів за секунду під софтверним рендером: ${fps}`);
check(fps >= 12, `надто повільно навіть для swiftshader: ${fps} fps`);

/* Пам'ять і кількість викликів малювання. */
const stats = await page.evaluate(() => {
  const r = window.World && window.World.renderer;
  return r ? { calls: r.info.render.calls, tris: r.info.render.triangles,
               geos: r.info.memory.geometries, texs: r.info.memory.textures } : null;
});
if (stats) {
  console.log(`  draw calls: ${stats.calls}, трикутників: ${stats.tris}, ` +
              `геометрій: ${stats.geos}, текстур: ${stats.texs}`);
  check(stats.calls < 60, `забагато викликів малювання: ${stats.calls}`);
}

const real = errors.filter((e) => !/favicon|WebGL-0x|GL Driver/i.test(e));
check(real.length === 0, `помилки консолі: ${real.slice(0, 4).join(' | ')}`);
await ctx.close();

/* ── Резервний режим: бібліотеки немає, застосунок мусить працювати ── */
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'uk-UA' });
const p2 = await ctx2.newPage();
const err2 = [];
p2.on('pageerror', (e) => err2.push(e.message));
await p2.addInitScript(() => {
  try { localStorage.setItem('sonyachna-systema.v1', JSON.stringify({ seen: true })); } catch {}
});
await p2.goto(`${base}/offline.html`, { waitUntil: 'load' });
await p2.waitForTimeout(2400);
const off = await p2.evaluate(() => ({
  hasLib: !!window.Astronomy,
  booted: document.getElementById('boot').classList.contains('off'),
  labels: document.querySelectorAll('#labels .lbl.on').length,
  note: document.getElementById('engine-note').hidden,
  moon: document.getElementById('moon-name').textContent,
}));
check(!off.hasLib, 'резервний тест не спрацював — бібліотека все одно завантажилась');
check(off.booted, 'без бібліотеки застосунок не запустився');
check(off.labels >= 5, `у резервному режимі видно лише ${off.labels} підписів`);
check(!off.note, 'не показано попередження про резервний режим');
check(off.moon !== '—', 'у резервному режимі не порахувалась фаза Місяця');
await p2.click('#btn-sky');
await p2.waitForTimeout(500);
const skyOff = await p2.evaluate(() => document.getElementById('sky-list').textContent);
check(/недоступн|бібліотек/i.test(skyOff), 'розділ «На небі» не пояснив, чому він порожній');
await p2.screenshot({ path: join(shots, 'deep-fallback.png') });
check(err2.length === 0, `помилки в резервному режимі: ${err2.slice(0, 3).join(' | ')}`);
await ctx2.close();

await browser.close();
server.close();

if (problems.length) {
  console.log('\nПроблеми:');
  for (const p of problems) console.log(`  • ${p}`);
}
console.log(`\n${fail ? `${fail} проблем` : 'усе чисто'}\n`);
process.exit(fail ? 1 : 0);
