# TRIA Agronomia - Progetti Sentinel

Repository di lavoro per i progetti Sentinel.

## DollarSpot Sentinel

Documentazione operativa per portare DollarSpot Sentinel dalla versione attualmente in test sui campi reali a una v5.2 piu stabile e distribuibile senza disservizi.

### Documenti v5.2

- [Piano di rilascio senza disservizio](docs/dollarspot/v5.2-rollout-plan.md)
- [Specifica hardening tecnico](docs/dollarspot/v5.2-hardening-spec.md)
- [Checklist test](docs/dollarspot/v5.2-test-checklist.md)

### Stato repository

Al momento nel repository non sono presenti i sorgenti completi:

- `DollarSpot_Sentinel_v5_AGGIORNATO.gs`
- pagina HTML superintendent

Per procedere con modifiche implementative sicure, aggiungere i file sorgente in una struttura simile:

```text
apps-script/
  DollarSpot_Sentinel_v5_1_PRODUZIONE.gs
  DollarSpot_Sentinel_v5_2_TEST.gs
web/
  superintendent_v9.html
  superintendent_v5_2_TEST.html
docs/
  dollarspot/
```

La versione oggi usata dai campi deve restare invariata finche la v5.2 non supera test interni e pilota.
