#!/usr/bin/env node
/* Parche temporal: suma al catalogo titulos que todavia no estan cargados en la
 * tabla Games de Airtable, y vuelve a resolver las categorias con el catalogo
 * ya ampliado.
 *
 *   node tools/apply-extras.mjs
 *
 * Corre DESPUES de tools/airtable-export.mjs y ANTES de tools/validate-catalog.mjs.
 *
 * Lee data/games-extra.json — una lista de { name, genre, perspective, mode } —
 * y agrega al catalogo unicamente los titulos cuyo nombre NO exista ya. O sea:
 * si un titulo se carga en Airtable, gana Airtable y el de aca se ignora solo.
 * Cuando esten todos cargados, se pueden borrar data/games-extra.json, este
 * script y su paso en el workflow, sin que cambie nada.
 *
 * Si data/games-extra.json no existe, no hace nada.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const OUT     = resolve(root, 'data', 'catalog.js');
const EXTRA   = resolve(root, 'data', 'games-extra.json');
const SELECTS = resolve(root, 'data', 'selections.json');

if (!existsSync(EXTRA)) {
  console.log('No hay data/games-extra.json. Nada que parchear.');
  process.exit(0);
}

// data/catalog.js es un archivo de navegador: asigna window.CATALOG.
globalThis.window = globalThis.window || {};
new Function(readFileSync(OUT, 'utf8'))();
const cat = globalThis.window.CATALOG;

if (!cat || !Array.isArray(cat.games) || cat.games.length === 0) {
  console.error('data/catalog.js no trae un array "games" usable. Se aborta el parche.');
  process.exit(1);
}

const txt = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const fold = (s) =>
  String(s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

const games = cat.games.slice();
const vistos = new Set(games.map((g) => fold(g.name)));

let sumados = 0;
let pisados = 0;
for (const e of JSON.parse(readFileSync(EXTRA, 'utf8'))) {
  const name = txt(e && e.name);
  if (!name) continue;
  if (vistos.has(fold(name))) { pisados++; continue; }
  vistos.add(fold(name));
  games.push({
    // id sintetico y estable: deriva del nombre, nunca choca con un recXXX de Airtable
    id: 'x' + createHash('sha256').update(fold(name)).digest('hex').slice(0, 16),
    name,
    genre: txt(e.genre),
    perspective: txt(e.perspective),
    mode: txt(e.mode),
  });
  sumados++;
}

games.sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id));
console.log(`   + ${sumados} titulo(s) desde data/games-extra.json` +
            (pisados ? `, ${pisados} ya estaban en Airtable (gana Airtable)` : '') +
            ` -> ${games.length} titulos`);

/* Con el catalogo ampliado hay que rearmar las categorias: el export ya
 * descarto los nombres que en ese momento no existian. */
let collections = cat.collections || [];

if (existsSync(SELECTS)) {
  const idPorNombre = new Map(games.map((g) => [fold(g.name), g.id]));

  collections = JSON.parse(readFileSync(SELECTS, 'utf8')).map((c) => {
    const ids = [];
    const faltan = [];
    for (const n of (c.games || [])) {
      const id = idPorNombre.get(fold(n));
      if (id) { if (!ids.includes(id)) ids.push(id); } else faltan.push(n);
    }
    if (faltan.length) {
      console.warn(`aviso: ${c.slug} sigue sin ${faltan.length} titulo(s): ${faltan.join(', ')}`);
    }
    console.log(`   ${c.codigo || c.slug} "${c.title}": ${ids.length} titulos`);
    return {
      slug: c.slug,
      title: c.title,
      blurb: '',
      filters: {
        perspective: (c.filters && c.filters.perspective) || [],
        genre:       (c.filters && c.filters.genre) || [],
        mode:        (c.filters && c.filters.mode) || [],
      },
      curated: false,
      games: ids,
    };
  }).filter((c) => c.slug && c.games.length > 0);
}

const payload = { games, ...(collections.length ? { collections } : {}) };
const version = 'at-' + createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 12);

const header =
  '/* Generado por tools/airtable-export.mjs desde Airtable — no editar a mano.\n' +
  ' * Para actualizar el catalogo se edita Airtable, no este archivo.\n' +
  ' * tools/apply-extras.mjs sumo ademas los titulos de data/games-extra.json.\n' +
  ' */\n';

writeFileSync(OUT, header + 'window.CATALOG = ' + JSON.stringify({ version, ...payload }, null, 2) + ';\n', 'utf8');
console.log(`ok: ${games.length} titulos, ${collections.length} colecciones (${version})`);
