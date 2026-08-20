/* Genera un catalogo sintetico con la forma real que describe el brief:
 * ~500 titulos, 45+ generos con cola larga, variantes que conviven, campos vacios
 * frecuentes y colecciones cuya lista NO coincide con sus filtros.
 * Determinista: sin Math.random, para que los tests sean reproducibles.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/* Cabeza pesada + cola larguisima, con variantes casi sinonimas a proposito. */
const HEAD = [
  ['Action', 62], ['Adventure', 54], ['Shooter', 41], ['RPG', 33], ['Strategy', 28],
  ['Simulation', 24], ['Survival', 21], ['Platform', 17], ['Horror', 15], ['Puzzle', 13]
];
const MID = [
  ['Simulator', 9], ['Platformer', 8], ['Tactical Shooter', 8], ['Racing', 7], ['Racing Sim', 6],
  ['Souls-like', 6], ['Roguelike', 5], ['Metroidvania', 5], ['Survival Horror', 5], ['FPS', 4],
  ['Sandbox', 4], ['City Builder', 3], ['Point-and-click', 3], ['Deckbuilder', 3], ['MOBA', 2],
  ['Rhythm', 2], ['Visual Novel', 2], ['Driving Survival', 2], ['Battle Royale', 2], ['Hack and Slash', 2]
];
const TAIL = [
  'Auto Battler', 'Base Building', 'Boomer Shooter', 'Bullet Hell', 'Card Game', 'Colony Sim',
  'Dungeon Crawler', 'Extraction Shooter', 'Farming Sim', 'Fighting', 'Flight Sim', 'Grand Strategy',
  'Immersive Sim', 'Life Sim', 'Looter Shooter', 'Open World', 'Party Game', 'Roguelite',
  'RTS', 'Stealth', 'Tower Defense', 'Turn-Based Tactics', 'Twin-Stick Shooter', 'Walking Simulator',
  'Wave Shooter'
];

const PERSPECTIVES = ['First Person', 'Third Person'];
const MODES = ['Singleplayer', 'Multiplayer', 'Co-op', 'PvP'];

const genrePlan = [];
HEAD.concat(MID).forEach(([g, n]) => { for (let i = 0; i < n; i++) genrePlan.push(g); });
TAIL.forEach((g, i) => { genrePlan.push(g); if (i % 3 === 0) genrePlan.push(g); });

const WORDS = ['Iron', 'Hollow', 'Crimson', 'Silent', 'Deep', 'Frozen', 'Last', 'Broken', 'Neon',
  'Quiet', 'Rusted', 'Endless', 'Pale', 'Wild', 'Hidden', 'Burning', 'Lone', 'Vast'];
const NOUNS = ['Harbor', 'Circuit', 'Orbit', 'Descent', 'Reach', 'Signal', 'Garden', 'Foundry',
  'Passage', 'Vault', 'Drift', 'Echo', 'Ridge', 'Tide', 'Machine', 'Bloom', 'Vigil', 'Cradle'];

const games = [];
genrePlan.forEach((genre, i) => {
  const name = `${WORDS[i % WORDS.length]} ${NOUNS[(i * 7) % NOUNS.length]} ${1 + (i % 9)}`;
  /* 1 de cada 9 sin genero, 1 de cada 7 sin perspectiva, 1 de cada 11 sin modo. */
  games.push({
    id: 'g' + String(i).padStart(4, '0'),
    name,
    genre: i % 9 === 4 ? '' : genre,
    perspective: i % 7 === 3 ? '' : PERSPECTIVES[i % PERSPECTIVES.length],
    mode: i % 11 === 5 ? '' : MODES[i % MODES.length]
  });
});

const pick = (pred, n) => games.filter(pred).slice(0, n).map((g) => g.id);

const collections = [
  {
    slug: 'tactical-military',
    title: 'Tactical & Military Shooters',
    blurb: 'Deliberate pace, lethal time-to-kill and squad coordination.',
    filters: { perspective: ['First Person'], genre: ['Tactical Shooter', 'FPS', 'Shooter'] },
    /* A proposito: menos titulos de los que devuelve el filtro. */
    games: pick((g) => g.genre === 'Tactical Shooter', 3)
  },
  {
    slug: 'survival-coop',
    title: 'Survival & Co-op',
    blurb: 'Crafting, scarcity and staying alive with someone else on the line.',
    filters: { perspective: ['First Person'], genre: ['Survival', 'Survival Horror', 'Roguelike'], mode: ['Co-op'] },
    /* A proposito: incluye un titulo que el filtro NO devolveria. */
    games: pick((g) => g.genre === 'Survival', 4).concat(pick((g) => g.genre === 'Puzzle', 1))
  },
  {
    slug: 'single-player-epics',
    title: 'Single-player Epics',
    blurb: 'Long campaigns worth finishing.',
    filters: { mode: ['Singleplayer'], genre: ['RPG', 'Adventure', 'Souls-like'] },
    games: pick((g) => g.genre === 'RPG' && g.mode === 'Singleplayer', 6)
  },
  {
    slug: 'driving',
    title: 'Driving & Racing',
    blurb: 'Circuits, rally stages and long hauls.',
    filters: { genre: ['Racing', 'Racing Sim', 'Driving Survival'] },
    games: pick((g) => g.genre === 'Racing' || g.genre === 'Racing Sim', 5)
  },
  {
    slug: 'long-tail',
    title: 'Odd Ones Out',
    blurb: 'Genres with barely any titles in the catalogue.',
    filters: { genre: ['Walking Simulator', 'Rhythm', 'Visual Novel'] },
    games: pick((g) => g.genre === 'Walking Simulator' || g.genre === 'Rhythm', 3)
  },
  {
    slug: 'no-metadata',
    title: 'Unclassified',
    blurb: 'Indexed titles that still have no genre on file.',
    filters: {},
    games: pick((g) => !g.genre, 5)
  }
];

const data = { version: '2026-08-19-big-fixture', games, collections };
writeFileSync(resolve(here, 'catalog.big.json'), JSON.stringify(data, null, 2), 'utf8');

const genres = new Set(games.map((g) => g.genre).filter(Boolean));
console.log(`ok: ${games.length} titulos, ${genres.size} generos, ${collections.length} colecciones`);
console.log(`    sin genero: ${games.filter((g) => !g.genre).length}, ` +
  `sin perspectiva: ${games.filter((g) => !g.perspective).length}, ` +
  `sin modo: ${games.filter((g) => !g.mode).length}`);
