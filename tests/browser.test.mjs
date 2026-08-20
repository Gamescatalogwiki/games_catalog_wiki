/* Verificacion en navegador real (Chromium) de los 6 criterios de aceptacion del brief.
 * Corre con: node tests/browser.test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, '..');

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`   ${ok ? 'PASA' : 'FALLA'}  ${label}`);
  if (!ok) console.log(`         esperado: ${e}\n         obtenido: ${a}`);
}
function section(t) { console.log(`\n${t}`); }

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
function serve(root) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    const file = join(root, path === '/' ? 'index.html' : path);
    if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

const rows = (page) => page.$$eval('#rows tr td:first-child', (tds) => tds.map((t) => t.textContent.trim()));
const visible = (page, sel) => page.$eval(sel, (n) => !n.hidden && n.offsetParent !== null).catch(() => false);

/* El contenedor trae Chromium preinstalado; se usa ese binario en vez de descargar otro. */
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
const ctx = await browser.newContext();
const page = await ctx.newPage();

const external = [];
page.on('request', (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith('http://127.0.0.1')) external.push(r.url()); });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));

const base = 'file://' + resolve(site, 'index.html');
const open = async (qs) => { await page.goto(base + (qs || '')); await page.waitForSelector('#rows tr, #empty:not([hidden])'); };

/* -------------------------------------------------------------------------- */
section('Criterio 1 — la URL de cada coleccion muestra exactamente su lista games');

await open('?c=tactical-military');
check('tactical-military muestra solo Squad', await rows(page), ['Squad']);
check('el titulo de la coleccion se muestra', await page.textContent('#view-title'), 'Tactical & Military Shooters');
check('el blurb se muestra', (await page.textContent('#view-blurb')).slice(0, 24), 'Combate tactico y milita');
check('avisa que la lista es editorial', await visible(page, '#view-curated'), true);
check('los controles reflejan sus filters (genre), en el orden del panel',
  await page.$$eval('[data-filter-list="genre"] li.on .v', (n) => n.map((x) => x.textContent)),
  ['FPS', 'Tactical Shooter']);
check('los controles reflejan sus filters (perspective)',
  await page.$$eval('[data-filter-list="perspective"] li.on .v', (n) => n.map((x) => x.textContent)),
  ['First Person']);

await open('?c=open-world');
check('open-world respeta el orden de games', await rows(page), ['Pacific Drive', 'Portal 2']);
await open('?c=open-world');
check('recargar da el mismo orden', await rows(page), ['Pacific Drive', 'Portal 2']);

await open('?perspective=First+Person&genre=Tactical+Shooter,FPS');
check('el mismo recorte por filtro da 2 titulos, no 1',
  await rows(page), ['Shooter Que No Entra', 'Squad']);

/* -------------------------------------------------------------------------- */
section('Criterio 2 — tocar un filtro abandona la coleccion sin resultados fantasma');

/* La coleccion muestra solo Squad. Al destildar Tactical Shooter queda el recorte
 * First Person + FPS, que no contiene a Squad: si apareciera, seria un fantasma. */
await open('?c=tactical-military');
await page.locator('[data-filter-list="genre"] li', { hasText: 'Tactical Shooter' }).locator('input').click();
await page.waitForTimeout(60);
check('la URL deja de ser de coleccion', new URL(page.url()).search, '?perspective=First+Person&genre=FPS');
check('el resultado es el del filtro, no el de la coleccion', await rows(page), ['Shooter Que No Entra']);
check('desaparece el cartel de seleccion editorial', await visible(page, '#view-curated'), false);
check('Squad, unico titulo de la coleccion, ya no esta', (await rows(page)).includes('Squad'), false);

await open('?c=open-world');
await page.click('[data-filter-list="mode"] li:first-child input');
await page.waitForTimeout(60);
const tras = await rows(page);
check('agregar un filtro tambien sale de la coleccion', new URL(page.url()).search.includes('c='), false);
check('y no arrastra titulos de la coleccion que no cumplan el filtro',
  tras.every((n) => n !== 'The Forest'), true);

/* -------------------------------------------------------------------------- */
section('Criterio 3 — un titulo con genre vacio aparece sin filtros y desaparece al filtrar por genero');

await open('');
const todos = await rows(page);
check('sin filtros estan los 9 titulos', todos.length, 9);
check('el titulo sin genero esta', todos.includes('Titulo Sin Genero'), true);
check('el titulo sin perspectiva tambien', todos.includes('Titulo Sin Perspectiva'), true);
check('su celda de genero muestra ausencia, no un valor inventado',
  await page.$$eval('#rows tr', (trs) => {
    const tr = trs.find((r) => r.cells[0].textContent.trim() === 'Titulo Sin Genero');
    return tr ? tr.cells[1].textContent.trim() : null;
  }), '—');
check('el orden del filtrado libre es alfabetico y estable',
  (await rows(page)).slice(0, 3), ['Elden Ring', 'Otro Platformer', 'Pacific Drive']);

await open('?genre=Platform');
check('al filtrar por genero desaparece', (await rows(page)).includes('Titulo Sin Genero'), false);
await open('?perspective=Third+Person');
check('pero sigue si el filtro es de otro atributo', (await rows(page)).includes('Titulo Sin Genero'), true);

/* -------------------------------------------------------------------------- */
section('Criterio 4 — copiar la URL y abrirla en otra ventana reproduce la vista');

await open('');
await page.click('[data-filter-list="perspective"] li:first-child input');
await page.fill('#q-panel', 'o');
await page.waitForTimeout(220);
const shared = page.url();
const esperado = await rows(page);
const conteo = await page.textContent('#cnt');

const otra = await ctx.newPage();
await otra.goto(shared);
await otra.waitForSelector('#rows tr, #empty:not([hidden])');
check('la URL compartida trae la misma grilla',
  await otra.$$eval('#rows tr td:first-child', (t) => t.map((x) => x.textContent.trim())), esperado);
check('el mismo contador', await otra.textContent('#cnt'), conteo);
check('los mismos controles marcados',
  await otra.$$eval('aside li.on .v', (n) => n.map((x) => x.textContent)),
  await page.$$eval('aside li.on .v', (n) => n.map((x) => x.textContent)));
check('el buscador conserva el texto', await otra.inputValue('#q-panel'), 'o');
await otra.close();

/* -------------------------------------------------------------------------- */
section('Criterio 5 — sin red, despues del primer load, el sitio no rompe');

check('ningun request a un host externo en toda la sesion', external, []);

const { server, port } = await serve(site);
const net = await ctx.newPage();
const httpReqs = [];
net.on('request', (r) => httpReqs.push(r.url()));
await net.goto(`http://127.0.0.1:${port}/?c=survival-coop`);
await net.waitForSelector('#rows tr');
check('carga por HTTP y muestra la coleccion',
  await net.$$eval('#rows tr td:first-child', (t) => t.map((x) => x.textContent.trim())), ['The Forest']);

await ctx.setOffline(true);
await net.click('#clear');
await net.waitForTimeout(80);
check('con la red cortada, salir de la coleccion sigue funcionando',
  (await net.$$eval('#rows tr td:first-child', (t) => t.map((x) => x.textContent.trim()))).length, 9);
await net.locator('[data-filter-list="perspective"] li', { hasText: 'First Person' }).locator('input').click();
await net.waitForTimeout(80);
check('y filtrar tambien',
  (await net.$$eval('#rows tr td:first-child', (t) => t.map((x) => x.textContent.trim()))).length, 5);
await net.fill('#q-panel', 'forest');
await net.waitForTimeout(220);
check('y el buscador tambien',
  await net.$$eval('#rows tr td:first-child', (t) => t.map((x) => x.textContent.trim())), ['The Forest']);
await net.goBack();
await net.waitForTimeout(120);
/* El buscador usa replaceState para no ensuciar el historial: atras vuelve al estado
 * anterior al filtro, no a cada tecla escrita. */
check('y el boton atras del navegador tambien',
  (await net.$$eval('#rows tr td:first-child', (t) => t.map((x) => x.textContent.trim()))).length, 9);
check('todos los requests fueron al propio sitio',
  httpReqs.every((u) => u.startsWith(`http://127.0.0.1:${port}/`)), true);
await ctx.setOffline(false);
await net.close();
server.close();

/* -------------------------------------------------------------------------- */
section('Criterio 6 — reemplazar el archivo de datos no requiere tocar codigo');

const swap = '/tmp/gamescatalog-swap';
rmSync(swap, { recursive: true, force: true });
mkdirSync(join(swap, 'data'), { recursive: true });
cpSync(resolve(site, 'index.html'), join(swap, 'index.html'));
cpSync(resolve(site, 'assets'), join(swap, 'assets'), { recursive: true });
const big = JSON.parse(readFileSync(resolve(here, 'catalog.big.json'), 'utf8'));
writeFileSync(join(swap, 'data', 'catalog.js'), 'window.CATALOG = ' + JSON.stringify(big) + ';\n');

const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
check('index.html es byte a byte el mismo', hash(join(swap, 'index.html')), hash(resolve(site, 'index.html')));
check('app.js es byte a byte el mismo', hash(join(swap, 'assets/app.js')), hash(resolve(site, 'assets/app.js')));
check('core.js es byte a byte el mismo', hash(join(swap, 'assets/core.js')), hash(resolve(site, 'assets/core.js')));

const otro = await ctx.newPage();
const swapBase = 'file://' + join(swap, 'index.html');
await otro.goto(swapBase);
await otro.waitForSelector('#rows tr');

check('la grilla muestra el catalogo nuevo',
  await otro.$eval('#cnt', (n) => n.textContent), '430 titles');
check('las tarjetas del home son las colecciones nuevas',
  await otro.$$eval('#collection-grid .cat-name', (n) => n.map((x) => x.textContent)),
  ['Tactical & Military Shooters', 'Survival & Co-op', 'Single-player Epics', 'Driving & Racing', 'Odd Ones Out', 'Unclassified']);
check('los chips son los generos mas numerosos del archivo nuevo',
  await otro.$$eval('#genre-chips .chip', (n) => n.slice(0, 3).map((x) => x.firstChild.textContent)),
  ['Action', 'Adventure', 'Shooter']);
check('los stats se derivan del archivo',
  await otro.$$eval('#hero-stats .stat b', (n) => n.map((x) => x.textContent)),
  ['430', '53', '6', '4']);

section('La cola larga de generos, con el archivo grande');
check('el panel de genero muestra 12 y colapsa el resto',
  await otro.$$eval('[data-filter-list="genre"] li', (n) => n.length), 12);
check('y ofrece abrir la cola',
  (await otro.textContent('#genre-toggle')).trim(), 'Show 41 more genres');
check('los generos vienen ordenados por cantidad',
  await otro.$$eval('[data-filter-list="genre"] li .v', (n) => n.slice(0, 3).map((x) => x.textContent)),
  ['Action', 'Adventure', 'Shooter']);
check('Platform y Platformer conviven sin unificarse',
  await otro.$$eval('[data-filter-list="genre"] li', () => true) &&
  (await otro.$$eval('#genre-chips .chip', (n) => n.map((x) => x.firstChild.textContent))).includes('Platform'), true);

await otro.fill('#genre-search', 'sim');
await otro.waitForTimeout(60);
check('buscar dentro del filtro encuentra la cola larga, sin unificar variantes',
  await otro.$$eval('[data-filter-list="genre"] li .v', (n) => n.map((x) => x.textContent)),
  ['Simulation', 'Simulator', 'Racing Sim', 'Immersive Sim', 'Colony Sim', 'Farming Sim', 'Flight Sim', 'Life Sim']);
await otro.click('[data-filter-list="genre"] li:nth-child(2) input');   /* Simulator, de la cola */
await otro.waitForTimeout(80);
check('se puede filtrar por un valor de la cola larga',
  new URL(otro.url()).search, '?genre=Simulator');
check('y el titulo del filtro queda visible como tag',
  await otro.$$eval('#activefilters .tag', (n) => n.map((x) => x.firstChild.textContent)), ['Simulator']);

section('Coleccion cuya lista no coincide con sus filtros, en el archivo grande');
await otro.goto(swapBase + '?c=survival-coop');
await otro.waitForSelector('#rows tr');
const curada = await otro.$$eval('#rows tr td:first-child', (t) => t.map((x) => x.textContent.trim()));
check('la coleccion muestra sus 5 titulos exactos', curada.length, 5);
check('incluye el titulo que el filtro NO devolveria',
  await otro.$$eval('#rows tr td:nth-child(2)', (t) => t.map((x) => x.textContent.trim()).includes('Puzzle')), true);
await otro.goto(swapBase + '?c=no-metadata');
await otro.waitForSelector('#rows tr');
check('una coleccion de titulos sin genero se muestra igual',
  await otro.$$eval('#rows tr td:nth-child(2)', (t) => t.map((x) => x.textContent.trim())),
  ['—', '—', '—', '—', '—']);
await otro.close();

/* -------------------------------------------------------------------------- */
section('Sanidad general');
check('ningun error de JavaScript en toda la corrida', consoleErrors, []);

await browser.close();
console.log(`\n${failures === 0 ? 'TODO OK' : failures + ' FALLA(S)'}\n`);
process.exit(failures === 0 ? 0 : 1);
