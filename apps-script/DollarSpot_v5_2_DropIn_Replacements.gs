// ================================================================
// DOLLARSPOT SENTINEL v5.2 - Drop-in replacements
//
// Uso:
// - Copiare nel progetto Apps Script v5.2 TEST.
// - Usare per sostituire funzioni omonime del sorgente v5.1.
// - Non applicare direttamente alla produzione attuale.
//
// Dipendenze consigliate:
// - DollarSpot_Sentinel_v5_2_TEST.gs
// - MeteoCache_v5_2.gs
// - MeteoProvider_v5_2.gs
// ================================================================

function getSecretV52_(key, fallback) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (value !== null && value !== undefined && value !== "") return value;
  return fallback || "";
}

function getWeatherApiKeyV52_() {
  return getSecretV52_("WEATHERAPI_KEY", "");
}

function getTokenSegretoV52_() {
  return getSecretV52_("TOKEN_SEGRETO", "");
}

function getCampoIdFromRowV52_(row, headers, nomeCampo) {
  var idx = headers ? headers.indexOf("campoId") : -1;
  if (idx >= 0 && row[idx]) return row[idx];
  return String(nomeCampo || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 60);
}

function isFutureDateV52_(dateValue) {
  var date = parseDateOnlyV52_(dateValue);
  if (!date) return false;
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  return date.getTime() > today.getTime();
}

function parseDateOnlyV52_(dateValue) {
  if (!dateValue) return null;
  if (Object.prototype.toString.call(dateValue) === "[object Date]") {
    var d = new Date(dateValue);
    d.setHours(0, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  var s = String(dateValue).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    var parts = s.split("-");
    var d2 = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d2.setHours(0, 0, 0, 0);
    return isNaN(d2.getTime()) ? null : d2;
  }

  var d3 = new Date(s);
  if (isNaN(d3.getTime())) return null;
  d3.setHours(0, 0, 0, 0);
  return d3;
}

// ================================================================
// Sostituzioni registro con blocco date future
// ================================================================

function getNDisponibile(nomeCampo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.NOME_FOGLIO_REGISTRO);
  if (!sheet) return 0;
  var data = sheet.getDataRange().getValues();
  var oggi = new Date();
  var totale = 0;

  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (r[1] !== nomeCampo || r[2] !== "azoto") continue;
    var dataAppl = new Date(r[3]);
    if (isNaN(dataAppl.getTime())) continue;
    var settimane = (oggi - dataAppl) / (7 * 86400000);
    if (settimane < 0) continue;

    var npkPct = parseFloat(r[5]) || 0;
    var kg = parseFloat(r[6]) || 0;
    var rilascio = (r[7] || "medio").toLowerCase().trim();
    var nPuri = kg * (npkPct / 100);
    totale += nPuri * calcolaDisponibilitaN(settimane, rilascio);
  }
  return Math.round(totale * 100) / 100;
}

function getFerroMult(nomeCampo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.NOME_FOGLIO_REGISTRO);
  if (!sheet) return 1.00;
  var data = sheet.getDataRange().getValues();
  var oggi = new Date();
  var bestMult = 1.00;

  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (r[1] !== nomeCampo || r[2] !== "ferro") continue;
    var dataAppl = new Date(r[3]);
    if (isNaN(dataAppl.getTime())) continue;
    var giorni = Math.floor((oggi - dataAppl) / 86400000);
    if (giorni < 0) continue;
    var mult = MULT.ferro(giorni);
    if (mult < bestMult) bestMult = mult;
  }
  return bestMult;
}

function getFungoMult(nomeCampo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.NOME_FOGLIO_REGISTRO);
  if (!sheet) return 1.00;
  var data = sheet.getDataRange().getValues();
  var oggi = new Date();
  var bestMult = 1.00;

  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (r[1] !== nomeCampo || r[2] !== "fungo") continue;
    var dataAppl = new Date(r[3]);
    if (isNaN(dataAppl.getTime())) continue;
    var giorni = Math.floor((oggi - dataAppl) / 86400000);
    if (giorni < 0) continue;
    var prodotto = (String(r[4] || "altro")).toLowerCase().trim();
    var fn = MULT.fungo[prodotto] || MULT.fungo.altro;
    var mult = fn(giorni);
    if (mult < bestMult) bestMult = mult;
  }
  return bestMult;
}

function getRullaturaMult(nomeCampo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.NOME_FOGLIO_REGISTRO);
  if (!sheet) return 1.00;
  var data = sheet.getDataRange().getValues();
  var oggi = new Date();
  var bestMult = 1.00;

  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (r[1] !== nomeCampo || r[2] !== "rullatura") continue;
    var dataAppl = new Date(r[3]);
    if (isNaN(dataAppl.getTime())) continue;
    var giorni = Math.floor((oggi - dataAppl) / 86400000);
    if (giorni < 0) continue;
    var mult = giorni < 3 ? 0.85 : 1.00;
    if (mult < bestMult) bestMult = mult;
  }
  return bestMult;
}

function getZolfoMult(nomeCampo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.NOME_FOGLIO_REGISTRO);
  if (!sheet) return 1.00;
  var data = sheet.getDataRange().getValues();
  var oggi = new Date();
  var bestMult = 1.00;

  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (r[1] !== nomeCampo || r[2] !== "azoto") continue;
    var prodotto = (String(r[4] || "")).toLowerCase();
    if (prodotto.indexOf("solfato") === -1 && prodotto.indexOf("21-0-0") === -1) continue;
    var dataAppl = new Date(r[3]);
    if (isNaN(dataAppl.getTime())) continue;
    var giorni = Math.floor((oggi - dataAppl) / 86400000);
    if (giorni < 0) continue;
    var mult = giorni < 10 ? 0.93 : 1.00;
    if (mult < bestMult) bestMult = mult;
  }
  return bestMult;
}

// ================================================================
// Profilo climatico piu robusto
// ================================================================

function fetchProfiloClimaticoV52(lat, lon, nomeCampo, campoId) {
  var cache = PropertiesService.getScriptProperties();
  var cacheKey = "profilo_" + (campoId || nomeCampo).toString().replace(/\s/g, "_") +
    "_" + Number(lat).toFixed(4) + "_" + Number(lon).toFixed(4);
  var cacheData = cache.getProperty(cacheKey);

  if (cacheData) {
    try {
      var cached = JSON.parse(cacheData);
      var ageDays = (Date.now() - cached.timestamp) / 86400000;
      if (ageDays < 7) {
        Logger.log("  Profilo climatico: da cache (" + Math.round(ageDays * 10) / 10 + "gg fa)");
        return cached.profilo;
      }
    } catch (e) {
      Logger.log("  Profilo climatico cache corrotta: " + e);
    }
  }

  var oggi = new Date();
  var fine = Utilities.formatDate(oggi, "UTC", "yyyy-MM-dd");
  var start = new Date(oggi);
  start.setDate(start.getDate() - 90);
  var inizio = Utilities.formatDate(start, "UTC", "yyyy-MM-dd");

  var url = "https://archive-api.open-meteo.com/v1/archive?latitude=" + lat + "&longitude=" + lon +
    "&start_date=" + inizio + "&end_date=" + fine +
    "&daily=temperature_2m_mean,relative_humidity_2m_mean&timezone=Europe/Rome";

  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    var daily = JSON.parse(resp.getContentText()).daily || {};
    var tArr = validNumbersV52_(daily.temperature_2m_mean || []);
    var rhArr = validNumbersV52_(daily.relative_humidity_2m_mean || []);

    if (!tArr.length || !rhArr.length) return null;

    var tMedia = averageV52_(tArr);
    var rhMedia = averageV52_(rhArr);
    var giorniRH90 = rhArr.filter(function(rh) { return rh >= 90; }).length;
    var pctRH90 = Math.round(giorniRH90 / rhArr.length * 100);

    var profilo = {
      tMedia: Math.round(tMedia * 10) / 10,
      rhMedia: Math.round(rhMedia * 10) / 10,
      pctRH90: pctRH90,
      giorni: Math.min(tArr.length, rhArr.length)
    };

    cache.setProperty(cacheKey, JSON.stringify({ timestamp: Date.now(), profilo: profilo }));
    return profilo;
  } catch (e) {
    Logger.log("  Errore profilo climatico: " + e);
    return null;
  }
}

function validNumbersV52_(arr) {
  return (arr || []).map(function(v) { return Number(v); }).filter(function(v) { return isFinite(v); });
}

function averageV52_(arr) {
  if (!arr.length) return null;
  return arr.reduce(function(a, b) { return a + b; }, 0) / arr.length;
}

// ================================================================
// Esempio integrazione in eseguiAlertGiornaliero
// ================================================================

function buildCampoMeteoRequestV52_(row, headers) {
  var nomeCampo = row[0];
  var lat = parseFloat(row[1]);
  var lon = parseFloat(row[2]);
  return {
    campoId: getCampoIdFromRowV52_(row, headers || [], nomeCampo),
    nomeCampo: nomeCampo,
    lat: lat,
    lon: lon
  };
}

function fetchMeteoForCampoV52_(row, headers) {
  var req = buildCampoMeteoRequestV52_(row, headers);
  var meteo = fetchMeteoV52(req);
  Logger.log("  " + getMeteoQualityLabelV52(meteo));
  return meteo;
}
