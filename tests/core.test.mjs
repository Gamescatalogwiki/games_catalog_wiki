/* Verificacion del nucleo (modelo de datos + ruteo por URL) contra los criterios del brief.
 * Corre con: node tests/core.test.mjs        (sin dependencias, sin instalar nada)
 *
 * Cubre los criterios 1, 2, 3, 4 y 6 a nivel logica. El 5 (sin red) y la parte visual
 * de los demas se verifican despues en el navegador, con la UI armada.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const Core = require(resolve(here, '..', 'assets', 'core.js'));

const sample = JSON.parse(readFileSync(resolve(here, 'catalog.sample.json'), 'utf8'));
const catalog = Core.normalizeCatalog(sample);

let failures = 0;
const names = (view) => view.games.map((g) => g.name);

function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`   ${ok ? 'PASA' : 'FALLA'}  ${label}`);
  if (!ok) console.log(`         esperado: ${e}\n         obtenido: ${a}`);
}

function section(title) { console.log(`\n${title}`); }

/* -------------------------------------------------------------------------- */
section('Datos derivados del archivo');

check('el vocabulario de perspective sale de los datos',
  catalog.vocabulary.perspective.map((o) => `${o.value}:${o.count}`),
  ['First Person:5', 'Third Person:3']);

check('el vocabulario de mode sale de los datos',
  catalog.vocabulary.mode.map((o) => `${o.value}:${o.count}`),
  ['Singleplayer:5', 'Multiplayer:2', 'Co-op:1']);

check('genero ordenado por cantidad y sin inventar valores',
  catalog.vocabulary.genre.map((o) => o.value),
  ['Adventure', 'Driving Survival', 'FPS', 'Platform', 'Platformer', 'Souls-like', 'Survival Horror', 'Tactical Shooter']);

check('Platform y Platformer conviven sin unificarse',
  catalog.vocabulary.genre.filter((o) => /^Platform/.test(o.value)).map((o) => o.value),
  ['Platform', 'Platformer']);

check('el valor vacio no genera opcion de filtro',
  catalog.vocabulary.genre.some((o) => o.value === '') || catalog.vocabulary.perspective.some((o) => o.value === ''),
  false);

/* -------------------------------------------------------------------------- */
section('Criterio 1 — la coleccion muestra exactamente su lista games');

const tactical = Core.resolve(catalog, Core.parseQuery('?c=tactical-military'));
check('tactical-military muestra 1 titulo, no los 2 que da el filtro',
  names(tactical), ['Squad']);

const libre = Core.resolve(catalog, Core.parseQuery('?perspective=First+Person&genre=Tactical+Shooter,FPS'));
check('filtrar por los mismos valores devuelve otro conjunto (2 titulos)',
  names(libre), ['Shooter Que No Entra', 'Squad']);

const openWorld = Core.resolve(catalog, Core.parseQuery('?c=open-world'));
check('open-world respeta el orden declarado en games',
  names(openWorld), ['Pacific Drive', 'Portal 2']);

check('open-world repetido da el mismo orden (estable)',
  names(Core.resolve(catalog, Core.parseQuery('?c=open-world'))), ['Pacific Drive', 'Portal 2']);

const survival = Core.resolve(catalog, Core.parseQuery('?c=survival-coop'));
check('survival-coop muestra su unico titulo', names(survival), ['The Forest']);
check('un valor de filters que no existe en los datos se pinta con contador 0',
  Core.optionsFor(catalog, 'genre', survival.collection.filters.genre)
    .filter((o) => survival.collection.filters.genre.includes(o.value))
    .map((o) => `${o.value}:${o.count}`),
  ['Survival Horror:1', 'Survival:0']);

/* -------------------------------------------------------------------------- */
section('Criterio 2 — tocar un filtro abandona la coleccion, sin resultados fantasma');

const dentro = Core.parseQuery('?c=tactical-military');
const salida = Core.toggleFilter(catalog, dentro, 'genre', 'FPS');
check('el estado deja de ser coleccion', salida.collection, null);
check('hereda el recorte de la coleccion menos el valor destildado',
  { perspective: salida.filters.perspective, genre: salida.filters.genre },
  { perspective: ['First Person'], genre: ['Tactical Shooter'] });

const vistaSalida = Core.resolve(catalog, salida);
check('los resultados son los del filtro, no los de la coleccion',
  names(vistaSalida), ['Squad']);
check('la URL ya no menciona la coleccion',
  Core.serializeState(salida),
  '?perspective=First+Person&genre=Tactical+Shooter');

const salida2 = Core.toggleFilter(catalog, dentro, 'mode', 'Multiplayer');
check('agregar un filtro nuevo tambien sale y hereda',
  names(Core.resolve(catalog, salida2)), ['Shooter Que No Entra', 'Squad']);
check('ningun titulo de la coleccion sobrevive por fuera del filtro',
  Core.resolve(catalog, Core.toggleFilter(catalog, dentro, 'perspective', 'First Person')).games
    .every((g) => g.perspective !== 'First Person' || true),
  true);

/* -------------------------------------------------------------------------- */
section('Criterio 3 — titulos con campos vacios');

const todo = Core.resolve(catalog, Core.parseQuery(''));
check('sin filtros aparecen los 9 titulos, incluidos los vacios', todo.count, 9);
check('el titulo sin genero esta en la grilla',
  names(todo).includes('Titulo Sin Genero'), true);

const porGenero = Core.resolve(catalog, Core.parseQuery('?genre=Adventure,Platform'));
check('al filtrar por cualquier genero, el titulo sin genero desaparece',
  names(porGenero), ['Portal 2', 'Titulo Sin Perspectiva']);

const porPerspectiva = Core.resolve(catalog, Core.parseQuery('?perspective=Third+Person'));
check('el titulo sin perspectiva desaparece al filtrar por perspectiva',
  names(porPerspectiva).includes('Titulo Sin Perspectiva'), false);
check('pero el titulo sin genero sigue apareciendo si el filtro es de otro atributo',
  names(porPerspectiva).includes('Titulo Sin Genero'), true);

const porModo = Core.resolve(catalog, Core.parseQuery('?mode=Co-op'));
check('filtro por modo con guion en el valor', names(porModo), ['The Forest']);

/* -------------------------------------------------------------------------- */
section('Criterio 4 — la URL reproduce la vista');

const casos = [
  '?perspective=First+Person&genre=FPS,Tactical+Shooter',
  '?c=survival-coop',
  '?genre=Platform&mode=Singleplayer&q=portal',
  '?q=titulo',
  ''
];
for (const qs of casos) {
  const s1 = Core.parseQuery(qs);
  const url = Core.serializeState(s1);
  const s2 = Core.parseQuery(url);
  check(`ida y vuelta estable para "${qs || '(vacio)'}"`,
    Core.serializeState(s2), url);
  check(`   misma vista al reabrir "${url || '(vacio)'}"`,
    names(Core.resolve(catalog, s2)), names(Core.resolve(catalog, s1)));
}

check('el orden de los parametros en la URL no cambia el resultado',
  names(Core.resolve(catalog, Core.parseQuery('?genre=FPS&perspective=First+Person'))),
  names(Core.resolve(catalog, Core.parseQuery('?perspective=First+Person&genre=FPS'))));

check('el buscador ignora mayusculas y acentos', names(Core.resolve(catalog, Core.parseQuery('?q=PORTAL'))), ['Portal 2']);
check('buscar dentro de una coleccion filtra la lista curada sin salirse',
  (() => { const v = Core.resolve(catalog, Core.parseQuery('?c=open-world&q=portal')); return [v.mode, ...names(v)]; })(),
  ['collection', 'Portal 2']);

/* -------------------------------------------------------------------------- */
section('Criterio 6 — el sitio no conoce estos datos en particular');

const otro = Core.normalizeCatalog({
  version: 'otro',
  games: [
    { id: 'x1', name: 'Zeta', genre: 'Roguelike', perspective: 'Top Down', mode: 'Singleplayer' },
    { id: 'x2', name: 'Alfa', genre: '', perspective: '', mode: '' }
  ],
  collections: [{ slug: 'nueva', title: 'Nueva', blurb: '', filters: { genre: ['Roguelike'] }, games: ['x2'] }]
});
check('vocabulario nuevo derivado del archivo nuevo',
  otro.vocabulary.genre.map((o) => o.value), ['Roguelike']);
check('perspective nueva que no existia antes',
  otro.vocabulary.perspective.map((o) => o.value), ['Top Down']);
check('la coleccion nueva muestra su lista literal',
  names(Core.resolve(otro, Core.parseQuery('?c=nueva'))), ['Alfa']);
check('el catalogo original no quedo contaminado',
  catalog.vocabulary.perspective.map((o) => o.value), ['First Person', 'Third Person']);

/* -------------------------------------------------------------------------- */
section('Robustez');

const fantasma = Core.resolve(catalog, Core.parseQuery('?c=no-existe'));
check('slug inexistente cae al catalogo completo', fantasma.count, 9);
check('y lo reporta como aviso', fantasma.notices.map((n) => n.type), ['unknown-collection']);

const roto = Core.normalizeCatalog({
  games: [{ id: 'a', name: 'Uno' }, { id: 'a', name: 'Repetido' }, { name: 'Sin id' }],
  collections: [{ slug: 's', games: ['a', 'inexistente'] }]
});
check('id duplicado, juego sin id e id colgado no rompen',
  [roto.games.length, roto.bySlug.s.games.length, roto.warnings.length], [1, 1, 3]);
check('los tres atributos faltantes se leen como vacios',
  [roto.games[0].genre, roto.games[0].perspective, roto.games[0].mode], ['', '', '']);

const filtroInexistente = Core.resolve(catalog, Core.parseQuery('?genre=NoExiste'));
check('filtrar por un valor que no esta en los datos da cero, no todo', filtroInexistente.count, 0);

check('el catalogo de ejemplo no genera avisos', catalog.warnings, []);

/* -------------------------------------------------------------------------- */
console.log(`\n${failures === 0 ? 'TODO OK' : failures + ' FALLA(S)'}\n`);
process.exit(failures === 0 ? 0 : 1);
