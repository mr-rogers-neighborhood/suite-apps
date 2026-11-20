# Alpha

The apps say this on first launch, and it is worth repeating: tests verify behaviour, not the
maintainers' complete understanding of the code. Export regularly and expect bugs.

What alpha does not mean is that the install path is unreliable. Install, update, rollback,
uninstall and menu entries are covered by end-to-end tests, and [Status](STATUS.md) says where
each subsystem stands.

## What is missing today

- Adding a device to a workspace is a CLI step.
- The relay runs on any machine with Node 22, but installing it is still a copy-a-file step rather than
  a signed artifact.
- Planner and Budget do not sync yet.
- Canvas is still a placeholder in Suite Go; Planner is the first real pack, and nothing else in the
  container syncs yet.
- Documents carry no upgrade guarantee between app versions. The policy is written down in Suite
  Go's ADR-0009; the per-domain fixtures it asks for are not built yet.

## Leaving alpha

1. Every subsystem is either Working — with a test that has failed at least once — or listed as
   Not built with a reason.
2. Uninstalling an app or the hub leaves no files behind and no document touched.
3. A failure says what happened in words a person can act on.
4. A release is one command that cannot skip the gate.

When all four hold, the label changes. It is about the code, not the feature list.
