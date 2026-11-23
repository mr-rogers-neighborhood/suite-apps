# Governance, licensing and disclosure

The [specification](superapp.md) is the contract. This page owns the decisions around it. It is
deliberately small; a real governance process can grow here without touching a normative clause.

## Spec changes

- A clause ID is stable. A change is a reviewed diff to `superapp.md`, `manifest.schema.json`, the
  ledger and the fixtures together.
- A withdrawn rule keeps its ID in the ledger with `withdrawn` and a reason. It is never reused.
- A new `MUST` needs an owner, an enforcement point and a test. If it has none, it is a proposal in
  `docs/reference/ideas.md` or §17, not a normative clause.

## Catalogue

- A catalogue is optional. The first-party catalogue, if one exists, is reviewed by the project; a
  third-party catalogue is added by the person and carries its operator key.
- Review states are `unreviewed`, `automated`, `reviewed` and `audited`. A review is bound to a
  publisher, id, version and SHA-256. A review of one version never covers another.
- The catalogue never becomes an install authority. Side-loading works without it.

## Revocation

- The publisher of the installed pack, a catalogue operator, or the person may sign an advisory.
- An advisory blocks new installs. It does not silently disable an installed pack; the person
  chooses disable or remove.
- A revocation is a signed statement with a reason and an expiry. It is not a remote kill switch.

## Licensing

- A pack declares `license` and MAY declare `source`.
- The catalogue shows both. A missing license is shown as unknown, not as permissive.
- The repository is MIT; a pack's license is its own.

## Security disclosure

- Report a vulnerability privately to the maintainers; do not open a public issue with a working
  exploit.
- Acknowledgment target: three working days. A fix or advisory is published when a fix or mitigation
  exists.
- A pack advisory follows the revocation rule. A host advisory is a release note; it is never a
  silent update.

## Who decides

The project owner decides spec changes, catalogue policy and revocations that are not publisher
signed. A review-only agent may request changes but never merges. The coordinator runs the gate and
the VM gate. A decision that changes the contract is recorded here and in
`docs/reference/decisions.md`.
