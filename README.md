# SideScreen

Sidescreen lets you review Claude Code responses in a browser. You can select any passage, ask a separate read-only Codex agent about it, and send only the conclusions you choose back to your Claude Code session.

Your review stays separate from the main conversation. Claude Code does not see your side questions or their answers unless you add a conclusion to **Carry back**.

## What you can do

- Read completed Claude Code responses in a clean browser view.
- Select text and ask questions about the response, project files, conversation history, or project documentation.
- Continue a question with follow-ups or branch into a separate line of inquiry.
- Save a short conclusion for Claude Code to receive with your next prompt.
- Browse responses by project and session.

## Requirements

- Node.js 22 or newer
- Claude Code
- The Codex CLI installed, signed in, and available as `codex` on your `PATH`

## Install and start

Install sidescreen globally:

```sh
npm install -g sidescreen
```

Set it up in a project:

```sh
cd your-project
sidescreen init
```

Restart Claude Code if it was already running. Claude Code loads hooks when a session starts, so an existing session will not notice the new setup until it is restarted.

Start sidescreen:

```sh
sidescreen serve
```

Keep that terminal open, then open the project URL printed by the command. The default server address is `http://127.0.0.1:7486/`.

Finish a response in Claude Code. It will appear in sidescreen automatically.

> Install sidescreen globally before running `sidescreen init`. Do not use `npx sidescreen init`: the saved hook can stop working when the temporary npx cache is removed.

## Review a response

1. Select text in the response.
2. Type a question in the box that appears.
3. Press Enter or choose **Ask**.
4. Read the answer in the right-hand column.

The answering agent runs with read-only access. It can inspect the project, the Claude Code transcript, and project documentation, but it cannot change files.

Each answer shows where its information came from:

- `code` — the current project files
- `transcript` — the Claude Code conversation
- `spec` — project documentation or specifications
- `none` — no documented answer was found

“No documented intent found” is a valid answer. It means the agent checked the available sources instead of guessing.

You can ask follow-up questions in the same thread. You can also branch from an answer when you want to explore a different question without changing the original thread.

## Carry a conclusion back to Claude Code

Sidescreen never sends the full review to your Claude Code session. You decide what crosses back:

1. Write a concise conclusion in **Carry back**, or use an answer to start a draft.
2. Edit the draft so it states the decision or useful fact in your own words.
3. Choose **Add to carry-back**.
4. Send your next prompt in the same Claude Code session.

The pending conclusions are added as context to that next prompt. After they are sent, they disappear from the pending list. Side questions, sub-agent answers, and highlighted text are not included.

## Navigate projects and sessions

The home page lists every project that has sent a response to sidescreen. Inside a project, the sidebar groups responses by Claude Code session.

- **Latest** follows the newest response from any session in the project.
- **Follow** follows new responses from one session.
- Selecting a specific response keeps that response open when newer ones arrive.

If you are typing a question or editing a conclusion, sidescreen will not replace the response in front of you. It will show a notice linking to the new response instead.

To remove a stored response, hover over it in the sidebar and select the × twice to confirm. Its review threads are removed too. The original response remains in Claude Code's transcript.

## Set up more projects

Run `sidescreen init` once in each project you want to use. It:

- registers the required hooks in `.claude/settings.json`
- installs the sidescreen guidance file in `.claude/skills/sidescreen/`
- preserves settings and skills that do not belong to sidescreen

To register the hooks in your user-level Claude Code settings instead, run:

```sh
sidescreen setup hooks
```

This updates `~/.claude/settings.json`, so responses can be collected from every project. Project-level setup is still useful because it installs the guidance file for Claude Code.

If a Node version manager moves your global packages after you switch Node versions, reinstall sidescreen and run `sidescreen init` again. This updates the hook to the new installation path.

## Commands

| Command | Purpose |
| --- | --- |
| `sidescreen init` | Set up hooks and the guidance file in the current project. |
| `sidescreen init --dry-run` | Show what setup would change without editing files. |
| `sidescreen serve` | Start the local browser app on port 7486. |
| `sidescreen serve --port <number>` | Start the browser app on a different port. |
| `sidescreen setup hooks` | Register hooks in your user-level Claude Code settings. |
| `sidescreen setup hooks --project` | Register hooks in the current project's settings only. |
| `sidescreen setup hooks --dry-run` | Check hook setup without editing files. |

The hooks use `sidescreen ingest` and `sidescreen carry-back --emit` automatically. You do not need to run those commands yourself.

## Configuration

Configuration is optional and uses environment variables.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SIDESCREEN_STATE_DIR` | `$XDG_STATE_HOME/sidescreen`, or `~/.local/state/sidescreen` | Where sidescreen stores responses and reviews. |
| `SIDESCREEN_CODEX_BIN` | `codex` | Codex CLI command to use for side questions. |
| `SIDESCREEN_MODEL` | Codex CLI default | Model used for side questions. |
| `SIDESCREEN_DISPATCH_TIMEOUT_MS` | `300000` | Maximum time in milliseconds for one answer. |
| `SIDESCREEN_CONVENTIONS_FILES` | `~/.claude/CLAUDE.md`, `./CLAUDE.md`, `./AGENTS.md` | Instruction files passed to the read-only agent. Use your operating system's path separator between files. |

## Privacy and safety

- The browser server listens only on your computer's loopback address.
- Responses, review threads, and pending conclusions are stored locally in the state directory.
- Side questions run through the Codex CLI under its read-only sandbox.
- Claude Code receives only the conclusions you explicitly add to **Carry back**.
- Sidescreen saves the final message from each completed Claude Code response, not intermediate output produced while Claude is working.

The Codex CLI still uses its configured model service to answer questions. Review the Codex CLI's own configuration and data policies if your project contains sensitive information.

## Troubleshooting

### A response does not appear

Run `sidescreen init` in the project and restart Claude Code. You can check the project hook without changing anything:

```sh
sidescreen setup hooks --project --dry-run
```

Both hooks should report `unchanged` when setup is current.

### A side question fails

Confirm that `codex` works in your terminal and is signed in. If the command has another name or location, set `SIDESCREEN_CODEX_BIN` before starting the server.

For long-running questions, increase `SIDESCREEN_DISPATCH_TIMEOUT_MS` from its five-minute default.

### Port 7486 is already in use

Another sidescreen server may already be running. Open `http://127.0.0.1:7486/`, or start this server on another port:

```sh
sidescreen serve --port 7487
```

## Development

```sh
git clone https://github.com/johardi/sidescreen.git
cd sidescreen
npm install
npm link
npm run check
```

`npm link` is optional. It makes the checkout's `sidescreen` command available on your `PATH`.

Two additional test modes are available:

```sh
SIDESCREEN_E2E_CLAUDE=1 npm test
UPDATE_SNAPSHOTS=1 npm test
```

The first runs the real Claude Code hook test and may use API credits. The second updates the Markdown rendering snapshot.

Planning documents are in `openspec/`.

## License

MIT
