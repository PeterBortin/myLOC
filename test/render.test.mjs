/* Рендер-перевірка у справжньому браузері.
   Локальні копії three.js і astronomy-engine підміняють CDN, щоб тест
   не залежав від мережі. Знімає скріншоти у двох темах і двох розмірах,
   ловить помилки консолі й WebGL. Запуск: node test/render.test.mjs */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const serveDir = join(root, '.testserve');
const shots = join(root, 'shots');
mkdirSync(shots, { recursive: true });

/* Тестова збірка: CDN → локальні файли. */
const html = readFileSync(join(root, 'index.html'), 'utf8')
  .replace('https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/astronomy.browser.min.js',
           '/vendor/astronomy.browser.min.js')
  .replace('https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js',
           '/vendor/three-build/three.module.js')
  .replace('https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/',
           '/vendor/three-addons/');
writeFileSync(join(serveDir, 'index.html'), html);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.css': 'text/css', '.wasm': 'application/wasm',
};
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const path = join(serveDir, url === '/' ? 'index.html' : url);
  try {
    if (!statSync(path).isFile()) throw new Error('dir');
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
    createReadStream(path).pipe(res);
  } catch {
    res.writeHead(404); res.end('nope');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

let fail = 0;
const problems = [];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-lcd-text'],
});

const CASES = [
  { name: 'desktop-dark', w: 1440, h: 900, theme: 'dark' },
  { name: 'desktop-light', w: 1440, h: 900, theme: 'light' },
  { name: 'mobile-dark', w: 390, h: 844, theme: 'dark', mobile: true },
  { name: 'mobile-light', w: 390, h: 844, theme: 'light', mobile: true },
];

for (const c of CASES) {
  const ctx = await browser.newContext({
    viewport: { width: c.w, height: c.h },
    deviceScaleFactor: 1,
    isMobile: !!c.mobile,
    hasTouch: !!c.mobile,
    locale: 'uk-UA',
    colorScheme: c.theme,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.addInitScript(() => {
    try { localStorage.setItem('sonyachna-systema.v1', JSON.stringify({ seen: true })); } catch {}
  });
  await page.goto(`${base}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(2600);

  const state = await page.evaluate(() => ({
    booted: getComputedStyle(document.getElementById('boot')).display === 'none'
            || document.getElementById('boot').classList.contains('off'),
    theme: document.documentElement.dataset.theme,
    chips: document.querySelectorAll('#chips .chip').length,
    labelsOn: document.querySelectorAll('#labels .lbl.on').length,
    date: document.getElementById('time-date').textContent,
    moon: document.getElementById('moon-name').textContent,
    engineHidden: document.getElementById('engine-note').hidden,
    canvasW: document.getElementById('gl').width,
    canvasH: document.getElementById('gl').height,
    scrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));

  const check = (cond, msg) => { if (!cond) { fail += 1; problems.push(`[${c.name}] ${msg}`); } };
  check(state.booted, 'екран завантаження не зник');
  check(state.theme === c.theme, `тема ${state.theme} замість ${c.theme}`);
  check(state.chips === 10, `чипсів ${state.chips}, очікували 10`);
  check(state.labelsOn >= 5, `видимих підписів ${state.labelsOn}, замало`);
  check(/\d{4}/.test(state.date), `дата виглядає дивно: «${state.date}»`);
  check(state.moon && state.moon !== '—', 'фаза Місяця не порахувалась');
  check(state.engineHidden, 'astronomy-engine не підхопився (показано резервний режим)');
  check(state.canvasW > 0 && state.canvasH > 0, 'canvas нульового розміру');
  check(!state.scrollX, 'зʼявився горизонтальний скрол');

  await page.screenshot({ path: join(shots, `${c.name}.png`) });

  /* Клік по Юпітеру через чипс + перевірка картки. */
  await page.click('#chips .chip[data-id="jupiter"]');
  await page.waitForTimeout(1900);
  const card = await page.evaluate(() => ({
    open: !document.getElementById('card').hidden,
    name: document.getElementById('card-name').textContent,
    stats: document.querySelectorAll('#card-body .stat').length,
    facts: document.querySelectorAll('#card-body .facts li').length,
    moons: document.querySelectorAll('#card-body .moon-row').length,
    jump: document.querySelectorAll('#card-body .jump-bar').length,
    galileanVisible: window.View ? window.View.showGalilean : null,
  }));
  check(card.open, 'картка не відкрилась');
  check(card.name === 'Юпітер', `у картці «${card.name}»`);
  check(card.stats >= 6, `статистик ${card.stats}, замало`);
  check(card.facts === 4, `фактів ${card.facts}`);
  check(card.moons === 4, `галілеєвих супутників у картці ${card.moons}`);
  check(card.jump === 2, 'немає шкали стрибка');
  await page.screenshot({ path: join(shots, `${c.name}-card.png`) });

  /* Кнопки режимів мусять лишатись доступними: на десктопі вони від'їжджають
     від картки, на мобілці картка їх ховає — тож там її треба закрити. */
  const sideReachable = await page.evaluate(() => {
    const b = document.getElementById('btn-sizes').getBoundingClientRect();
    const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { hit: !!el && el.closest('#btn-sizes') !== null, narrow: window.innerWidth < 900 };
  });
  if (!sideReachable.narrow) {
    check(sideReachable.hit, 'на десктопі картка перекриває кнопки режимів');
  } else {
    check(!sideReachable.hit, 'на мобілці кнопки режимів мали б сховатись під карткою');
    await page.click('#card-close');
    await page.waitForTimeout(400);
  }

  /* Порівняння розмірів. */
  await page.click('#btn-sizes');
  await page.waitForTimeout(500);
  const sizes = await page.evaluate(() => ({
    open: !document.getElementById('sizes').hidden,
    verdict: document.getElementById('sizes-verdict').textContent,
    canvasW: document.getElementById('sizes-canvas').width,
  }));
  check(sizes.open, 'вікно розмірів не відкрилось');
  check(sizes.canvasW > 100, 'полотно порівняння порожнє');
  check(/1321|1 321/.test(sizes.verdict.replace(/ /g, ' ')),
        `вердикт не збігся з відомим фактом: «${sizes.verdict}»`);
  await page.screenshot({ path: join(shots, `${c.name}-sizes.png`) });
  await page.click('#sizes .close');

  /* Небо. */
  await page.click('#btn-sky');
  await page.waitForTimeout(600);
  const sky = await page.evaluate(() => ({
    rows: document.querySelectorAll('#sky-list .sky-row').length,
    text: document.getElementById('sky-list').textContent,
  }));
  check(sky.rows === 8, `рядків неба ${sky.rows}`);
  check(/горизонт/.test(sky.text), 'у небі немає слова про горизонт');
  await page.screenshot({ path: join(shots, `${c.name}-sky.png`) });
  await page.click('#sky .close');

  /* Справжній масштаб. */
  await page.click('#btn-scale');
  await page.waitForTimeout(3000);
  const morph = await page.evaluate(() => ({
    morph: window.View ? window.View.morph : null,
    label: document.getElementById('btn-scale').textContent.trim(),
  }));
  check(morph.morph === null || morph.morph > 0.98, `морф застряг на ${morph.morph}`);
  check(/Повернути/.test(morph.label), `підпис кнопки: «${morph.label}»`);
  await page.screenshot({ path: join(shots, `${c.name}-real.png`) });

  /* Машина часу: перемотати на рік уперед. */
  await page.click('#btn-scale');
  await page.waitForTimeout(2900);
  await page.evaluate(() => {
    const s = document.getElementById('time-slider');
    s.value = '3650';
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(700);
  const t = await page.evaluate(() => document.getElementById('time-date').textContent);
  check(/20(3[5-9]|4\d)/.test(t), `після перемотки дата «${t}»`);

  const real = errors.filter((e) => !/favicon|Download the React|WebGL-0x/i.test(e));
  if (real.length) {
    fail += real.length;
    problems.push(`[${c.name}] помилки консолі:\n      ${real.slice(0, 6).join('\n      ')}`);
  }

  await ctx.close();
  console.log(`  ${real.length || !state.booted ? 'FAIL' : 'ok  '} ${c.name}`);
}

await browser.close();
server.close();

if (problems.length) {
  console.log('\nПроблеми:');
  for (const p of problems) console.log(`  • ${p}`);
}
console.log(`\n${fail ? `${fail} проблем` : 'усе чисто'}\n`);
process.exit(fail ? 1 : 0);
