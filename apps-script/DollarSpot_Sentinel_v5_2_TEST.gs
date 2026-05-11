// ================================================================
// DOLLARSPOT SENTINEL v5.2 TEST - Google Apps Script
// Hardening layer for safe superintendent data ingestion.
//
// Scopo:
// - Non sostituire la v5.1 in produzione.
// - Creare una Web App parallela di test.
// - Ricevere dati dal frontend solo con tokenCampo valido.
// - Ricavare il campo dal token, non dal payload client.
// - Validare i payload prima di scrivere su Google Sheets.
// - Scrivere Audit/Errori per diagnosi e rollout sicuro.
//
// Nota:
// Integrare questo file con il modello rischio completo v5.1/v5.2
// quando i sorgenti completi saranno versionati nel repository.
// ================================================================

var CONFIG = {
  NOME_FOGLIO_CAMPI: "Campi",
  NOME_FOGLIO_REGISTRO: "Registro",
  NOME_FOGLIO_AUDIT: "Audit",
  NOME_FOGLIO_ERRORI: "Errori",
  TIMEZONE: "Europe/Rome",
  MODALITA_TEST: true,
};

var ALLOWED_TYPES = {
  azoto: true,
  ferro: true,
  fungo: true,
  rullatura: true,
  annotazione: true,
  feltro: true,
  domande: true,
  config_completa: true,
};

var ALLOWED_FUNGO = {
  rhapsody: true,
  civitas: true,
  trichoderma: true,
  vertenzo: true,
  fungicida_7: true,
  fungicida_14: true,
  fungicida_21: true,
  altro: true,
};

var ALLOWED_DOMANDE = {
  inoculo: { assente: true, presente: true, attivo: true },
  composizione: { agrostis: true, misto: true, poa: true },
  irrigazione: { alba: true, notte: true, sera: true },
  aria: { aperta: true, normale: true, chiusa: true },
};

var CAMPI_SECURITY_HEADERS = [
  "campoId",
  "tokenCampo",
  "attivo",
  "ultimaRotazioneToken"
];

// ================================================================
// WEB APP
// ================================================================

function doPost(e) {
  var requestId = Utilities.getUuid();
  try {
    var request = parseRequest_(e);
    var tipo = normalizeText_(request.tipo);

    if (!ALLOWED_TYPES[tipo]) {
      throw userError_("INVALID_TYPE", "Tipo payload non ammesso: " + tipo);
    }

    var tokenCampo = String(request.tokenCampo || "").trim();
    if (!tokenCampo) {
      throw userError_("MISSING_TOKEN", "tokenCampo obbligatorio");
    }

    var campoCtx = getCampoByToken_(tokenCampo);
    if (!campoCtx) {
      throw userError_("INVALID_TOKEN", "tokenCampo non valido o campo non attivo");
    }

    var payload = request.data || {};
    validatePayload_(tipo, payload);

    // Il campo autorevole arriva dal token, non dal browser.
    payload.campo = campoCtx.nomeCampo;
    payload.campoId = campoCtx.campoId;
    payload.tipo = tipo;

    if (tipo === "azoto" || tipo === "ferro" || tipo === "fungo" ||
        tipo === "rullatura" || tipo === "annotazione") {
      salvaRegistro_(payload, campoCtx, requestId);
    } else if (tipo === "feltro") {
      aggiornaCampiFeltro_(payload, campoCtx);
    } else if (tipo === "domande") {
      aggiornaCampoDomande_(payload, campoCtx);
    } else if (tipo === "config_completa") {
      aggiornaCampoDomande_(payload, campoCtx);
      aggiornaCampoCoordinate_(payload, campoCtx);
    }

    appendAudit_(campoCtx, tipo, "ok", "Salvataggio completato", payload, requestId);

    return jsonResponse_({
      status: "ok",
      requestId: requestId,
      tipo: tipo,
      campoId: campoCtx.campoId,
      campo: campoCtx.nomeCampo,
      savedAt: new Date().toISOString()
    });

  } catch (err) {
    var code = err.code || "SERVER_ERROR";
    var msg = err.userMessage || err.message || String(err);
    appendError_("error", "doPost", "", code + ": " + msg, safeStringify_(err));
    appendAudit_(null, "unknown", "error", code + ": " + msg, {}, requestId);
    return jsonResponse_({
      status: "error",
      requestId: requestId,
      code: code,
      msg: msg
    });
  }
}

function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = normalizeText_(params.action || "health");

    if (action === "health") {
      return jsonResponse_({
        status: "ok",
        service: "DollarSpot Sentinel v5.2 TEST",
        mode: CONFIG.MODALITA_TEST ? "test" : "production",
        timestamp: new Date().toISOString()
      });
    }

    if (action === "confirm_event") {
      return renderFeedbackPage_(params);
    }

    if (action === "post_feedback") {
      return handleFeedbackPost_(params);
    }

    return jsonResponse_({
      status: "error",
      code: "INVALID_ACTION",
      msg: "Azione non ammessa"
    });
  } catch (err) {
    appendError_("error", "doGet", "", err.message || String(err), safeStringify_(err));
    return jsonResponse_({
      status: "error",
      code: err.code || "SERVER_ERROR",
      msg: err.userMessage || err.message || String(err)
    });
  }
}

// ================================================================
// SETUP MANUALE AMBIENTE TEST
// ================================================================

function setupCampiSecurityColumns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getRequiredSheet_(ss, CONFIG.NOME_FOGLIO_CAMPI);
  var headerInfo = getHeaderInfo_(sheet);

  CAMPI_SECURITY_HEADERS.forEach(function(header) {
    if (headerInfo.indexByName[header] === undefined) {
      var col = sheet.getLastColumn() + 1;
      sheet.getRange(1, col).setValue(header);
      headerInfo = getHeaderInfo_(sheet);
    }
  });

  var rows = sheet.getDataRange().getValues();
  var idx = getCampiIndexes_(sheet);
  for (var i = 1; i < rows.length; i++) {
    var rowNumber = i + 1;
    var nomeCampo = rows[i][0];
    if (!nomeCampo) continue;

    if (!rows[i][idx.campoId]) {
      sheet.getRange(rowNumber, idx.campoId + 1).setValue(makeCampoId_(nomeCampo));
    }
    if (!rows[i][idx.tokenCampo]) {
      sheet.getRange(rowNumber, idx.tokenCampo + 1).setValue(Utilities.getUuid());
      sheet.getRange(rowNumber, idx.ultimaRotazioneToken + 1).setValue(new Date());
    }
    if (rows[i][idx.attivo] === "" || rows[i][idx.attivo] === null || rows[i][idx.attivo] === undefined) {
      sheet.getRange(rowNumber, idx.attivo + 1).setValue(true);
    }
  }
}

// ================================================================
// VALIDAZIONE
// ================================================================

function validatePayload_(tipo, payload) {
  if (!payload || typeof payload !== "object") {
    throw userError_("INVALID_PAYLOAD", "Payload mancante o non valido");
  }

  if (tipo === "azoto") {
    requireDateNotFuture_(payload.data, "data applicazione");
    requirePositiveNumber_(payload.kg, "kg");
    var npkPct = payload.npkPct !== undefined ? payload.npkPct : parseNpkPct_(payload.npk);
    requireRange_(npkPct, 0, 100, "npkPct");
    if (!payload.rilascio) payload.rilascio = "medio";
    if (!["rapido", "medio", "lento"].includes(normalizeText_(payload.rilascio))) {
      throw userError_("INVALID_RELEASE", "Tipo rilascio non valido");
    }
    payload.npkPct = Number(npkPct);
    return;
  }

  if (tipo === "ferro") {
    requireDateNotFuture_(payload.data, "data applicazione");
    requirePositiveNumber_(payload.kg, "kg");
    return;
  }

  if (tipo === "fungo") {
    requireDateNotFuture_(payload.data, "data applicazione");
    var prodotto = normalizeText_(payload.prodotto || "altro");
    if (!ALLOWED_FUNGO[prodotto]) {
      throw userError_("INVALID_PRODUCT", "Prodotto fungicida non ammesso");
    }
    payload.prodotto = prodotto;
    return;
  }

  if (tipo === "rullatura") {
    requireDateNotFuture_(payload.data, "data rullatura");
    return;
  }

  if (tipo === "annotazione") {
    requireDateNotFuture_(payload.data || todayIso_(), "data annotazione");
    if (!String(payload.testo || "").trim()) {
      throw userError_("INVALID_NOTE", "Annotazione vuota");
    }
    return;
  }

  if (tipo === "feltro") {
    if (!payload.zona) {
      throw userError_("INVALID_ZONE", "Zona feltro obbligatoria");
    }
    requireRange_(payload.mm, 0, 40, "mm feltro");
    return;
  }

  if (tipo === "domande" || tipo === "config_completa") {
    validateOptionalEnum_(payload.inoculo, ALLOWED_DOMANDE.inoculo, "inoculo");
    validateOptionalEnum_(payload.composizione, ALLOWED_DOMANDE.composizione, "composizione");
    validateOptionalEnum_(payload.irrigazione, ALLOWED_DOMANDE.irrigazione, "irrigazione");
    validateOptionalEnum_(payload.aria, ALLOWED_DOMANDE.aria, "aria");
    if (tipo === "config_completa") {
      if (payload.lat !== undefined) requireRange_(payload.lat, -90, 90, "lat");
      if (payload.lon !== undefined) requireRange_(payload.lon, -180, 180, "lon");
    }
    return;
  }
}

function requireDateNotFuture_(value, label) {
  if (!value) {
    throw userError_("INVALID_DATE", label + " obbligatoria");
  }
  var date = parseDateOnly_(value);
  if (!date) {
    throw userError_("INVALID_DATE", label + " non valida");
  }
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date.getTime() > today.getTime()) {
    throw userError_("FUTURE_DATE", label + " non puo essere futura");
  }
}

function requirePositiveNumber_(value, label) {
  var n = Number(value);
  if (!isFinite(n) || n <= 0) {
    throw userError_("INVALID_NUMBER", label + " deve essere un numero positivo");
  }
}

function requireRange_(value, min, max, label) {
  var n = Number(value);
  if (!isFinite(n) || n < min || n > max) {
    throw userError_("INVALID_RANGE", label + " deve essere tra " + min + " e " + max);
  }
}

function validateOptionalEnum_(value, allowed, label) {
  if (value === undefined || value === null || value === "") return;
  if (!allowed[normalizeText_(value)]) {
    throw userError_("INVALID_ENUM", label + " non valido");
  }
}

// ================================================================
// SALVATAGGI
// ================================================================

function salvaRegistro_(data, campoCtx, requestId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet_(ss, CONFIG.NOME_FOGLIO_REGISTRO, [
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
  ]);

  var tipo = data.tipo;
  var prodotto = "";
  var pct = "";
  var kg = "";
  var rilascio = "";
  var note = data.note || data.testo || "";
  var nPuri = "";

  if (tipo === "azoto") {
    prodotto = data.npk || "";
    pct = data.npkPct || "";
    kg = Number(data.kg);
    rilascio = normalizeText_(data.rilascio || "medio");
    nPuri = Math.round(kg * (Number(pct) / 100) * 100) / 100;
  } else if (tipo === "ferro") {
    prodotto = data.prodotto || data.tipoProdotto || "ferro";
    kg = Number(data.kg);
  } else if (tipo === "fungo") {
    prodotto = data.prodotto || "altro";
  } else if (tipo === "rullatura") {
    prodotto = "rullatura";
  } else if (tipo === "annotazione") {
    prodotto = "annotazione";
  }

  sheet.appendRow([
    nowIt_(),
    campoCtx.nomeCampo,
    tipo,
    data.data || todayIso_(),
    prodotto,
    pct,
    kg,
    rilascio,
    note,
    nPuri,
    nowIt_(),
    campoCtx.campoId,
    requestId
  ]);
}

function aggiornaCampoCoordinate_(data, campoCtx) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getRequiredSheet_(ss, CONFIG.NOME_FOGLIO_CAMPI);
  var rowNumber = campoCtx.rowNumber;
  if (data.lat !== undefined) sheet.getRange(rowNumber, 2).setValue(Number(data.lat));
  if (data.lon !== undefined) sheet.getRange(rowNumber, 3).setValue(Number(data.lon));
  if (data.profilo !== undefined) sheet.getRange(rowNumber, 5).setValue(Number(data.profilo));
}

function aggiornaCampiFeltro_(data, campoCtx) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getRequiredSheet_(ss, CONFIG.NOME_FOGLIO_CAMPI);
  var zonaColMap = {
    z_1_9: 6,
    z_1_18: 6,
    z_10_18: 7,
    z_19_27: 8,
    z_28_36: 9,
    z_pratica: 10,
    z_putting: 11
  };
  var col = zonaColMap[String(data.zona || "")];
  if (!col) {
    throw userError_("INVALID_ZONE", "Zona feltro non mappata: " + data.zona);
  }
  sheet.getRange(campoCtx.rowNumber, col).setValue(Number(data.mm));
  sheet.getRange(campoCtx.rowNumber, 12).setValue(new Date());
}

function aggiornaCampoDomande_(data, campoCtx) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getRequiredSheet_(ss, CONFIG.NOME_FOGLIO_CAMPI);
  var rowNumber = campoCtx.rowNumber;
  if (data.inoculo) sheet.getRange(rowNumber, 13).setValue(normalizeText_(data.inoculo));
  if (data.composizione) sheet.getRange(rowNumber, 14).setValue(normalizeText_(data.composizione));
  if (data.irrigazione) sheet.getRange(rowNumber, 16).setValue(normalizeText_(data.irrigazione));
  if (data.aria) sheet.getRange(rowNumber, 17).setValue(normalizeText_(data.aria));
}

// ================================================================
// TOKEN CAMPO
// ================================================================

function getCampoByToken_(tokenCampo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getRequiredSheet_(ss, CONFIG.NOME_FOGLIO_CAMPI);
  var indexes = getCampiIndexes_(sheet);
  var rows = sheet.getDataRange().getValues();

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var rowToken = String(row[indexes.tokenCampo] || "").trim();
    if (rowToken !== tokenCampo) continue;

    var attivo = row[indexes.attivo];
    if (attivo === false || String(attivo).toLowerCase() === "false" || String(attivo).toLowerCase() === "no") {
      return null;
    }

    return {
      rowNumber: i + 1,
      nomeCampo: row[0],
      emailSuper: row[3],
      campoId: row[indexes.campoId] || makeCampoId_(row[0])
    };
  }
  return null;
}

function getCampiIndexes_(sheet) {
  var info = getHeaderInfo_(sheet);
  CAMPI_SECURITY_HEADERS.forEach(function(header) {
    if (info.indexByName[header] === undefined) {
      throw userError_("MISSING_SECURITY_COLUMNS", "Eseguire setupCampiSecurityColumns(): manca " + header);
    }
  });
  return {
    campoId: info.indexByName.campoId,
    tokenCampo: info.indexByName.tokenCampo,
    attivo: info.indexByName.attivo,
    ultimaRotazioneToken: info.indexByName.ultimaRotazioneToken
  };
}

function makeCampoId_(nomeCampo) {
  return normalizeText_(nomeCampo)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 60);
}

// ================================================================
// AUDIT / ERRORI
// ================================================================

function appendAudit_(campoCtx, tipo, esito, messaggio, payload, requestId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getOrCreateSheet_(ss, CONFIG.NOME_FOGLIO_AUDIT, [
      "Timestamp",
      "CampoId",
      "Campo",
      "Tipo",
      "Esito",
      "Messaggio",
      "PayloadHash",
      "RequestId"
    ]);
    sheet.appendRow([
      nowIt_(),
      campoCtx ? campoCtx.campoId : "",
      campoCtx ? campoCtx.nomeCampo : "",
      tipo || "",
      esito || "",
      messaggio || "",
      payloadHash_(payload || {}),
      requestId || ""
    ]);
  } catch (e) {
    // Avoid recursive failures.
    Logger.log("appendAudit_ error: " + e);
  }
}

function appendError_(gravita, funzione, campo, errore, dettaglio) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getOrCreateSheet_(ss, CONFIG.NOME_FOGLIO_ERRORI, [
      "Timestamp",
      "Gravita",
      "Funzione",
      "Campo",
      "Errore",
      "Dettaglio"
    ]);
    sheet.appendRow([
      nowIt_(),
      gravita || "error",
      funzione || "",
      campo || "",
      errore || "",
      dettaglio || ""
    ]);
  } catch (e) {
    Logger.log("appendError_ error: " + e);
  }
}

// ================================================================
// FEEDBACK EMAIL - PAGINA DI CONFERMA
// ================================================================

function renderFeedbackPage_(params) {
  var tokenCampo = String(params.tokenCampo || "").trim();
  var campoCtx = tokenCampo ? getCampoByToken_(tokenCampo) : null;
  if (!campoCtx) {
    return HtmlService.createHtmlOutput("<h3>Link non valido o scaduto</h3>");
  }

  var base = ScriptApp.getService().getUrl();
  var buttons = [
    { label: "Macchie viste", evento: "macchie_viste" },
    { label: "Nessuna macchia", evento: "nessuna_macchia" },
    { label: "Trattamento fatto", evento: "trattato" },
    { label: "Situazione dubbia", evento: "situazione_dubbia" }
  ].map(function(btn) {
    var payload = encodeURIComponent(JSON.stringify({
      tokenCampo: tokenCampo,
      tipo: "annotazione",
      data: {
        data: todayIso_(),
        testo: "Feedback email: " + btn.evento
      }
    }));
    return '<a style="display:block;margin:10px 0;padding:12px 16px;background:#2d6a4f;color:white;text-decoration:none;border-radius:8px" href="' +
      base + '?action=post_feedback&payload=' + payload + '">' + escapeHtml_(btn.label) + '</a>';
  }).join("");

  var html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>DollarSpot Sentinel - Conferma</title></head>' +
    '<body style="font-family:Arial,sans-serif;background:#f2efe6;padding:24px">' +
    '<div style="max-width:420px;margin:auto;background:white;padding:24px;border-radius:16px">' +
    '<h2>Conferma osservazione</h2>' +
    '<p><strong>Campo:</strong> ' + escapeHtml_(campoCtx.nomeCampo) + '</p>' +
    '<p>Seleziona cosa hai osservato. La registrazione avviene solo dopo questa conferma.</p>' +
    buttons +
    '</div></body></html>';
  return HtmlService.createHtmlOutput(html);
}

function handleFeedbackPost_(params) {
  var requestId = Utilities.getUuid();
  try {
    var raw = String(params.payload || "");
    if (!raw) {
      throw userError_("INVALID_PAYLOAD", "Payload feedback mancante");
    }

    var request = JSON.parse(decodeURIComponent(raw));
    var tokenCampo = String(request.tokenCampo || "").trim();
    var campoCtx = getCampoByToken_(tokenCampo);
    if (!campoCtx) {
      throw userError_("INVALID_TOKEN", "Token campo non valido");
    }

    var tipo = normalizeText_(request.tipo || "annotazione");
    var payload = request.data || {};
    validatePayload_(tipo, payload);
    payload.campo = campoCtx.nomeCampo;
    payload.campoId = campoCtx.campoId;
    payload.tipo = tipo;

    salvaRegistro_(payload, campoCtx, requestId);
    appendAudit_(campoCtx, tipo, "ok", "Feedback email confermato", payload, requestId);

    return HtmlService.createHtmlOutput(
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
      '<body style="font-family:Arial,sans-serif;background:#f2efe6;padding:24px">' +
      '<div style="max-width:420px;margin:auto;background:white;padding:24px;border-radius:16px;text-align:center">' +
      '<h2>Segnalazione registrata</h2>' +
      '<p>Grazie, il feedback e stato salvato per <strong>' + escapeHtml_(campoCtx.nomeCampo) + '</strong>.</p>' +
      '</div></body></html>'
    );
  } catch (err) {
    appendError_("error", "handleFeedbackPost", "", err.message || String(err), safeStringify_(err));
    return HtmlService.createHtmlOutput("<h3>Errore registrazione feedback</h3><p>" + escapeHtml_(err.userMessage || err.message || String(err)) + "</p>");
  }
}

// ================================================================
// UTILITA
// ================================================================

function parseRequest_(e) {
  var raw = "{}";
  if (e && e.parameter && e.parameter.payload) {
    raw = e.parameter.payload;
  } else if (e && e.postData && e.postData.contents) {
    raw = e.postData.contents;
  }

  var parsed = JSON.parse(raw);
  // Support both {tokenCampo,tipo,data:{}} and legacy flat payloads.
  if (parsed.data && typeof parsed.data === "object") {
    return parsed;
  }

  var tipo = parsed.tipo;
  var tokenCampo = parsed.tokenCampo;
  delete parsed.tipo;
  delete parsed.tokenCampo;
  return {
    tokenCampo: tokenCampo,
    tipo: tipo,
    data: parsed
  };
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getRequiredSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw userError_("MISSING_SHEET", "Foglio mancante: " + name);
  }
  return sheet;
}

function getOrCreateSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getHeaderInfo_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var indexByName = {};
  headers.forEach(function(header, idx) {
    if (header) indexByName[normalizeHeader_(header)] = idx;
  });
  return {
    headers: headers,
    indexByName: indexByName
  };
}

function normalizeHeader_(value) {
  return String(value || "").trim();
}

function normalizeText_(value) {
  return String(value || "").toLowerCase().trim();
}

function parseDateOnly_(value) {
  var s = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    var parts = s.split("-");
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d.setHours(0, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }
  var d2 = new Date(s);
  if (isNaN(d2.getTime())) return null;
  d2.setHours(0, 0, 0, 0);
  return d2;
}

function todayIso_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd");
}

function nowIt_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss");
}

function parseNpkPct_(npk) {
  var first = String(npk || "").split(/[-\/]/)[0];
  var n = Number(first);
  return isFinite(n) ? n : NaN;
}

function payloadHash_(payload) {
  var raw = safeStringify_(payload);
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return digest.map(function(byte) {
    var v = (byte < 0 ? byte + 256 : byte).toString(16);
    return v.length === 1 ? "0" + v : v;
  }).join("");
}

function safeStringify_(value) {
  try {
    return JSON.stringify(value);
  } catch (e) {
    return String(value);
  }
}

function escapeHtml_(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function userError_(code, message) {
  var err = new Error(message);
  err.code = code;
  err.userMessage = message;
  return err;
}
