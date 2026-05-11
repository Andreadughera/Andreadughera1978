// ================================================================
// DOLLARSPOT SENTINEL v5.2 - Setup ambiente TEST
//
// Da usare solo nello spreadsheet/app script v5.2 TEST.
// Non lanciare sulla produzione corrente senza backup.
// ================================================================

var SETUP_V52_CONFIG = {
  NOME_FOGLIO_CAMPI: "Campi",
  NOME_FOGLIO_REGISTRO: "Registro",
  NOME_FOGLIO_AUDIT: "Audit",
  NOME_FOGLIO_ERRORI: "Errori",
  NOME_FOGLIO_METEO_CACHE: "MeteoCache",
  TIMEZONE: "Europe/Rome"
};

var SETUP_V52_SHEETS = {
  Campi: [
    "nomeCampo",
    "latitudine",
    "longitudine",
    "emailSuper",
    "profilo",
    "feltro_1_9",
    "feltro_10_18",
    "feltro_19_27",
    "feltro_28_36",
    "feltro_pratica",
    "feltro_putting",
    "data_feltro",
    "inoculo",
    "composizione",
    "",
    "irrigazione",
    "aria",
    "",
    "cultivar",
    "campoId",
    "tokenCampo",
    "attivo",
    "ultimaRotazioneToken"
  ],
  Registro: [
    "Timestamp",
    "Campo",
    "Tipo",
    "Data Appl.",
    "Prodotto/NPK",
    "% N / kg/ha",
    "kg/ha",
    "Rilascio",
    "Note",
    "N Puri kg/ha",
    "Salvato",
    "CampoId",
    "RequestId"
  ],
  Audit: [
    "Timestamp",
    "CampoId",
    "Campo",
    "Tipo",
    "Esito",
    "Messaggio",
    "PayloadHash",
    "RequestId"
  ],
  Errori: [
    "Timestamp",
    "Gravita",
    "Funzione",
    "Campo",
    "Errore",
    "Dettaglio"
  ],
  MeteoCache: [
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
  ]
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("DollarSpot v5.2 TEST")
    .addItem("1. Setup ambiente test", "setupDollarSpotV52TestEnvironment")
    .addItem("2. Valida ambiente", "validateDollarSpotV52Environment")
    .addItem("3. Aggiorna MeteoCache", "aggiornaMeteoCacheTuttiCampi")
    .addItem("4. Genera token mancanti", "setupCampiSecurityColumns")
    .addToUi();
}

function setupDollarSpotV52TestEnvironment() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureSetupSheet_(ss, SETUP_V52_CONFIG.NOME_FOGLIO_CAMPI, SETUP_V52_SHEETS.Campi);
  ensureSetupSheet_(ss, SETUP_V52_CONFIG.NOME_FOGLIO_REGISTRO, SETUP_V52_SHEETS.Registro);
  ensureSetupSheet_(ss, SETUP_V52_CONFIG.NOME_FOGLIO_AUDIT, SETUP_V52_SHEETS.Audit);
  ensureSetupSheet_(ss, SETUP_V52_CONFIG.NOME_FOGLIO_ERRORI, SETUP_V52_SHEETS.Errori);
  ensureSetupSheet_(ss, SETUP_V52_CONFIG.NOME_FOGLIO_METEO_CACHE, SETUP_V52_SHEETS.MeteoCache);

  if (typeof setupCampiSecurityColumns === "function") {
    setupCampiSecurityColumns();
  } else {
    ensureCampiSecurityColumnsV52_();
  }

  var report = validateDollarSpotV52Environment();
  SpreadsheetApp.getUi().alert("Setup v5.2 TEST completato.\n\n" + report.summary);
}

function validateDollarSpotV52Environment() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var issues = [];
  var ok = [];

  Object.keys(SETUP_V52_SHEETS).forEach(function(sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      issues.push("Manca foglio: " + sheetName);
      return;
    }
    ok.push("Foglio presente: " + sheetName);
    var required = SETUP_V52_SHEETS[sheetName].filter(function(header) { return header !== ""; });
    var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), required.length)).getValues()[0];
    required.forEach(function(header) {
      if (headers.indexOf(header) === -1) {
        issues.push("Foglio " + sheetName + ": manca header '" + header + "'");
      }
    });
  });

  var campi = ss.getSheetByName(SETUP_V52_CONFIG.NOME_FOGLIO_CAMPI);
  if (campi) {
    var data = campi.getDataRange().getValues();
    var header = data[0] || [];
    var idxNome = header.indexOf("nomeCampo");
    var idxLat = header.indexOf("latitudine");
    var idxLon = header.indexOf("longitudine");
    var idxToken = header.indexOf("tokenCampo");
    var idxAttivo = header.indexOf("attivo");

    for (var i = 1; i < data.length; i++) {
      var rowNumber = i + 1;
      var row = data[i];
      if (!row[idxNome]) continue;
      if (idxLat >= 0 && !isFinite(Number(row[idxLat]))) issues.push("Campi riga " + rowNumber + ": latitudine non valida");
      if (idxLon >= 0 && !isFinite(Number(row[idxLon]))) issues.push("Campi riga " + rowNumber + ": longitudine non valida");
      if (idxToken >= 0 && !row[idxToken]) issues.push("Campi riga " + rowNumber + ": tokenCampo mancante");
      if (idxAttivo >= 0 && row[idxAttivo] === "") issues.push("Campi riga " + rowNumber + ": attivo non valorizzato");
    }
  }

  var summary = issues.length
    ? "Problemi trovati:\n- " + issues.join("\n- ")
    : "Ambiente valido. Nessun problema bloccante trovato.";

  Logger.log(summary);
  return {
    ok: issues.length === 0,
    issues: issues,
    checks: ok,
    summary: summary
  };
}

function ensureSetupSheet_(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  var lastCol = Math.max(sheet.getLastColumn(), headers.length);
  var current = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var hasAnyHeader = current.some(function(value) { return value !== ""; });

  if (!hasAnyHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    headers.forEach(function(header) {
      if (!header) return;
      var existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
      if (existing.indexOf(header) === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      }
    });
  }

  var finalLastCol = Math.max(sheet.getLastColumn(), headers.length);
  sheet.getRange(1, 1, 1, finalLastCol)
    .setFontWeight("bold")
    .setBackground("#0a1f0a")
    .setFontColor("#b7e4c7");
  sheet.setFrozenRows(1);
}

function ensureCampiSecurityColumnsV52_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SETUP_V52_CONFIG.NOME_FOGLIO_CAMPI);
  if (!sheet) throw new Error("Foglio Campi mancante");

  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  ["campoId", "tokenCampo", "attivo", "ultimaRotazioneToken"].forEach(function(header) {
    if (headers.indexOf(header) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    }
  });

  var idxNome = headers.indexOf("nomeCampo");
  var idxCampoId = headers.indexOf("campoId");
  var idxToken = headers.indexOf("tokenCampo");
  var idxAttivo = headers.indexOf("attivo");
  var idxRotazione = headers.indexOf("ultimaRotazioneToken");
  var values = sheet.getDataRange().getValues();

  for (var i = 1; i < values.length; i++) {
    var rowNumber = i + 1;
    var nomeCampo = values[i][idxNome] || values[i][0];
    if (!nomeCampo) continue;

    if (!values[i][idxCampoId]) {
      sheet.getRange(rowNumber, idxCampoId + 1).setValue(makeSetupCampoId_(nomeCampo));
    }
    if (!values[i][idxToken]) {
      sheet.getRange(rowNumber, idxToken + 1).setValue(Utilities.getUuid());
      sheet.getRange(rowNumber, idxRotazione + 1).setValue(new Date());
    }
    if (values[i][idxAttivo] === "" || values[i][idxAttivo] === null || values[i][idxAttivo] === undefined) {
      sheet.getRange(rowNumber, idxAttivo + 1).setValue(true);
    }
  }
}

function makeSetupCampoId_(nomeCampo) {
  return String(nomeCampo || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 60);
}
