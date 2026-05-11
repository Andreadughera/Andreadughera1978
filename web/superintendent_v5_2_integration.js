// ================================================================
// DOLLARSPOT SENTINEL v5.2 - Frontend integration helpers
//
// Questo file non sostituisce la pagina HTML v9 completa.
// Serve come patch guidata da integrare nella pagina superintendent
// per parlare con il backend v5.2 TEST in modo piu sicuro.
// ================================================================

// Da configurare con l'URL della Web App v5.2 TEST, non produzione.
const WEBAPP_URL_V52 = 'INSERIRE_URL_WEB_APP_V5_2_TEST';

function getUrlParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function getTokenCampoFromUrl() {
  const token = getUrlParam('tokenCampo');
  if (!token) {
    throw new Error('Link non valido: tokenCampo mancante');
  }
  return token;
}

function isFutureDate(value) {
  if (!value) return false;
  const input = new Date(value + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return input.getTime() > today.getTime();
}

function requireNotFutureDate(value, label) {
  if (!value) {
    throw new Error(label + ' obbligatoria');
  }
  if (isFutureDate(value)) {
    throw new Error(label + ' non puo essere futura');
  }
}

async function postToSheetV52(tipo, data) {
  const payload = {
    tokenCampo: getTokenCampoFromUrl(),
    tipo,
    data
  };

  const response = await fetch(WEBAPP_URL_V52, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain'
    },
    body: JSON.stringify(payload)
  });

  // Apps Script spesso risponde 200 anche su errore applicativo:
  // verificare sempre il JSON.
  const json = await response.json();
  if (!json || json.status !== 'ok') {
    throw new Error((json && json.msg) || 'Sincronizzazione non riuscita');
  }
  return json;
}

async function syncToSheetV52(data, tipo, uiIds) {
  const statusEl = uiIds && uiIds.status ? document.getElementById(uiIds.status) : null;
  const dotEl = uiIds && uiIds.dot ? document.getElementById(uiIds.dot) : null;
  const txtEl = uiIds && uiIds.text ? document.getElementById(uiIds.text) : null;

  if (statusEl) statusEl.style.display = 'flex';
  if (dotEl) dotEl.className = 'sync-dot pend';
  if (txtEl) txtEl.textContent = 'Invio...';

  try {
    const result = await postToSheetV52(tipo, data);
    if (dotEl) dotEl.className = 'sync-dot';
    if (txtEl) txtEl.textContent = 'Sincronizzato - ' + (result.campo || result.campoId || 'ok');
    setTimeout(function() {
      if (statusEl) statusEl.style.display = 'none';
    }, 3000);
    return result;
  } catch (err) {
    if (dotEl) dotEl.className = 'sync-dot err';
    if (txtEl) txtEl.textContent = 'Errore: ' + err.message;
    throw err;
  }
}

function validateRegBeforeSaveV52(tipo, entry) {
  if (tipo === 'azoto') {
    requireNotFutureDate(entry.data, 'Data applicazione');
    if (!entry.npkPct && entry.npkPct !== 0) throw new Error('Formula NPK non valida');
    if (!entry.kg || Number(entry.kg) <= 0) throw new Error('kg/ha non validi');
  }

  if (tipo === 'ferro') {
    requireNotFutureDate(entry.data, 'Data applicazione');
    if (!entry.kg || Number(entry.kg) <= 0) throw new Error('kg/ha non validi');
  }

  if (tipo === 'fungo') {
    requireNotFutureDate(entry.data, 'Data applicazione');
    if (!entry.prodotto) throw new Error('Prodotto obbligatorio');
  }

  if (tipo === 'rullatura') {
    requireNotFutureDate(entry.data, 'Data rullatura');
  }

  if (tipo === 'annotazione') {
    requireNotFutureDate(entry.data, 'Data annotazione');
    if (!entry.testo || !entry.testo.trim()) throw new Error('Nota obbligatoria');
  }
}

function lockFieldIdentityFromUrl() {
  const campo = getUrlParam('campo');
  const fieldName = document.getElementById('fieldName');
  if (fieldName && campo) {
    fieldName.value = campo;
    fieldName.readOnly = true;
    fieldName.title = 'Campo associato al token. Non modificabile.';
  }
}

// Esempio di integrazione nella pagina esistente:
//
// 1. In DOMContentLoaded aggiungere:
//    lockFieldIdentityFromUrl();
//
// 2. Sostituire syncToSheet(...) con:
//    validateRegBeforeSaveV52(tipo, entry);
//    await syncToSheetV52(entry, tipo, {
//      status: 'syncAzoto',
//      dot: 'dotAzoto',
//      text: 'txtAzoto'
//    });
//
// 3. Link superintendent:
//    superintendent_v5_2_TEST.html?campo=Green%201&tokenCampo=<TOKEN_CAMPO>
