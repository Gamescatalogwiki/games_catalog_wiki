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

// Las colecciones del sitio salen de las Open Calls de Gameplay Alliance, que
// viven en OTRA base. Cada orden activa se publica como una coleccion con su
// propia URL (?c=slug).
//
// Ojo con la semantica, que es la misma que documenta la propia orden en sus
// notas: `categorias`, `perspectivas` y `modos` son DESCRIPTIVOS — pintan los
// controles del sitio. Quien entra en la coleccion lo define `juegos`, la lista
// curada. Filtrar por esas categorias devuelve mas titulos, y esta bien que asi
// sea.
const CALLS = {
  baseId:  'appOMCoN1rvrRWNxQ',
  tableId: 'tblzDrErQ9Yt8wXEk',
  nombre:       'fldUNbeDC3aiRoIZw', // texto: da el titulo y el slug
  codigo:       'fldnrccJs3q9alKBj', // GA-2026-018: desempata slugs repetidos
  estado:       'fldHtrEHYPfrKnuxg', // solo se publican las "activo"
  staging:      'fldhZa5ePPdq6vo73', // ordenes de prueba: nunca se publican
  descripcion:  'fld1LuxrydjssNgQB', // multilinea: el primer parrafo es el blurb
  juegos:       'fldBOoGG1GXIx1wGE', // JSON con NOMBRES de juego, no con ids
  categorias:   'fldnnL7cILu1U5Uuc',
  perspectivas: 'fldfzrjY5XGgDqu1A',
  modos:        'fldPwnwg6K1TvvbI5',
  orden:        'fldD3qahwYunTxpyO', // autonumero
};

/* El sitio esta en ingles y las ordenes se llaman en castellano. Esta tabla es la
 * unica fuente del nombre que se publica, y ademas decide QUE ordenes salen: una
 * orden que no figure aca no se publica (se avisa en el log).
 *
 * El orden de las lineas es el orden en que aparecen las tarjetas en el home.
 *
 * Para agregar una categoria: sumar el codigo GA-XXXX con su nombre en ingles.
 * Para sacarla: borrar la linea (o cerrar la orden en Airtable). */
const NOMBRES = [
  ['GA-2026-018', 'Driving & Vehicles'],
  ['GA-2026-013', 'Jobs & Task Simulation'],
  ['GA-2026-010', 'Action & Shooters'],
  ['GA-2026-012', 'RPG & Roguelike'],
  ['GA-2026-017', 'Open World & RPG'],
  ['GA-2026-015', 'Shooters & Combat'],
  ['GA-2026-016', 'Survival, Horror & Co-op'],
  ['GA-2026-011', 'Adventure, Survival & Sandbox'],
];

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

async function fetchAll(tableId, baseId = BASE_ID) {
  const out = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${tableId}`);
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

/* Nombre -> id del catalogo. Las ordenes listan juegos por nombre, y el sitio
 * los referencia por record id, asi que hay que casarlos. Se compara sin
 * acentos, sin mayusculas y sin espacios de mas para que un tilde no rompa. */
const fold = (s) =>
  String(s).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');

const idPorNombre = new Map(games.map((g) => [fold(g.name), g.id]));

const slugify = (s) =>
  String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/* La lista de juegos viene como JSON en un campo de texto. Puede ser un array,
 * o un solo nombre suelto. Cualquier otra cosa se ignora avisando. */
function nombresDe(raw, donde) {
  const t = txt(raw);
  if (!t) return [];
  if (t.startsWith('[')) {
    try {
      const v = JSON.parse(t);
      if (Array.isArray(v)) return v.map(txt).filter(Boolean);
    } catch {
      console.warn(`aviso: ${donde} tiene una lista de juegos que no es JSON valido. Se ignora.`);
      return [];
    }
  }
  return [t];
}

let collections = [];
try {
  const rawCalls = await fetchAll(CALLS.tableId, CALLS.baseId);
  const usados = new Set();

  const ingles = new Map(NOMBRES);
  const posicion = new Map(NOMBRES.map(([c], i) => [c, i]));

  /* Los valores multivaluados llegan como texto separado por coma. */
  const valores = (v) => txt(v).split(',').map((x) => x.trim()).filter(Boolean);

  /* Una orden sin lista curada acepta cualquier titulo que cumpla sus categorias:
   * OR dentro de cada atributo, AND entre atributos, igual que el filtro del sitio.
   * Un atributo vacio en el juego nunca entra si la orden pide ese atributo. */
  function porCategorias(filtros) {
    return games
      .filter((g) =>
        [['genre', 'genre'], ['perspective', 'perspective'], ['mode', 'mode']].every(([k]) => {
          const pedidos = filtros[k];
          if (!pedidos.length) return true;
          const propios = valores(g[k]);
          return propios.some((v) => pedidos.includes(v));
        }))
      .map((g) => g.id);
  }

  collections = rawCalls
    .filter((r) => {
      /* La lista NOMBRES es la que manda: si una orden figura ahi se publica, salvo
       * que sea una orden de prueba. El estado en Airtable no la filtra. */
      return ingles.has(txt(r.fields[CALLS.codigo])) && r.fields[CALLS.staging] !== true;
    })
    .map((r) => {
      const f = r.fields;
      const codigo = txt(f[CALLS.codigo]);
      const nombre = ingles.get(codigo);
      const donde = codigo || r.id;

      const nombres = nombresDe(f[CALLS.juegos], donde);
      const ids = [];
      const faltan = [];
      for (const n of nombres) {
        const id = idPorNombre.get(fold(n));
        if (id) { if (!ids.includes(id)) ids.push(id); } else faltan.push(n);
      }
      if (faltan.length) {
        console.warn(`aviso: ${donde} ("${nombre}") lista ${faltan.length} titulo(s) que no estan publicados en el catalogo: ${faltan.join(', ')}`);
      }

      let slug = slugify(nombre) || slugify(codigo);
      if (usados.has(slug)) slug = slug + '-' + slugify(codigo);
      usados.add(slug);

      const filtros = {
        perspective: (f[CALLS.perspectivas] || []).map(txt).filter(Boolean),
        genre:       (f[CALLS.categorias]   || []).map(txt).filter(Boolean),
        mode:        (f[CALLS.modos]        || []).map(txt).filter(Boolean),
      };

      /* Sin lista curada, la categoria se arma con los propios filtros de la orden. */
      let miembros = ids;
      let origen = 'curada';
      if (!nombres.length) {
        miembros = porCategorias(filtros);
        origen = 'por categorias';
      }
      console.log(`   ${codigo} "${nombre}": ${miembros.length} titulos (${origen})`);

      return {
        slug,
        title: nombre,
        /* Sin blurb a proposito: el sitio no repite el texto con el que se comunica
         * la orden. En la tarjeta va el titulo, la cantidad y los juegos. */
        blurb: '',
        /* No se muestran en ningun lado. Sirven para que una URL de filtros que
         * reproduce exactamente este recorte abra directamente la categoria. */
        filters: filtros,
        /* true = la lista viene elegida a mano en Airtable. false = se derivo de las
         * categorias de la orden. El sitio usa esto para saber que generos reservar. */
        curated: origen === 'curada',
        games: miembros,
        _orden: posicion.get(codigo) ?? 999,
      };
    })
    .filter((c) => c.slug !== '' && c.games.length > 0)
    .sort((a, b) => a._orden - b._orden)
    .map(({ _orden, ...c }) => c);
} catch (err) {
  /* Si el token no llega a la base de las ordenes, el catalogo se publica igual
   * y sin colecciones, en vez de romper todo el sync. */
  console.warn(`aviso: no se pudieron leer las Open Calls (${err.message}). Se publica sin colecciones.`);
  collections = [];
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
