/* gamescatalog.wiki — nucleo de datos y ruteo por URL.
 * Sin dependencias. Corre igual en el navegador (window.CatalogCore) y en node (require/import).
 * Este archivo no sabe nada de la UI: recibe datos crudos + una query string y devuelve una vista.
 *
 * genre, perspective y mode son MULTIVALUADOS: el archivo de datos puede traer un array
 * o un string con los valores separados por coma ("Action Adventure, Shooter").
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CatalogCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ATTRS = ['perspective', 'genre', 'mode'];

  function str(v) { return typeof v === 'string' ? v.trim() : ''; }

  function uniq(list) {
    var seen = Object.create(null), out = [];
    list.forEach(function (v) { if (!seen[v]) { seen[v] = 1; out.push(v); } });
    return out;
  }

  /* Un campo multivaluado: array, o string separado por comas. Devuelve siempre un array
   * de valores limpios y sin repetir. Un campo vacio devuelve []. */
  function values(raw) {
    var list;
    if (Array.isArray(raw)) list = raw;
    else if (typeof raw === 'string') list = raw.split(',');
    else list = [];
    return uniq(list.map(str).filter(Boolean));
  }

  /* Normalizacion de texto para el buscador: sin mayusculas y sin diacriticos. */
  function fold(s) {
    return String(s).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function byName(a, b) {
    var c = a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true });
    return c !== 0 ? c : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  /* ---------------------------------------------------------------- datos -- */

  function normalizeCatalog(raw) {
    var warnings = [];
    var data = (raw && typeof raw === 'object') ? raw : {};
    if (!raw || typeof raw !== 'object') warnings.push('El catalogo no es un objeto; se usa uno vacio.');

    var games = [], byId = Object.create(null);
    var rawGames = Array.isArray(data.games) ? data.games : [];
    if (!Array.isArray(data.games)) warnings.push('Falta el array "games".');

    rawGames.forEach(function (g, i) {
      if (!g || typeof g !== 'object') { warnings.push('games[' + i + '] no es un objeto; ignorado.'); return; }
      var id = str(g.id);
      if (!id) { warnings.push('games[' + i + '] no tiene id; ignorado.'); return; }
      if (byId[id]) { warnings.push('id duplicado "' + id + '"; se conserva la primera aparicion.'); return; }
      var game = {
        id: id,
        name: str(g.name) || '(sin nombre)',
        perspective: values(g.perspective),
        genre: values(g.genre),
        mode: values(g.mode)
      };
      byId[id] = game;
      games.push(game);
    });

    var collections = [], bySlug = Object.create(null);
    var rawCols = Array.isArray(data.collections) ? data.collections : [];

    rawCols.forEach(function (c, i) {
      if (!c || typeof c !== 'object') { warnings.push('collections[' + i + '] no es un objeto; ignorada.'); return; }
      var slug = str(c.slug);
      if (!slug) { warnings.push('collections[' + i + '] no tiene slug; ignorada.'); return; }
      if (bySlug[slug]) { warnings.push('slug duplicado "' + slug + '"; se conserva la primera.'); return; }

      var filters = {};
      ATTRS.forEach(function (attr) {
        filters[attr] = values(c.filters ? c.filters[attr] : null);
      });

      var ids = Array.isArray(c.games) ? c.games.map(str).filter(Boolean) : [];
      var kept = [];
      uniq(ids).forEach(function (id) {
        if (byId[id]) kept.push(id);
        else warnings.push('la coleccion "' + slug + '" referencia el id "' + id + '", que no esta en games; se omite.');
      });
      if (ids.length !== uniq(ids).length) warnings.push('la coleccion "' + slug + '" repite ids; se deduplican.');

      var col = { slug: slug, title: str(c.title) || slug, blurb: str(c.blurb), filters: filters,
        games: kept, curated: c.curated !== false };
      bySlug[slug] = col;
      collections.push(col);
    });

    var catalog = {
      version: str(data.version),
      games: games,
      byId: byId,
      collections: collections,
      bySlug: bySlug,
      warnings: warnings
    };
    catalog.curatedGenres = buildCuratedGenres(collections);
    catalog.vocabulary = buildVocabulary(games, catalog.curatedGenres);
    return catalog;
  }

  /* Generos que quedan "reservados" por una categoria curada.
   *
   * Si una categoria tiene lista curada, sus generos describen algo que ademas esta
   * elegido a mano: filtrar por uno de esos generos tiene que devolver los titulos
   * elegidos, no todos los que llevan la etiqueta. Sin esto, el mismo genero da
   * resultados distintos segun cuantos otros generos se marquen a la vez.
   *
   * Un genero que ademas pertenece a una categoria SIN curaduria no se reserva: esa
   * categoria acepta cualquier titulo que lo tenga, asi que restringirlo se
   * contradiria con su propia lista.
   *
   * Devuelve { genero: { idPermitido: true } }. Un genero ausente no restringe nada. */
  function buildCuratedGenres(collections) {
    var abiertos = Object.create(null);
    collections.forEach(function (col) {
      if (col.curated) return;
      col.filters.genre.forEach(function (g) { abiertos[g] = true; });
    });

    var reservados = Object.create(null);
    collections.forEach(function (col) {
      if (!col.curated) return;
      col.filters.genre.forEach(function (g) {
        if (abiertos[g]) return;
        if (!reservados[g]) reservados[g] = Object.create(null);
        col.games.forEach(function (id) { reservados[g][id] = true; });
      });
    });
    return reservados;
  }

  /* Vocabulario derivado EXCLUSIVAMENTE de los datos. Cada valor de un campo multivaluado
   * cuenta por separado. El vacio no genera opcion. */
  function buildVocabulary(games, reservados) {
    reservados = reservados || Object.create(null);
    var vocab = {};
    ATTRS.forEach(function (attr) {
      var counts = Object.create(null);
      games.forEach(function (g) {
        g[attr].forEach(function (v) {
          /* Un genero reservado cuenta solo los titulos de su curaduria, para que el
           * numero del panel sea el mismo que el resultado de tildarlo. El valor sigue
           * en la lista aunque quede en cero: un genero que existe en los datos no
           * desaparece del vocabulario, se muestra vacio. */
          if (attr === 'genre' && reservados[v] && reservados[v][g.id] !== true) {
            if (counts[v] === undefined) counts[v] = 0;
            return;
          }
          counts[v] = (counts[v] || 0) + 1;
        });
      });
      vocab[attr] = Object.keys(counts)
        .map(function (v) { return { value: v, count: counts[v] }; })
        .sort(function (a, b) {
          if (b.count !== a.count) return b.count - a.count;
          return a.value.localeCompare(b.value, 'en', { sensitivity: 'base' });
        });
    });
    return vocab;
  }

  /* Opciones a pintar para un atributo: el vocabulario mas cualquier valor seleccionado
   * que no exista en los datos (llega desde los filters de una coleccion). Se muestra con
   * count 0 en vez de desaparecer, para que el estado de la URL siempre sea visible. */
  function optionsFor(catalog, attr, selected) {
    var base = catalog.vocabulary[attr] || [];
    var known = Object.create(null);
    base.forEach(function (o) { known[o.value] = true; });
    var extra = (selected || []).filter(function (v) { return !known[v]; })
      .map(function (v) { return { value: v, count: 0 }; })
      .sort(function (a, b) { return a.value.localeCompare(b.value, 'en', { sensitivity: 'base' }); });
    return base.concat(extra);
  }

  /* ---------------------------------------------------------------- estado -- */

  function emptyState() {
    return { collection: null, filters: { perspective: [], genre: [], mode: [] }, q: '' };
  }

  function parseQuery(search) {
    var params = new URLSearchParams(String(search || '').replace(/^[?#]/, ''));
    var state = emptyState();

    /* El texto del buscador NO se recorta: se guarda tal cual lo escribio la persona,
     * para que el campo no se le edite solo mientras tipea (los espacios importan). */
    state.q = params.get('q') === null ? '' : String(params.get('q'));

    ATTRS.forEach(function (attr) {
      var vals = [];
      params.getAll(attr).forEach(function (chunk) {
        String(chunk).split(',').forEach(function (v) {
          var t = str(v);
          if (t) vals.push(t);
        });
      });
      state.filters[attr] = uniq(vals);
    });

    /* La coleccion y los filtros conviven: los filtros acotan la lista de la categoria,
     * nunca la amplian. */
    var c = str(params.get('c'));
    if (c) state.collection = c;
    return state;
  }

  function hasFilters(state) {
    return ATTRS.some(function (attr) { return state.filters[attr].length > 0; });
  }

  /* Serializacion canonica: mismo estado -> misma URL, siempre. */
  function serializeState(state) {
    var params = new URLSearchParams();
    /* La coleccion y los filtros conviven: dentro de una categoria se puede acotar
     * por perspectiva, modo o genero sin salir de ella, y la URL lo refleja. */
    if (state.collection) params.set('c', state.collection);
    ATTRS.forEach(function (attr) {
      var vals = state.filters[attr].slice().sort(function (a, b) {
        return a.localeCompare(b, 'en', { sensitivity: 'base' });
      });
      if (vals.length) params.set(attr, vals.join(','));
    });
    if (state.q) params.set('q', state.q);
    var qs = params.toString();
    return qs ? '?' + qs : '';
  }

  function cloneState(state) {
    return {
      collection: state.collection,
      filters: {
        perspective: state.filters.perspective.slice(),
        genre: state.filters.genre.slice(),
        mode: state.filters.mode.slice()
      },
      q: state.q
    };
  }

  /* Tocar un filtro estando en una coleccion la abandona y hereda su recorte descriptivo
   * como punto de partida del filtrado libre. */
  function toggleFilter(catalog, state, attr, value) {
    if (ATTRS.indexOf(attr) === -1) throw new Error('atributo desconocido: ' + attr);
    var next = cloneState(state);
    /* Estando dentro de una categoria, tocar un filtro NO sale de ella: acota su lista.
     * Para salir estan el link "All titles" y el boton de la cabecera. */
    var i = next.filters[attr].indexOf(value);
    if (i === -1) next.filters[attr].push(value);
    else next.filters[attr].splice(i, 1);
    return next;
  }

  function setSearch(state, q) {
    var next = cloneState(state);
    next.q = typeof q === 'string' ? q : '';
    return next;
  }

  function clearAll() { return emptyState(); }

  function openCollection(slug) {
    var s = emptyState();
    s.collection = str(slug);
    return s;
  }

  /* ----------------------------------------------------------------- vista -- */

  function matchesFilters(game, filters, reservados) {
    /* OR dentro de un atributo, AND entre atributos. Un juego con varios valores en un
     * atributo entra si CUALQUIERA de ellos esta seleccionado. Un atributo vacio nunca
     * matchea una seleccion: el titulo queda fuera de ese filtro.
     *
     * Los generos reservados por una categoria curada solo dejan pasar a los titulos
     * de esa curaduria (ver buildCuratedGenres). */
    reservados = reservados || Object.create(null);
    return ATTRS.every(function (attr) {
      var sel = filters[attr];
      if (!sel.length) return true;
      var mine = game[attr];
      if (!mine.length) return false;
      return mine.some(function (v) {
        if (sel.indexOf(v) === -1) return false;
        if (attr !== 'genre') return true;
        var permitidos = reservados[v];
        return !permitidos || permitidos[game.id] === true;
      });
    });
  }

  /* Dos recortes son el mismo si, atributo por atributo, tienen exactamente los mismos
   * valores (sin importar el orden en que esten escritos). */
  function sameFilters(a, b) {
    return ATTRS.every(function (attr) {
      var x = a[attr].slice().sort(), y = b[attr].slice().sort();
      return x.length === y.length && x.every(function (v, i) { return v === y[i]; });
    });
  }

  /* Si el filtrado libre reproduce exactamente el recorte de una coleccion, la devolvemos
   * para poder ofrecer el atajo a la seleccion curada. Nunca cambia lo que se muestra. */
  function matchingCollection(catalog, state) {
    if (state.collection || !hasFilters(state)) return null;
    for (var i = 0; i < catalog.collections.length; i++) {
      if (sameFilters(catalog.collections[i].filters, state.filters)) return catalog.collections[i];
    }
    return null;
  }

  function matchesQuery(game, folded) {
    return !folded || fold(game.name).indexOf(folded) !== -1;
  }

  function resolve(catalog, state) {
    var notices = [];
    var folded = fold(state.q);

    if (state.collection) {
      var col = catalog.bySlug[state.collection];
      if (!col) {
        notices.push({ type: 'unknown-collection', slug: state.collection });
        var free = resolveFree(catalog, emptyState(), '', notices);
        free.requestedCollection = state.collection;
        return free;
      }
      /* Membresia literal: exactamente los ids de `games`, en el orden declarado. */
      var list = col.games.map(function (id) { return catalog.byId[id]; });
      /* Los filtros acotan DENTRO de la categoria. Nunca agregan titulos: la lista
       * curada sigue siendo el techo. Los generos reservados no se aplican aca —
       * adentro de la curaduria no hay nada que reservar. */
      var shown = list.filter(function (g) {
        return matchesFilters(g, state.filters, null) && matchesQuery(g, folded);
      });
      return {
        mode: 'collection',
        collection: col,
        state: state,
        games: shown,
        count: shown.length,
        collectionSize: list.length,
        filtersApplied: hasFilters(state),
        searchApplied: !!folded,
        notices: notices
      };
    }
    return resolveFree(catalog, state, folded, notices);
  }

  function resolveFree(catalog, state, folded, notices) {
    folded = folded || fold(state.q);
    var games = catalog.games.filter(function (g) {
      return matchesFilters(g, state.filters, catalog.curatedGenres) && matchesQuery(g, folded);
    }).sort(byName);
    return {
      mode: 'free',
      collection: null,
      state: state,
      games: games,
      count: games.length,
      total: catalog.games.length,
      searchApplied: !!folded,
      curatedMatch: matchingCollection(catalog, state),
      notices: notices || []
    };
  }

  return {
    ATTRS: ATTRS,
    values: values,
    normalizeCatalog: normalizeCatalog,
    buildVocabulary: buildVocabulary,
    optionsFor: optionsFor,
    sameFilters: sameFilters,
    matchingCollection: matchingCollection,
    emptyState: emptyState,
    parseQuery: parseQuery,
    serializeState: serializeState,
    cloneState: cloneState,
    hasFilters: hasFilters,
    toggleFilter: toggleFilter,
    setSearch: setSearch,
    clearAll: clearAll,
    openCollection: openCollection,
    resolve: resolve,
    fold: fold
  };
});
