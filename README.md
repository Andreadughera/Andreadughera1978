# TRIA Agronomia - Progetti Sentinel

Repository di lavoro per i progetti Sentinel.

## DollarSpot Sentinel

Documentazione operativa per portare DollarSpot Sentinel dalla versione attualmente in test sui campi reali a una v5.2 piu stabile e distribuibile senza disservizi.

### Documenti v5.2

- [Piano di rilascio senza disservizio](docs/dollarspot/v5.2-rollout-plan.md)
- [Specifica hardening tecnico](docs/dollarspot/v5.2-hardening-spec.md)
- [Checklist test](docs/dollarspot/v5.2-test-checklist.md)
- [MeteoCache](docs/dollarspot/v5.2-meteo-cache.md)
- [Integrazione MeteoProvider](docs/dollarspot/v5.2-meteo-provider-integration.md)
- [Setup ambiente test](docs/dollarspot/v5.2-test-environment-setup.md)
- [Validation log](docs/dollarspot/v5.2-test-validation-log.md)

### Stato repository

Nel repository e ora presente una base v5.2 di test:

- `apps-script/DollarSpot_Sentinel_v5_2_TEST.gs`
- `apps-script/Setup_v5_2.gs`
- `apps-script/MeteoCache_v5_2.gs`
- `apps-script/MeteoProvider_v5_2.gs`
- `apps-script/DollarSpot_v5_2_DropIn_Replacements.gs`
- `web/superintendent_v5_2_integration.js`

Questi file coprono il livello di sicurezza/sincronizzazione:

- token per campo;
- validazione `doPost`;
- salvataggio sicuro di registro, feltro, domande e configurazione;
- supporto `rullatura`;
- audit/errori;
- blocco date future lato frontend.
- cache meteo multi-campo basata su Google Sheets.
- provider meteo live/cache/fallback per il modello rischio.
- setup guidato dell'ambiente Google Sheets/Apps Script TEST.
- sostituzioni drop-in per le funzioni critiche del sorgente v5.1.

Non sono ancora presenti i sorgenti completi della versione oggi in uso:

- `DollarSpot_Sentinel_v5_AGGIORNATO.gs`
- pagina HTML superintendent

Per procedere con l'integrazione completa, aggiungere i file sorgente in una struttura simile:

```text
apps-script/
  Setup_v5_2.gs
  DollarSpot_Sentinel_v5_1_PRODUZIONE.gs
  DollarSpot_Sentinel_v5_2_TEST.gs
  MeteoCache_v5_2.gs
  MeteoProvider_v5_2.gs
  DollarSpot_v5_2_DropIn_Replacements.gs
web/
  superintendent_v9.html
  superintendent_v5_2_TEST.html
  superintendent_v5_2_integration.js
docs/
  dollarspot/
```

La versione oggi usata dai campi deve restare invariata finche la v5.2 non supera test interni e pilota.
