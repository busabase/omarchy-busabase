# Busabase for Omarchy

**Your agents' work, kept.**

Claude Code and Codex do real work — research, lists, decisions — and it usually
evaporates when the session closes. With [Busabase](https://busabase.com) your
agents save that work into a database and knowledge base you own. This widget
puts it in your Omarchy bar:

- **Today's count, with a `+1` as it lands.** When an agent saves something, the
  number ticks up and a small `+1` floats off it. No toast, no sound — work your
  agents do on their own should be visible, not interrupting.
- **What was kept, in plain words.** Open the panel: *"Claude Code added 3 records
  to Competitors · 5m ago"*. Enter opens it in Busabase, with the full history and
  one-click revert.
- **A dot only when something waits for you.** If one of your changes is queued
  for review (a proposal-only key, or a Base that asks for review), the mark gets
  an accent dot. Otherwise there is nothing to clear.
- **Teach your agents Busabase in one switch.** Links the bundled `busabase`
  skill into Claude Code, Codex, Pi, Hermes and `~/.agents/skills` — the same
  places Omarchy links its own skill. Switch it off and the links are gone.
- **Cloud or local.** Works with Busabase Cloud, a self-hosted server, or the open
  source server on your own machine (`busabase server`, no account needed).

## Install

```bash
omarchy plugin add https://github.com/busabase/omarchy-busabase.git --enable
```

Then click the Busabase mark in the bar:

- **Sign in to Busabase** opens a terminal running `busabase-cli login`; approve
  the short code in your browser. If `busabase-cli` is not installed it runs via
  `npx`, which needs Node.js.
- **Use Busabase on this computer** appears when a local server answers on
  `localhost:15419`.

Already signed in with `busabase-cli`? There is nothing to do: the widget reads
the same `~/.busabase/.env`.

## Keys

| Key | Action |
| --- | --- |
| `j` / `k`, arrows | Move |
| `Enter` | Open the selected row |
| `r` | Refresh |
| `o` | Open Busabase |
| `Esc` | Close |

Bind it to a key with Omarchy's IPC: `omarchy-shell busabase toggle`.

## What it reads, writes and sends

Plugins run unsandboxed as your user, so here is the full list.

- **Reads** `~/.busabase/.env` (written by `busabase-cli login`). It is parsed,
  never executed. The API key goes to `curl` through a temporary mode-0600 config
  file and never appears on a command line.
- **Network:** only `GET` requests to the server in `BUSABASE_BASE_URL`
  (`/auth`, `/change-requests`, `/change-requests/counts`), every 60 seconds by
  default, plus one probe of `localhost:15419` when you are not connected.
- **Writes** `~/.busabase/.env` only when you choose *Use Busabase on this
  computer* (it sets `BUSABASE_BASE_URL`), and symlinks in your agents' skill
  folders only when you switch the skill on. It never overwrites a skill you
  installed yourself.
- **Never** runs an installer, uses `sudo`, or downloads code — except the
  `npx busabase-cli login` fallback, which only runs when you click *Sign in* and
  `busabase-cli` is missing.

Dependencies: `bash` and `curl`, both in Omarchy.

## Uninstall

Switch **Teach my agents Busabase** off first (or run
`~/.config/omarchy/plugins/busabase/bin/busabase-skills unlink`), then:

```bash
omarchy plugin remove busabase
```

Your Busabase data and `~/.busabase/.env` are untouched.

## Develop

```bash
node --test test/model.test.mjs        # pure logic
omarchy plugin validate .               # manifest and layout
omarchy-shell busabase status  # live state as JSON (never includes the key)
```

The bundled skill in `skills/busabase` is copied from
[busabase/skills](https://github.com/busabase/skills).

## License

MIT
