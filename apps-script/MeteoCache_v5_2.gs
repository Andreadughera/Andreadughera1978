// ================================================================
// DOLLARSPOT SENTINEL v5.2 - MeteoCache
//
// Modulo opzionale da affiancare a DollarSpot_Sentinel_v5_2_TEST.gs.
// Generalizza lo script "Aggiorna Meteo - Golf Claviere" a piu campi.
//
// Trigger consigliato:
// - aggiornaMeteoCacheTuttiCampi -> ogni giorno 06:00-06:30
//
// Fogli richiesti:
// - Campi
// - MeteoCache (creato automaticamente se manca)
// - Errori (creato dal modulo hardening o automaticamente qui)
// ================================================================

var METEO_CONFIG = {
  NOME_FOGLIO_CAMPI: "Campi",
  NOME_FOGLIO_METEO_CACHE: "MeteoCache",
  NOME_FOGLIO_ERRORI: "Errori",
  TIMEZONE: "Europe/Rome",
  STORICO_GIORNI: 30,
  FORECAST_GIORNI: 7,
  SLEEP_MS_PER_CAMPO: 900
};

var METEO_HEADERS = [
  "Data",
  "CampoId",
  "NomeCampo",
  "Lat",
  "Lon",
  "Tipo",
  "Fonte",
  "TMin",
  "TMax",
  "TMedia",
  "UmiditaMedia",
  "Pioggia",
  "VentoMax",
  "ET0",
  "TempSuolo",
  "LWD",
  "AggiornatoIl",
  "QualitaDato",
  "Note"
];

function aggiornaMeteoCacheTuttiCampi() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var campi = leggiCampiMeteo_();
  var aggiornati = 0;

  campi.forEach(function(campo) {
    try {
      var righe = fetchOpenMeteoDaily_(campo);
      upsertMeteoCacheRows_(righe);
      aggiornati++;
      Utilities.sleep(METEO_CONFIG.SLEEP_MS_PER_CAMPO);
    } catch (e) {
      appendMeteoError_("aggiornaMeteoCacheTuttiCampi", campo.nomeCampo, e.message || String(e), safeMeteoStringify_(e));
    }
  });

  Logger.log("MeteoCache aggiornata per " + aggiornati + "/" + campi.length + " campi");
}

function aggiornaMeteoCacheCampo(campoId) {
  var campi = leggiCampiMeteo_().filter(function(campo) {
    return campo.campoId === campoId || campo.nomeCampo === campoId;
  });
  if (!campi.length) {
    throw new Error("Campo non trovato: " + campoId);
  }
  var righe = fetchOpenMeteoDaily_(campi[0]);
  upsertMeteoCacheRows_(righe);
  return righe.length;
}

function getMeteoCacheCampo(campoId, startDate, endDate) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateMeteoCacheSheet_(ss);
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  var start = parseMeteoDate_(startDate);
  var end = parseMeteoDate_(endDate);

  return values.slice(1).filter(function(row) {
    var rowDate = parseMeteoDate_(row[0]);
    var rowCampoId = String(row[1] || "");
    if (rowCampoId !== campoId) return false;
    if (start && rowDate < start) return false;
    if (end && rowDate > end) return false;
    return true;
  }).map(rowToMeteoObject_);
}

function getMeteoFallbackForCampo(campoId, dateStr) {
  var target = parseMeteoDate_(dateStr);
  if (!target) throw new Error("Data fallback meteo non valida: " + dateStr);

  var rows = getMeteoCacheCampo(campoId, dateStr, dateStr);
  if (rows.length) {
    rows[0].qualitaDato = rows[0].qualitaDato === "live" ? "cache_oggi" : rows[0].qualitaDato;
    return rows[0];
  }

  var start = new Date(target);
  start.setDate(start.getDate() - 2);
  var recent = getMeteoCacheCampo(campoId, formatMeteoDate_(start), dateStr);
  if (recent.length) {
    var latest = recent[recent.length - 1];
    latest.qualitaDato = "cache_recente";
    latest.note = appendNote_(latest.note, "Fallback: ultimo dato recente disponibile");
    return latest;
  }

  return null;
}

function fetchOpenMeteoDaily_(campo) {
  var oggi = new Date();
  var start = new Date(oggi);
  start.setDate(start.getDate() - METEO_CONFIG.STORICO_GIORNI);
  var fine = new Date(oggi);
  fine.setDate(fine.getDate() + METEO_CONFIG.FORECAST_GIORNI);

  var strStart = Utilities.formatDate(start, "UTC", "yyyy-MM-dd");
  var strFine = Utilities.formatDate(fine, "UTC", "yyyy-MM-dd");
  var oggiStr = Utilities.formatDate(oggi, "UTC", "yyyy-MM-dd");

  var url = "https://api.open-meteo.com/v1/forecast" +
    "?latitude=" + encodeURIComponent(campo.lat) +
    "&longitude=" + encodeURIComponent(campo.lon) +
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum," +
      "relative_humidity_2m_mean,wind_speed_10m_max,et0_fao_evapotranspiration" +
    "&hourly=soil_temperature_0cm,relative_humidity_2m,temperature_2m,dew_point_2m" +
    "&start_date=" + strStart +
    "&end_date=" + strFine +
    "&timezone=Europe/Rome";

  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    throw new Error("Open-Meteo HTTP " + resp.getResponseCode() + ": " + resp.getContentText().substring(0, 200));
  }

  var json = JSON.parse(resp.getContentText());
  var daily = json.daily || {};
  var hourly = json.hourly || {};
  var times = daily.time || [];
  var now = nowMeteoIt_();

  return times.map(function(dateStr, i) {
    var tMin = numberOrBlank_(daily.temperature_2m_min && daily.temperature_2m_min[i]);
    var tMax = numberOrBlank_(daily.temperature_2m_max && daily.temperature_2m_max[i]);
    var tMedia = (tMin !== "" && tMax !== "") ? round1_((Number(tMin) + Number(tMax)) / 2) : "";
    var tipo = dateStr < oggiStr ? "storico" : (dateStr === oggiStr ? "oggi" : "forecast");
    var tempSuolo = getHourlyAverageForDate_(dateStr, hourly, "soil_temperature_0cm");
    var lwd = stimaLwdFromHourlyForDate_(dateStr, hourly);

    return {
      data: dateStr,
      campoId: campo.campoId,
      nomeCampo: campo.nomeCampo,
      lat: campo.lat,
      lon: campo.lon,
      tipo: tipo,
      fonte: "open-meteo",
      tMin: tMin,
      tMax: tMax,
      tMedia: tMedia,
      umiditaMedia: numberOrBlank_(daily.relative_humidity_2m_mean && daily.relative_humidity_2m_mean[i]),
      pioggia: numberOrBlank_(daily.precipitation_sum && daily.precipitation_sum[i]),
      ventoMax: numberOrBlank_(daily.wind_speed_10m_max && daily.wind_speed_10m_max[i]),
      et0: numberOrBlank_(daily.et0_fao_evapotranspiration && daily.et0_fao_evapotranspiration[i]),
      tempSuolo: tempSuolo,
      lwd: lwd,
      aggiornatoIl: now,
      qualitaDato: "live",
      note: ""
    };
  });
}

function upsertMeteoCacheRows_(rows) {
  if (!rows || !rows.length) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateMeteoCacheSheet_(ss);
  var existing = sheet.getDataRange().getValues();
  var indexByKey = {};

  for (var i = 1; i < existing.length; i++) {
    var key = makeMeteoKey_(existing[i][1], existing[i][0]);
    indexByKey[key] = i + 1;
  }

  var appends = [];
  rows.forEach(function(rowObj) {
    var row = meteoObjectToRow_(rowObj);
    var key = makeMeteoKey_(rowObj.campoId, rowObj.data);
    var rowNumber = indexByKey[key];
    if (rowNumber) {
      sheet.getRange(rowNumber, 1, 1, METEO_HEADERS.length).setValues([row]);
    } else {
      appends.push(row);
    }
  });

  if (appends.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, METEO_HEADERS.length).setValues(appends);
  }
}

function leggiCampiMeteo_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(METEO_CONFIG.NOME_FOGLIO_CAMPI);
  if (!sheet) throw new Error("Foglio Campi non trovato");

  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  var headerInfo = getMeteoHeaderInfo_(sheet);
  var idxCampoId = headerInfo.indexByName.campoId;
  var idxAttivo = headerInfo.indexByName.attivo;

  return values.slice(1).map(function(row) {
    var nomeCampo = row[0];
    var lat = Number(row[1]);
    var lon = Number(row[2]);
    var campoId = idxCampoId !== undefined ? row[idxCampoId] : makeMeteoCampoId_(nomeCampo);
    var attivo = idxAttivo !== undefined ? row[idxAttivo] : true;
    return {
      nomeCampo: nomeCampo,
      lat: lat,
      lon: lon,
      campoId: campoId || makeMeteoCampoId_(nomeCampo),
      attivo: !(attivo === false || String(attivo).toLowerCase() === "false" || String(attivo).toLowerCase() === "no")
    };
  }).filter(function(campo) {
    return campo.nomeCampo && isFinite(campo.lat) && isFinite(campo.lon) && campo.attivo;
  });
}

function getOrCreateMeteoCacheSheet_(ss) {
  var sheet = ss.getSheetByName(METEO_CONFIG.NOME_FOGLIO_METEO_CACHE);
  if (!sheet) {
    sheet = ss.insertSheet(METEO_CONFIG.NOME_FOGLIO_METEO_CACHE);
    sheet.appendRow(METEO_HEADERS);
    sheet.getRange(1, 1, 1, METEO_HEADERS.length).setFontWeight("bold").setBackground("#4ADE80");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getMeteoHeaderInfo_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var indexByName = {};
  headers.forEach(function(header, idx) {
    if (header) indexByName[String(header).trim()] = idx;
  });
  return { headers: headers, indexByName: indexByName };
}

function rowToMeteoObject_(row) {
  return {
    data: formatMeteoDate_(parseMeteoDate_(row[0])),
    campoId: row[1],
    nomeCampo: row[2],
    lat: row[3],
    lon: row[4],
    tipo: row[5],
    fonte: row[6],
    tMin: row[7],
    tMax: row[8],
    tMedia: row[9],
    umiditaMedia: row[10],
    pioggia: row[11],
    ventoMax: row[12],
    et0: row[13],
    tempSuolo: row[14],
    lwd: row[15],
    aggiornatoIl: row[16],
    qualitaDato: row[17],
    note: row[18]
  };
}

function meteoObjectToRow_(obj) {
  return [
    obj.data,
    obj.campoId,
    obj.nomeCampo,
    obj.lat,
    obj.lon,
    obj.tipo,
    obj.fonte,
    obj.tMin,
    obj.tMax,
    obj.tMedia,
    obj.umiditaMedia,
    obj.pioggia,
    obj.ventoMax,
    obj.et0,
    obj.tempSuolo,
    obj.lwd,
    obj.aggiornatoIl,
    obj.qualitaDato,
    obj.note
  ];
}

function makeMeteoKey_(campoId, dateValue) {
  return String(campoId || "") + "|" + formatMeteoDate_(parseMeteoDate_(dateValue));
}

function makeMeteoCampoId_(nomeCampo) {
  return String(nomeCampo || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 60);
}

function parseMeteoDate_(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === "[object Date]") {
    var d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  var s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    var parts = s.split("-");
    var d2 = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d2.setHours(0, 0, 0, 0);
    return d2;
  }
  var d3 = new Date(s);
  if (isNaN(d3.getTime())) return null;
  d3.setHours(0, 0, 0, 0);
  return d3;
}

function formatMeteoDate_(date) {
  if (!date) return "";
  return Utilities.formatDate(date, METEO_CONFIG.TIMEZONE, "yyyy-MM-dd");
}

function nowMeteoIt_() {
  return Utilities.formatDate(new Date(), METEO_CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss");
}

function numberOrBlank_(value) {
  var n = Number(value);
  return isFinite(n) ? round1_(n) : "";
}

function round1_(n) {
  return Math.round(Number(n) * 10) / 10;
}

function getHourlyAverageForDate_(dateStr, hourly, field) {
  if (!hourly || !hourly.time || !hourly[field]) return "";
  var vals = [];
  hourly.time.forEach(function(t, i) {
    if (String(t).indexOf(dateStr) !== 0) return;
    var v = Number(hourly[field][i]);
    if (isFinite(v)) vals.push(v);
  });
  if (!vals.length) return "";
  return round1_(vals.reduce(function(a, b) { return a + b; }, 0) / vals.length);
}

function stimaLwdFromHourlyForDate_(dateStr, hourly) {
  if (!hourly || !hourly.time) return "";
  var count = 0;
  hourly.time.forEach(function(t, i) {
    if (String(t).indexOf(dateStr) !== 0) return;
    var parts = String(t).split("T");
    if (parts.length < 2) return;
    var hour = Number(parts[1].split(":")[0]);
    if (!(hour >= 20 || hour < 8)) return;

    var rh = Number(hourly.relative_humidity_2m && hourly.relative_humidity_2m[i]);
    var temp = Number(hourly.temperature_2m && hourly.temperature_2m[i]);
    var dew = Number(hourly.dew_point_2m && hourly.dew_point_2m[i]);
    if ((isFinite(rh) && rh >= 90) || (isFinite(temp) && isFinite(dew) && temp <= dew + 1)) {
      count++;
    }
  });
  return count;
}

function appendMeteoError_(funzione, campo, errore, dettaglio) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(METEO_CONFIG.NOME_FOGLIO_ERRORI);
    if (!sheet) {
      sheet = ss.insertSheet(METEO_CONFIG.NOME_FOGLIO_ERRORI);
      sheet.appendRow(["Timestamp", "Gravita", "Funzione", "Campo", "Errore", "Dettaglio"]);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([nowMeteoIt_(), "error", funzione, campo, errore, dettaglio]);
  } catch (e) {
    Logger.log("appendMeteoError_ error: " + e);
  }
}

function appendNote_(base, note) {
  if (!base) return note;
  return base + " | " + note;
}

function safeMeteoStringify_(value) {
  try {
    return JSON.stringify(value);
  } catch (e) {
    return String(value);
  }
}
