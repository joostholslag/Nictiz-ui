# Better Form Renderer on EHRbase — proof of concept

Work in progress. Embeds `@better/form-renderer` (offline mode, 3.15+) in a
separate route of this app and routes its resource requests through the BFF to
EHRbase instead of a Better CDR.

- `form/` — the form export from Better Studio ("test form vitals" 0.0.1 on the
  "Vital Signs Lite" template) and that template's OPT.
- `bootstrap.sh` — against the local compose stack: uploads the OPT into
  EHRbase and creates one demo EHR (idempotent). On Scaleway the deployed UI
  does the same two steps (Settings → upload the OPT, Patients → new patient
  creates its EHR; copy the EHR id from the Compositions view).

The full write-up (how to run, request types handled, format and path
differences, what blocks going beyond a PoC) lands here when the PoC works.
