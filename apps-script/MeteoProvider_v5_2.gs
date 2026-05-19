// ================================================================
// DOLLARSPOT SENTINEL v5.2 - MeteoProvider
//
// Dipende da:
// - MeteoCache_v5_2.gs
//
// Scopo:
// - Fornire al modello rischio una sola funzione meteo:
//     fetchMeteoV52({campoId, nomeCampo, lat, lon})
// - Provare dati live Open-Meteo.
// - Aggiornare MeteoCache se il live funziona.
// - Usare MeteoCache se il live fallisce.
// - Restituire una struttura compatibile con il modello esistente,
//   arricchita con meta.qualitaDato e dailyByDate.
// ================================================================

var METEO_PROVIDER_CONFIG = {
  STORICO_GIORNI_MODELLO: 11,
  FORECAST_GIORNI_MODELLO: 3,
  MIN_STORICO_GIORNI: 5
};

function fetchMeteoV52(campo) {
  if (!campo || !campo.campoId || !campo.nomeCampo || !isFinite(Number(campo.lat)) || !isFinite(Number(campo.lon))) {
    throw new Error("fetchMeteoV52: campo non valido");
  }

  try {
    var liveRows = fetchOpenMeteoDaily_(campo);
    upsertMeteoCacheRows_(liveRows);
    return buildMeteoForRiskFromRows_(campo, liveRows, {
      fonte: "open-meteo",
      qualitaDato: "live",
      note: "Dati live aggiornati e salvati in MeteoCache"
    });
  } catch (liveError) {
    appendMeteoError_("fetchMeteoV52.live", campo.nomeCampo, liveError.message || String(liveError), safeMeteoStringify_(liveError));

    var cacheRows = readMeteoCacheWindowForModel_(campo.campoId);
    if (!cacheRows.length || countRowsByTipo_(cacheRows, "storico") < METEO_PROVIDER_CONFIG.MIN_STORICO_GIORNI) {
      throw new Error("Meteo live non disponibile e MeteoCache insufficiente per " + campo.nomeCampo + ": " + (liveError.message || liveError));
    }

    return buildMeteoForRiskFromRows_(campo, cacheRows, {
      fonte: "MeteoCache",
      qualitaDato: inferCacheQuality_(cacheRows),
      note: "Fallback da MeteoCache dopo errore live: " + (liveError.message || liveError)
    });
  }
}

function readMeteoCacheWindowForModel_(campoId) {
  var today = new Date();
  var start = new Date(today);
  start.setDate(start.getDate() - METEO_PROVIDER_CONFIG.STORICO_GIORNI_MODELLO);
  var end = new Date(today);
  end.setDate(end.getDate() + METEO_PROVIDER_CONFIG.FORECAST_GIORNI_MODELLO);
  return getMeteoCacheCampo(campoId, formatMeteoDate_(start), formatMeteoDate_(end));
}

function buildMeteoForRiskFromRows_(campo, rows, meta) {
  var todayStr = Utilities.formatDate(new Date(), METEO_CONFIG.TIMEZONE, "yyyy-MM-dd");

  var sorted = rows.slice().sort(function(a, b) {
    return String(a.data).localeCompare(String(b.data));
  });

  var dailyByDate = {};
  sorted.forEach(function(row) {
    dailyByDate[row.data] = row;
  });

  var storico = sorted.filter(function(row) {
    return row.data <= todayStr;
  }).slice(-METEO_PROVIDER_CONFIG.STORICO_GIORNI_MODELLO - 1);

  var forecast = sorted.filter(function(row) {
    return row.data >= todayStr;
  }).slice(0, METEO_PROVIDER_CONFIG.FORECAST_GIORNI_MODELLO + 1);

  if (storico.length < METEO_PROVIDER_CONFIG.MIN_STORICO_GIORNI) {
    throw new Error("Storico meteo insufficiente per " + campo.nomeCampo + ": " + storico.length + " giorni");
  }

  // Compatibilita con il modello esistente:
  // archD/foreD mantengono i nomi Open-Meteo usati da v5.1.
  var meteo = {
    archD: buildDailyBlock_(storico),
    foreD: buildForecastBlock_(forecast),
    archH: buildEmptyHourlyBlock_(),
    foreH: buildEmptyHourlyBlock_(),
    dailyByDate: dailyByDate,
    meta: {
      campoId: campo.campoId,
      nomeCampo: campo.nomeCampo,
      lat: campo.lat,
      lon: campo.lon,
      fonte: meta.fonte,
      qualitaDato: meta.qualitaDato,
      note: meta.note,
      generatedAt: new Date().toISOString()
    }
  };

  return meteo;
}

function buildDailyBlock_(rows) {
  return {
    time: rows.map(function(r) { return r.data; }),
    temperature_2m_mean: rows.map(function(r) { return numberOrNull_(r.tMedia); }),
    relative_humidity_2m_mean: rows.map(function(r) { return numberOrNull_(r.umiditaMedia); }),
    precipitation_sum: rows.map(function(r) { return numberOrNull_(r.pioggia); }),
    wind_speed_10m_max: rows.map(function(r) { return numberOrNull_(r.ventoMax); }),
    et0_fao_evapotranspiration: rows.map(function(r) { return numberOrNull_(r.et0); }),
    soil_temperature_0cm_mean: rows.map(function(r) { return numberOrNull_(r.tempSuolo); }),
    lwd_hours: rows.map(function(r) { return numberOrNull_(r.lwd); })
  };
}

function buildForecastBlock_(rows) {
  return {
    time: rows.map(function(r) { return r.data; }),
    temperature_2m_max: rows.map(function(r) { return numberOrNull_(r.tMax); }),
    temperature_2m_min: rows.map(function(r) { return numberOrNull_(r.tMin); }),
    temperature_2m_mean: rows.map(function(r) { return numberOrNull_(r.tMedia); }),
    relative_humidity_2m_mean: rows.map(function(r) { return numberOrNull_(r.umiditaMedia); }),
    precipitation_sum: rows.map(function(r) { return numberOrNull_(r.pioggia); }),
    wind_speed_10m_max: rows.map(function(r) { return numberOrNull_(r.ventoMax); }),
    et0_fao_evapotranspiration: rows.map(function(r) { return numberOrNull_(r.et0); }),
    soil_temperature_0cm_mean: rows.map(function(r) { return numberOrNull_(r.tempSuolo); }),
    lwd_hours: rows.map(function(r) { return numberOrNull_(r.lwd); })
  };
}

function buildEmptyHourlyBlock_() {
  return {
    time: [],
    temperature_2m: [],
    relative_humidity_2m: [],
    dew_point_2m: [],
    wind_speed_10m: [],
    soil_temperature_0cm: []
  };
}

function getLwdOreV52(meteo, hourly, dateStr) {
  var cached = getDailyValueV52_(meteo, dateStr, "lwd");
  if (cached !== null) return cached;

  // Compatibilita con il codice v5.1 se stimaLWD esiste.
  if (typeof stimaLWD === "function") {
    return stimaLWD(hourly, dateStr);
  }
  return 0;
}

function getTSuoloGiornoV52(meteo, hourly, dateStr) {
  var cached = getDailyValueV52_(meteo, dateStr, "tempSuolo");
  if (cached !== null) return cached;

  if (!hourly || !hourly.soil_temperature_0cm || !hourly.time) return null;
  var vals = [];
  hourly.time.forEach(function(t, i) {
    if (String(t).indexOf(dateStr) === 0 && hourly.soil_temperature_0cm[i] !== null && hourly.soil_temperature_0cm[i] !== undefined) {
      var n = Number(hourly.soil_temperature_0cm[i]);
      if (isFinite(n)) vals.push(n);
    }
  });
  return vals.length ? vals.reduce(function(a, b) { return a + b; }, 0) / vals.length : null;
}

function getMeteoQualityLabelV52(meteo) {
  if (!meteo || !meteo.meta) return "meteo: non disponibile";
  var label = "meteo: " + meteo.meta.qualitaDato + " (" + meteo.meta.fonte + ")";
  if (meteo.meta.note) label += " - " + meteo.meta.note;
  return label;
}

function shouldSendAlertWithMeteoV52(meteo) {
  if (!meteo || !meteo.meta) return false;
  return meteo.meta.qualitaDato !== "errore";
}

function getDailyValueV52_(meteo, dateStr, key) {
  if (!meteo || !meteo.dailyByDate || !meteo.dailyByDate[dateStr]) return null;
  var n = Number(meteo.dailyByDate[dateStr][key]);
  return isFinite(n) ? n : null;
}

function inferCacheQuality_(rows) {
  var todayStr = Utilities.formatDate(new Date(), METEO_CONFIG.TIMEZONE, "yyyy-MM-dd");
  var todayRows = rows.filter(function(r) { return r.data === todayStr; });
  if (todayRows.length) return "cache_oggi";
  return "cache_recente";
}

function countRowsByTipo_(rows, tipo) {
  return rows.filter(function(row) {
    return row.tipo === tipo || (tipo === "storico" && row.data <= Utilities.formatDate(new Date(), METEO_CONFIG.TIMEZONE, "yyyy-MM-dd"));
  }).length;
}

function numberOrNull_(value) {
  var n = Number(value);
  return isFinite(n) ? n : null;
}

// ================================================================
// Esempio di integrazione nel codice v5.1/v5.2 completo:
//
// Sostituire:
//   var meteo = fetchMeteo(lat, lon);
//
// Con:
//   var meteo = fetchMeteoV52({
//     campoId: campoId,
//     nomeCampo: nomeCampo,
//     lat: lat,
//     lon: lon
//   });
//   Logger.log(getMeteoQualityLabelV52(meteo));
//
// Nei calcoli usare:
//   var lwd = getLwdOreV52(meteo, hourly, dateStr);
//   var tSuolo = getTSuoloGiornoV52(meteo, hourly, dateStr);
//
// Se shouldSendAlertWithMeteoV52(meteo) e false, non inviare alert
// automatici e scrivere errore/audit.
// ================================================================
