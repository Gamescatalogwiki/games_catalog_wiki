#!/usr/bin/env node
/* Genera data/catalog.js leyendo la base de Airtable.
 *
 *   AIRTABLE_TOKEN=pat... node tools/airtable-export.mjs
 *
 * No instala nada: usa el fetch nativo de Node 18+. Cero dependencias.
 *
 * El sitio NO habla con Airtable. Este script corre en CI, congela los datos
 * en data/catalog.js y eso es lo unico que se publica.
 *
 * Todo se referencia por ID de campo y de tabla, no por nombre: renombrar una
 * columna en Airtable no rompe el export.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- config ---
const BASE_ID = 'appeyQ2C1DFa7e2HC';

const GAMES = {
  tableId: 'tblrd5RYBLUmng4zF',
  name:        'fldelW1GWSiFGVfI8',
  genre:       'fld2Y6JiOsbYAlyt6',
  perspective: 'fld0MCPGxjWa9CYdx',
  mode:        'fldxpamCcAVlbiJxP',
  publicado:   'fldiVYIKFjlsSPKCP', // checkbox: solo los tildados se publican
};

// Todavia no existe. Cuando se cree la tabla de colecciones, completar los IDs
// aca y el export las incluye solo. Mientras siga en null, se exporta sin
// colecciones y el sitio funciona igual.
const COLLECTIONS = null;
// const COLLECTIONS = {
//   tableId: 'tbl...',
//   slug: 'fld...', titulo: 'fld...', blurb: 'fld...',
//   juegos: 'fld...', orden: 'fld...', publicada: 'fld...',
// };

// Guarda de seguridad: si el catalogo se achica mas que esto de golpe, el
// script aborta en vez de publicar. Un error de permisos o un filtro mal
// puesto no deberia vaciar el sitio en silencio.
const MAX_SHRINK = 0.5;

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '..', 'data', 'catalog.js');

// ------------------------------------------------------------------ util ---
const token = process.env.AIRTABLE_TOKEN;
if (!token) {
  console.error('Falta AIRTABLE_TOKEN en el entorno.');
  process.exit(1);
}

const txt = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

async function fetchAll(tableId) {
  const out = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`);
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('returnFieldsByFieldId', 'true');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`Airtable ${res.status} en ${tableId}: ${await res.text()}`);
    }
    const body = await res.json();
    out.push(...body.records);
    offset = body.offset;
  } while (offset);
  return out;
}

// ------------------------------------------------------------------ main ---
const rawGames = await fetchAll(GAMES.tableId);

const games = rawGames
  .filter((r) => r.fields[GAMES.publicado] === true)
  .map((r) => ({
    id: r.id, // record ID de Airtable: opaco y estable, es lo que referencian las colecciones
    name: txt(r.fields[GAMES.name]),
    genre: txt(r.fields[GAMES.genre]),
    perspective: txt(r.fields[GAMES.perspective]),
    mode: txt(r.fields[GAMES.mode]),
  }))
  .filter((g) => g.name !== '')
  .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id));

if (games.length === 0) {
  console.error('Cero juegos publicados. No se escribe nada: esto casi seguro es un error, no un catalogo vacio.');
  process.exit(1);
}

let collections = [];
if (COLLECTIONS) {
  const publicados = new Set(games.map((g) => g.id));
  collections = (await fetchAll(COLLECTIONS.tableId))
    .filter((r) => r.fields[COLLECTIONS.publicada] === true)
    .map((r) => ({
      slug: txt(r.fields[COLLECTIONS.slug]),
      title: txt(r.fields[COLLECTIONS.titulo]),
      blurb: txt(r.fields[COLLECTIONS.blurb]),
      // Solo juegos que ademas esten publicados: una coleccion no puede colar
      // al sitio un titulo despublicado.
      games: (r.fields[COLLECTIONS.juegos] || []).filter((id) => publicados.has(id)),
      _orden: Number(r.fields[COLLECTIONS.orden] ?? 0),
    }))
    .filter((c) => c.slug !== '' && c.games.length > 0)
    .sort((a, b) => a._orden - b._orden || a.slug.localeCompare(b.slug))
    .map(({ _orden, ...c }) => c);
}

// Guarda: caida brusca respecto de lo ya publicado.
if (existsSync(OUT)) {
  const prev = (readFileSync(OUT, 'utf8').match(/"id":/g) || []).length;
  if (prev > 0 && games.length < prev * (1 - MAX_SHRINK)) {
    console.error(
      `El catalogo pasaria de ~${prev} a ${games.length} titulos. Aborto por las dudas.\n` +
      'Si la baja es real, volve a correr con ALLOW_SHRINK=1.'
    );
    if (process.env.ALLOW_SHRINK !== '1') process.exit(1);
  }
}

// version = hash del contenido. Deterministico a proposito: si los datos no
// cambiaron, el archivo es identico byte a byte y no se genera un commit.
const payload = { games, ...(collections.length ? { collections } : {}) };
const version = 'at-' + createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 12);

const data = { version, ...payload };
const header =
  '/* Generado por tools/airtable-export.mjs desde Airtable — no editar a mano.\n' +
  ' * Para actualizar el catalogo se edita Airtable, no este archivo.\n' +
  ' */\n';

writeFileSync(OUT, header + 'window.CATALOG = ' + JSON.stringify(data, null, 2) + ';\n', 'utf8');
console.log(`ok: ${games.length} titulos, ${collections.length} colecciones -> ${OUT} (${version})`);
