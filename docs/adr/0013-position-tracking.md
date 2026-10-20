# ADR-0013 — Resume position and automatic watched, through per-player local interfaces

**Status:** accepted · 2026-10-20 · amends ADR-0011 ("no resume, no automatic watched")

**Context.** ADR-0011 left "watched" as a manual mark because external players do not report progress uniformly. The person asked for the next episode to follow what they actually watched, and for a stopped video to resume where it stopped, but only if they watched more than five minutes.

**Decision.**
- **Which players.** VLC, mpv and MPC-HC / MPC-BE, the ones that can be watched from outside. PotPlayer, programs the person added and the system default cannot report a position: they stay as before (a start is remembered, "watched" is marked by hand). The Settings → Playback page says which players are tracked.
- **How.** The desktop shell adds a switch to the command line that makes the player listen on this PC only, then watches it; the backend never talks to a player.
  - mpv: `--input-ipc-server` on a named pipe with a random name; position arrives as `time-pos` property changes; the pipe closing ends the viewing.
  - VLC: `--extraintf=http` on `127.0.0.1`, a free random port and a random password (never logged), polled every 5 s. `--no-one-instance` makes each start its own VLC, otherwise a running VLC would take the file and never open our interface.
  - MPC-HC / MPC-BE: `/webport <port>`, polled on `/variables.html` (times in milliseconds).
  - Resuming: `--start=<s>` (mpv), `--start-time=<s>` (VLC), `/start <ms>` (MPC).
  - Everything is still an argument array with `shell: false`. The shell only forwards what it read (`PUT /playback/files/:id/progress`); it never takes a path or a command from the UI.
- **Rules live on the backend** (`PlaybackRepo.recordProgress`): under 5:00 nothing is kept (and an earlier saved position is not overwritten); from 90 % of the runtime the file is marked watched (`source = 'player'`) and the position is cleared, which is what moves "next episode" and Continue watching along; in between, the position is saved. A file that is already watched is left alone unless the viewing reaches the end again. Marking a file watched or unwatched by hand clears the saved position.
- **Never the wrong file.** The tracker stops as soon as the player reports another file name, so positions are not filed under the wrong title when the person opens something else in the same player.
- **Failure is quiet.** If the interface never comes up (player settings, an old version, a port that is taken) or the backend is unreachable, nothing is tracked and nothing is shown as an error; the player has already started.

**Consequences.** Resume and the automatic "watched" work for the three main players and degrade to the old manual behaviour for the rest. Closing Theama while a player is open loses at most the last ~15 seconds of position. "Watched for five minutes" is measured as playback position, so skipping ahead counts. VLC opens a separate window per start when it is tracked. The switches above are the players' documented ones but depend on each player's version; a player that ignores one simply is not tracked.
