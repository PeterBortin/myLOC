/* Headless-харнес на чисту логіку. Запуск: node test/logic.test.mjs
   Перевіряє кеплерівський пропагатор, масштабні функції та форматери
   без DOM, three.js і astronomy-engine. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (n) => readFileSync(join(here, '..', 'src', n), 'utf8');

/* Вантажимо тільки ті частини, що не залежать від браузера. */
const ctx = vm.createContext({ Math, Date, console, Number, JSON, Intl, Array, Object, String });
vm.runInContext(src('10-data.js'), ctx);
vm.runInContext(src('20-astro.js'), ctx);
vm.runInContext(src('30-scale.js'), ctx);

/* Верхньорівневі const/let живуть у лексичному скоупі контексту, а не на
   globalThis, тому дістаємо їх вираженням, а не через ctx.<name>. */
const ev = (expr) => vm.runInContext(expr, ctx);
const A = {
  Astro: ev('Astro'), TRAVEL: ev('TRAVEL'), AU_KM: ev('AU_KM'),
  halleyPosition: ev('halleyPosition'), solveKepler: ev('solveKepler'),
  phaseName: ev('phaseName'), compassName: ev('compassName'),
  scaleDistance: ev('scaleDistance'), scaleRadius: ev('scaleRadius'),
  fmtInt: ev('fmtInt'), fmtNum: ev('fmtNum'), fmtDuration: ev('fmtDuration'),
  fmtTravel: ev('fmtTravel'), fmtRotation: ev('fmtRotation'),
  pluralUa: ev('pluralUa'), jumpHeight: ev('jumpHeight'),
  travelTime: ev('travelTime'), BODIES: ev('BODIES'), fmtDate: ev('fmtDate'),
};

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass += 1; console.log(`  ok   ${name}`); }
  catch (err) { fail += 1; console.log(`  FAIL ${name}\n       ${err.message}`); }
}
const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} != ${b} (±${tol})`);

const eclipticLon = (v) => {
  /* назад із three-орієнтації {x, y:z_ecl, z:−y_ecl} в екліптичну довготу */
  const lon = Math.atan2(-v.z, v.x) * 180 / Math.PI;
  return ((lon % 360) + 360) % 360;
};
const radius = (v) => Math.hypot(v.x, v.y, v.z);

console.log('\nКеплерівський розв\'язувач');

test('solveKepler: e=0 дає E=M', () => {
  near(A.solveKepler( 90, 0), Math.PI / 2, 1e-12);
  near(A.solveKepler( 0, 0), 0, 1e-12);
});

test('solveKepler: справджує рівняння M = E − e·sinE', () => {
  for (const e of [0.01, 0.2, 0.5, 0.9, 0.96658]) {
    for (const M of [5, 47, 133, 250, 355]) {
      const E = A.solveKepler( M, e);
      const back = (E - e * Math.sin(E)) * 180 / Math.PI;
      const want = ((M % 360) + 540) % 360 - 180;
      near(((back % 360) + 540) % 360 - 180, want, 1e-8, `e=${e} M=${M}`);
    }
  }
});

console.log('\nПозиції планет (резервний пропагатор)');

test('Земля: відстань від Сонця тримається в 0,983…1,017 а.о.', () => {
  for (let m = 0; m < 12; m += 1) {
    const r = radius(A.Astro.helio('earth', new Date(Date.UTC(2026, m, 15))));
    assert.ok(r > 0.980 && r < 1.020, `місяць ${m + 1}: r=${r}`);
  }
});

test('Земля: перигелій на початку січня, афелій на початку липня', () => {
  const jan = radius(A.Astro.helio('earth', new Date(Date.UTC(2026, 0, 3))));
  const jul = radius(A.Astro.helio('earth', new Date(Date.UTC(2026, 6, 5))));
  assert.ok(jan < jul, `січень ${jan} має бути ближче за липень ${jul}`);
  near(jan, 0.9833, 0.0015, 'перигелій');
  near(jul, 1.0167, 0.0015, 'афелій');
});

test('Земля: на весняне рівнодення геліоцентрична довгота ≈180°', () => {
  const lon = eclipticLon(A.Astro.helio('earth', new Date(Date.UTC(2026, 2, 20, 14, 46))));
  near(lon, 180, 0.4, 'рівнодення 20.03.2026');
});

test('Земля: на осіннє рівнодення геліоцентрична довгота ≈0°', () => {
  const lon = eclipticLon(A.Astro.helio('earth', new Date(Date.UTC(2026, 8, 23, 0, 5))));
  const d = Math.min(lon, 360 - lon);
  near(d, 0, 0.4, 'рівнодення 23.09.2026');
});

test('Усі планети: відстань у межах свого афелію й перигелію', () => {
  const bounds = {
    mercury: [0.307, 0.467], venus: [0.718, 0.728], earth: [0.983, 1.017],
    mars: [1.381, 1.666], jupiter: [4.95, 5.46], saturn: [9.02, 10.05],
    uranus: [18.28, 20.10], neptune: [29.80, 30.33], pluto: [29.65, 49.31],
  };
  for (const [id, [lo, hi]] of Object.entries(bounds)) {
    for (let y = 2024; y <= 2032; y += 2) {
      const r = radius(A.Astro.helio(id, new Date(Date.UTC(y, 5, 1))));
      assert.ok(r >= lo - 0.02 && r <= hi + 0.02, `${id} ${y}: r=${r} поза [${lo}, ${hi}]`);
    }
  }
});

test('Планети рухаються в правильний бік і з правильним періодом', () => {
  const periods = { mercury: 87.97, venus: 224.7, earth: 365.26, mars: 686.98 };
  for (const [id, days] of Object.entries(periods)) {
    const t0 = new Date(Date.UTC(2026, 0, 1));
    const t1 = new Date(t0.getTime() + days * 86400000);
    const a = eclipticLon(A.Astro.helio(id, t0));
    const b = eclipticLon(A.Astro.helio(id, t1));
    const diff = Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    near(diff, 0, 0.6, `${id} за повний період повернувся не туди`);
  }
});

test('Плутон: орбіта справді похила — z не нульове', () => {
  const v = A.Astro.helio('pluto', new Date(Date.UTC(2026, 0, 1)));
  assert.ok(Math.abs(v.y) > 2, `очікували помітний вихід із площини, маємо y=${v.y}`);
});

test('Комета Галлея: перигелій ≈0,59 а.о., афелій ≈35 а.о.', () => {
  let lo = 1e9, hi = -1e9;
  for (let d = 0; d < 27600; d += 7) {
    const r = radius(A.halleyPosition(new Date(Date.UTC(2020, 0, 1) + d * 86400000)));
    if (r < lo) lo = r;
    if (r > hi) hi = r;
  }
  near(lo, 0.586, 0.02, 'перигелій');
  near(hi, 35.08, 0.5, 'афелій');
});

test('Комета Галлея: наступний перигелій справді у 2061-му', () => {
  let best = 1e9, bestYear = 0;
  for (let y = 2055; y <= 2065; y += 1) {
    for (let m = 0; m < 12; m += 1) {
      const r = radius(A.halleyPosition(new Date(Date.UTC(y, m, 15))));
      if (r < best) { best = r; bestYear = y; }
    }
  }
  assert.equal(bestYear, 2061, `мінімум відстані випав на ${bestYear}`);
});

console.log('\nФаза Місяця');

test('phaseName відносить кути до правильних фаз', () => {
  assert.equal(A.phaseName(0).name, 'Новий Місяць');
  assert.equal(A.phaseName(359).name, 'Новий Місяць');
  assert.equal(A.phaseName(4).name, 'Новий Місяць');
  assert.equal(A.phaseName(45).name, 'Молодий серп');
  assert.equal(A.phaseName(90).name, 'Перша чверть');
  assert.equal(A.phaseName(135).name, 'Місяць доростає');
  assert.equal(A.phaseName(180).name, 'Повний Місяць');
  assert.equal(A.phaseName(225).name, 'Місяць спадає');
  assert.equal(A.phaseName(270).name, 'Остання чверть');
  assert.equal(A.phaseName(315).name, 'Старий серп');
});

test('назва чверті збігається з часткою освітлення', () => {
  /* Освітлена частка = (1 − cos d)/2. «Чверть» має означати ≈50 %,
     а не будь-що між 50 і 75 %, як виходило при пошуку найближчого центра. */
  const illum = (d) => (1 - Math.cos(d * Math.PI / 180)) / 2;
  for (let d = 0; d < 360; d += 1) {
    const n = A.phaseName(d).name;
    const f = illum(d);
    if (n.includes('чверть')) {
      assert.ok(Math.abs(f - 0.5) < 0.08, `${d}°: «${n}» при освітленні ${(f * 100).toFixed(0)} %`);
    }
    if (n === 'Повний Місяць') assert.ok(f > 0.99, `${d}°: повний при ${(f * 100).toFixed(0)} %`);
    if (n === 'Новий Місяць') assert.ok(f < 0.01, `${d}°: новий при ${(f * 100).toFixed(0)} %`);
  }
  /* Кожна фаза має існувати. */
  const seen = new Set();
  for (let d = 0; d < 360; d += 1) seen.add(A.phaseName(d).name);
  assert.equal(seen.size, 8, `фаз знайдено ${seen.size}: ${[...seen].join(', ')}`);
});

test('compassName дає правильні сторони світу', () => {
  assert.equal(A.compassName(0), 'північ');
  assert.equal(A.compassName(90), 'схід');
  assert.equal(A.compassName(181), 'південь');
  assert.equal(A.compassName(271), 'захід');
});

console.log('\nМасштабні функції');

test('дидактична шкала зберігає порядок відстаней', () => {
  const au = [0.39, 0.72, 1.0, 1.52, 5.2, 9.54, 19.19, 30.07, 39.48];
  const out = au.map((a) => A.scaleDistance(a, 0));
  for (let i = 1; i < out.length; i += 1) {
    assert.ok(out[i] > out[i - 1], `порядок зламався на ${i}`);
  }
});

test('дидактична шкала стискає, реальна — ні', () => {
  const dNear = A.scaleDistance(1, 0), dFar = A.scaleDistance(30.07, 0);
  const rNear = A.scaleDistance(1, 1), rFar = A.scaleDistance(30.07, 1);
  assert.ok(dFar / dNear < rFar / rNear, 'дидактична має стискати сильніше');
  near(rFar / rNear, 30.07, 0.01, 'реальна шкала лінійна');
});

test('морф масштабу неперервний на кінцях', () => {
  near(A.scaleDistance(5.2, 0), A.scaleDistance(5.2, 0.0), 1e-9);
  near(A.scaleRadius(69911, 1), A.scaleRadius(69911, 1.0), 1e-9);
});

test('радіуси: у дидактичному режимі Юпітер більший за Землю, але не в 11 разів', () => {
  const e = A.scaleRadius(6371, 0), j = A.scaleRadius(69911, 0);
  assert.ok(j > e, 'Юпітер має бути більший');
  assert.ok(j / e < 6, `дидактичне стиснення не спрацювало: ${j / e}`);
  near(A.scaleRadius(69911, 1) / A.scaleRadius(6371, 1), 69911 / 6371, 0.01);
});

test('шейдер поясів і JS рахують ту саму шкалу', () => {
  const scene = readFileSync(join(here, '..', 'src', '50-scene.js'), 'utf8');
  const m = scene.match(/#define TEACH_POW \$\{([^}]+)\}[\s\S]*?#define TEACH_K\s+\$\{([^}]+)\}[\s\S]*?#define REAL_K\s+\$\{([^}]+)\}/);
  assert.ok(m, 'у шейдері немає підстановки констант масштабу з JS');
  assert.match(m[1], /TEACH_DIST_POW/, 'показник у шейдері захардкоджено');
  assert.match(m[2], /TEACH_DIST_K/, 'коефіцієнт у шейдері захардкоджено');
  assert.match(m[3], /REAL_AU/, 'реальний масштаб у шейдері захардкоджено');
  assert.ok(!/pow\(r,\s*0\.\d+\)\s*\*\s*\d/.test(scene), 'у шейдері лишились числові константи масштабу');
});

test('дидактична шкала розводить внутрішні планети', () => {
  const au = { mercury: 0.387, venus: 0.723, earth: 1.0, mars: 1.524 };
  const r = A.scaleRadius(6371, 0);
  const d = Object.fromEntries(Object.entries(au).map(([k, v]) => [k, A.scaleDistance(v, 0)]));
  /* Між сусідніми внутрішніми планетами має лишатись щонайменше
     два земні радіуси, інакше підписи наїжджають один на одний. */
  assert.ok(d.venus - d.mercury > r * 2.5, `Меркурій і Венера злиплись: ${d.venus - d.mercury}`);
  assert.ok(d.earth - d.venus > r * 2.5, `Венера і Земля злиплись: ${d.earth - d.venus}`);
  assert.ok(d.mars - d.earth > r * 2.5, `Земля і Марс злиплись: ${d.mars - d.earth}`);
  /* Сонце не повинне діставати до Меркурія. */
  const sun = vmSunR();
  assert.ok(d.mercury > sun * 2.4, `Сонце майже торкається Меркурія: ${d.mercury} проти ${sun}`);
});
function vmSunR() { return ev('scaleSunRadius')(0); }

console.log('\nФорматери');

test('числа форматуються українською', () => {
  assert.equal(A.fmtInt(384400), '384 400'.replace(/ /g, ' '));
  assert.equal(A.fmtNum(1.52, 2), '1,52');
  assert.equal(A.fmtNum(-65, 0), '−65');
});

test('тривалість подається дитячою мовою', () => {
  assert.equal(A.fmtDuration(365.26), '365 днів');
  assert.equal(A.fmtDuration(87.97), '88 днів');
  assert.match(A.fmtDuration(686.98), /рок/);
  assert.match(A.fmtDuration(4332.59), /рок/);
  assert.match(A.fmtDuration(30685.4), /рок/);
});

test('відмінювання «супутник» правильне', () => {
  assert.equal(A.pluralUa(1, 'супутник', 'супутники', 'супутників'), 'супутник');
  assert.equal(A.pluralUa(2, 'супутник', 'супутники', 'супутників'), 'супутники');
  assert.equal(A.pluralUa(5, 'супутник', 'супутники', 'супутників'), 'супутників');
  assert.equal(A.pluralUa(11, 'супутник', 'супутники', 'супутників'), 'супутників');
  assert.equal(A.pluralUa(274, 'супутник', 'супутники', 'супутників'), 'супутники');
  assert.equal(A.pluralUa(95, 'супутник', 'супутники', 'супутників'), 'супутників');
});

test('висота стрибка рахується з реальної гравітації', () => {
  near(A.jumpHeight(9.81), 0.5, 0.001, 'на Землі — базові 50 см');
  assert.ok(A.jumpHeight(1.62) > 2.9, 'на Місяці має бути близько 3 м');
  assert.ok(A.jumpHeight(24.79) < 0.21, 'на Юпітері ледве відірвешся');
});

test('час подорожі рахується правильно', () => {
  const t = A.travelTime(A.AU_KM, A.TRAVEL.plane);
  assert.ok(t > 18 && t < 20, `до Сонця літаком ≈19 років, маємо ${t}`);
  const r = A.travelTime(A.AU_KM, A.TRAVEL.rocket);
  assert.ok(r > 0.28 && r < 0.32, `ракетою ≈0,29 року, маємо ${r}`);
});

test('усі тіла мають повний набір полів для карточки', () => {
  for (const b of A.BODIES) {
    assert.ok(b.id && b.name && b.blurb, `${b.id}: бракує назви або опису`);
    assert.ok(Array.isArray(b.facts) && b.facts.length >= 3, `${b.id}: мало фактів`);
    assert.ok(b.radiusKm > 0 && Number.isFinite(b.gravity), `${b.id}: бракує чисел`);
    if (b.kind !== 'star') {
      assert.ok(b.yearDays > 0, `${b.id}: бракує тривалості року`);
      assert.ok(Number.isFinite(b.tilt) && Number.isFinite(b.rotationH), `${b.id}: бракує обертання`);
    }
    for (const f of b.facts) {
      assert.ok(f.length < 130, `${b.id}: факт задовгий для дитини — «${f}»`);
      assert.ok(/[.!?]$/.test(f), `${b.id}: факт без крапки — «${f}»`);
    }
  }
});

console.log(`\n${pass} ok, ${fail} fail\n`);
process.exit(fail ? 1 : 0);
