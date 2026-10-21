# Better Form Renderer on EHRbase — proof of concept

Work in progress. Embeds `@better/form-renderer` (offline mode, 3.15+) in a
separate route of this app and routes its resource requests through the BFF to
EHRbase instead of a Better CDR.

- `form/` — the form export from Better Studio ("test form vitals" 0.0.1 on the
  "Vital Signs Lite" template) and that template's OPT.
- `bootstrap.sh` — uploads the OPT into EHRbase and creates one demo EHR
  (idempotent). On Scaleway it runs through
  `.github/workflows/better-poc-bootstrap.yml`.

The full write-up (how to run, request types handled, format and path
differences, what blocks going beyond a PoC) lands here when the PoC works.
