# ADR-0013 — Resume position and automatic watched, through per-player local interfaces

**Status:** accepted · 2026-10-20 · amends ADR-0011 ("no resume, no automatic watched")

**Context.** ADR-0011 left "watched" as a manual mark because external players do not report progress uniformly. The person asked for the next episode to follow what they actually watched, and for a stopped video to resume where it stopped, but only if they watched more than five minutes.

**Decision.**
- **Which players.** VLC, mpv and MPC-HC / MPC-BE, the ones that can be watched from outside. PotPlayer, programs the person added and the system default cannot report a position: they stay as before (a start is remembered, "watched" is marked by hand). The Settings → Playback page says which players are tracked.
- **How.** The desktop shell adds a switch to the command line that makes the player listen on this PC only, then watches it; the backend never talks to a player.
  - mpv: `--input-ipc-server` on a named pipe with a random name; position arrives as `time-pos` property changes; the pipe closing ends the viewing.
  - VLC: `--extraintf=http` on `127.0.0.1`, a free random port and a random password (never logged), polled every 5 s. `--no-one-instance` makes each start its own VLC, otherwise a running VLC would take the file and never open our interface.
  - MPC-HC / MPC-BE: `/new /webport <port>`, polled on `/variables.html` (times in milliseconds). Each launch has its own instance and tracking port. Series episodes also use `/play /close` to close the player at the end, including the final episode. Process exit ends tracking promptly; startup and near-end polling are faster so short episodes are still observed.
  - Resuming: `--start=<s>` (mpv), `--start-time=<s>` (VLC), `/start <ms>` (MPC).
  - Everything is still an argument array with `shell: false`. The shell only forwards what it read (`PUT /playback/files/:id/progress`); it never takes a path or a command from the UI.
- **Rules live on the backend** (`PlaybackRepo.recordProgress`): from 90 % of the runtime the file is marked watched (`source = 'player'`) and the position is cleared, including episodes shorter than five minutes. Unfinished playback under 5:00 is ignored (and an earlier saved position is not overwritten); otherwise the position is saved. Completion checks retain subsecond player precision; stored resume positions are whole seconds. A file that is already watched is left alone unless this viewing reaches the end again. Marking watched or unwatched by hand clears the saved position.
- **Next episode.** After saving a final report at or beyond 90 %, the shell brings Theama forward and shows the configured countdown when automatic next episode is enabled and a playable local episode follows. Cancel or Escape stops the countdown; Play now starts immediately. Manually closing at or beyond 90 % also qualifies. The final episode has no prompt.
- **Never the wrong file.** Empty startup filenames are ignored. The tracker compares MPC's full path where available and otherwise the filename, ending tracking when another file is loaded.
- **Failure is quiet.** Reports are serialized and final reports follow all pending saves. A failed final submission is retried twice, after one and three seconds; the next episode is offered only after a successful final response. If tracking or reporting remains unavailable, playback is unaffected.

**Consequences.** Resume and the automatic "watched" work for the three main players and degrade to the old manual behaviour for the rest. Closing Theama while a player is open loses at most the last ~15 seconds of position. "Watched for five minutes" is measured as playback position, so skipping ahead counts. VLC opens a separate window per start when it is tracked. The switches above are the players' documented ones but depend on each player's version; a player that ignores one simply is not tracked.
