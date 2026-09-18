# SideScreen

Sidescreen lets you review coding agent responses in a browser.
You can select any passage, ask a separate read-only sub-agent about it, and send only the conclusions you choose back to your Claude Code session.

Your review stays separate from the main conversation.
Claude Code does not see your side questions or their answers unless you add a conclusion to **Carry back**.

## What you can do

- Read completed Claude Code responses in a clean browser view.
- Select text and ask questions about the response, project files, conversation history, or project documentation.
- Choose who answers: by default the same harness and model that wrote the response, or the Codex CLI for a second opinion.
- Continue a question with follow-ups or branch into a separate line of inquiry.
- Save a short conclusion for Claude Code to receive with your next prompt.
- Browse responses by project and session.

## Requirements

- Node.js 22 or newer
- Claude Code, which is both the harness whose responses are collected and the default sub-agent
- Optional: the Codex CLI installed, signed in, and available as `codex` on your `PATH`, for questions that start with `@codex`

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

Restart Claude Code if it was already running.
Claude Code loads hooks when a session starts, so an existing session will not notice the new setup until it is restarted.

Start sidescreen:

```sh
sidescreen start --open
```

The server starts in the background, and the command returns once it answers.
It keeps running after you close the terminal or end the Claude Code session, until you run `sidescreen stop`.
The default server address is `http://127.0.0.1:7486/`.

Run `sidescreen start --open` from any project to open that project's page.
When the server is already running, the command says so and opens the page without starting another.

Finish a response in Claude Code.
It will appear in sidescreen automatically.

> Install sidescreen globally before running `sidescreen init`.
> Do not use `npx sidescreen init`: the saved hook can stop working when the temporary npx cache is removed.

## Review a response

1. Select text in the response.
2. Type a question in the box that appears.
3. Press Enter. Escape closes the box instead.
4. Read the answer in the right-hand column.

The answering sub-agent runs with read-only access.
It can inspect the project, the Claude Code transcript, and project documentation, but it cannot change files or run commands.
Before it answers a new thread, sidescreen cuts the reviewed response's own slice out of the transcript, with the prompt that started it, the reasoning and tool calls recorded for it, and its final message, so the sub-agent can read what happened without searching the whole transcript.

Each answer shows where its information came from:

- `code` - the current project files
- `transcript` - the Claude Code conversation
- `spec` - project documentation or specifications
- `none` - no documented answer was found

“No documented intent found” is a valid answer.
It means the sub-agent checked the available sources instead of guessing.

A small line above each answer says who produced it, "Claude answered:" or "CODEX answered:".
Hover over it to see the model.

You can ask follow-up questions in the field at the bottom of the answers column.
Press Enter to send and Shift+Enter for a new line.
To branch from an answer when you want to explore a different question without changing the original thread, select the branch icon under it, type the question, and press Enter.
Escape closes the field without sending.

## Choose who answers

By default, a new question is answered by Claude Code running the same model that wrote the response.
Nothing extra has to be installed for that.

Put `@codex` anywhere in a question to have the Codex CLI answer it instead, or `@claude` to insist on Claude Code.
The tag has to stand as a word of its own, at the start, in the middle, or before a punctuation mark: "does @codex agree?" works.
It is removed before the question is sent.
An address such as `me@codex.com`, a domain such as `@codex.com`, and an escaped `\@codex` are ordinary text.
When a question carries two tags, the first one decides.

Follow-ups stay with the sub-agent that answered last.
Ask a follow-up with `@codex` or `@claude` to switch.
When you switch, the new sub-agent receives the thread so far as question and answer text, so a second opinion can address what the first one said.
When you switch back, the earlier sub-agent continues its own conversation and is told what the other one answered in between.

Both sub-agents receive the same instructions, the same forwarded conventions, and the same question.
The only differences are how each CLI is started and kept read-only.

## Carry a conclusion back to Claude Code

Sidescreen never sends the full review to your Claude Code session.
You decide what crosses back.

The **Carry back** panel sits at the bottom right of the response, minimized to a bar that shows how many conclusions are pending.
Select the bar to open it, and use its maximize control for a long conclusion.

1. Write a concise conclusion in the panel's text box, or select the carry-back icon under an answer to start from its text.
2. Edit the draft so it states the decision or useful fact in your own words.
3. Press Enter to add it. Shift+Enter starts a new line.
4. Send your next prompt in the same Claude Code session.

Until it is sent, an entry can still change: select its text to edit it in place, press Enter to save, or Escape to leave it as it was.
The remove control beside an entry drops it.

The pending conclusions are added as context to that next prompt, and the terminal shows them at the same moment, so you can see what crossed.
After they are sent, they disappear from the pending list.
Side questions, sub-agent answers, and highlighted text are not included.

## Navigate projects and sessions

The home page lists every project that has sent a response to sidescreen.
Inside a project, the sidebar shows each Claude Code session as a tree: the session's title, and under it one line per response.
Hover a response to see when it arrived.
Select a session's title to collapse it; a collapsed session shows how many responses it holds.
The header shows the project's name in the centre, its full path at the right, and a back arrow at the left that returns to the list of projects.

- A project page shows the newest response from any of its sessions and keeps following as new ones arrive.
- The menu at the right edge of a session row offers **Follow this session**, which follows new responses from that session only.
- Selecting a specific response pins it, so it stays open when newer ones arrive.
- The tag beside the project name says what the page follows. When the page is pinned or follows one session, select the tag to return to following the project.

If you are typing a question or editing a conclusion, sidescreen will not replace the response in front of you.
It will show a notice linking to the new response instead.

To remove a stored response, hover over it in the sidebar and select the × twice to confirm.
Its review threads are removed too.
The original response remains in Claude Code's transcript.
A session's newest response cannot be removed on its own; it becomes removable once a newer response arrives.

To remove a whole session with every response in it, choose **Remove session** from the session's menu and confirm.
The conclusions you carried back from that session are kept, because the terminal session may still be running.
If the session sends another response later, it reappears.

## Arrange the workspace

The workspace fills the browser window.
The header stays at the top, while the sidebar, the response, and the answers each scroll on their own.

- Drag the edge of the sidebar or of the answers column to change its width.
- A handle also responds to the arrow keys, and to Home and End, once it has keyboard focus.
- Double-click a handle to restore the default width.
- The foot of the sidebar holds the control that hides it, a switch for the colour scheme, and the version.
- Hidden, the sidebar shrinks to a narrow rail that keeps both controls in the same corner.
- The colour scheme switch cycles through following your system, light, and dark.

The browser remembers the widths, whether the sidebar is hidden, the carry-back panel's state, and the colour scheme, so they survive reloads and apply to every project.
On a narrow window the panels stack and the page scrolls as one.

## The menu bar icon (macOS)

On macOS, `sidescreen start` also puts a SideScreen icon in the menu bar.
Its first menu entry reads "SideScreen is running" or "SideScreen is stopped", and hovering the icon shows the port and the server's version and process id.
The menu offers:

- **Open SideScreen**, which opens the server in your browser.
- **Start** and **Stop**, which run `sidescreen start` and `sidescreen stop` for you.
- **Show log**, which opens the server log.
- **Quit**, which removes the icon and leaves the server running.

Run `sidescreen start` to bring the icon back after quitting it.
The icon runs its commands with the environment `sidescreen start` had when it launched the icon.
After changing a setting, quit the icon and run `sidescreen start` again.
The icon's own output goes to `menubar.log` in the state directory.
Set `SIDESCREEN_MENUBAR=off` to skip the icon.

The icon is a script run by macOS's own JavaScript interpreter, `osascript`, so sidescreen ships no compiled code for it and nothing has to be built or installed.
`SIDESCREEN_MENUBAR_BIN` runs another program as the icon instead, with the same arguments; the repository carries a compiled Swift version under `native/` for anyone who can sign it.

On Linux and Windows there is no icon and nothing is mentioned about one.
The package installs the same way, nothing runs at install time, and every command works as described; the helper's files sit unused.

## Set up more projects

Run `sidescreen init` once in each project you want to use.
It:

- registers the required hooks in `.claude/settings.json`
- installs the sidescreen guidance file in `.claude/skills/sidescreen/`
- preserves settings and skills that do not belong to sidescreen

To register the hooks in your user-level Claude Code settings instead, run:

```sh
sidescreen setup hooks
```

This updates `~/.claude/settings.json`, so responses can be collected from every project.
Project-level setup is still useful because it installs the guidance file for Claude Code.

If a Node version manager moves your global packages after you switch Node versions, reinstall sidescreen and run `sidescreen init` again.
This updates the hook to the new installation path.

## Commands

| Command | Purpose |
| --- | --- |
| `sidescreen init` | Set up hooks and the guidance file in the current project. |
| `sidescreen init --dry-run` | Show what setup would change without editing files. |
| `sidescreen start` | Start the local browser app in the background on port 7486 and return. |
| `sidescreen start --open` | Start the server, or find the one running, and open this project's page. |
| `sidescreen stop` | Stop the background server and wait for the port to free. |
| `sidescreen status` | Report whether a server is running, at which version and process id. |
| `sidescreen serve` | Start the browser app in the foreground, until Ctrl-C. |
| `... --port <number>` | Any of the four above, on a different port. |
| `sidescreen setup hooks` | Register hooks in your user-level Claude Code settings. |
| `sidescreen setup hooks --project` | Register hooks in the current project's settings only. |
| `sidescreen setup hooks --dry-run` | Check hook setup without editing files. |

The hooks use `sidescreen ingest` and `sidescreen carry-back --emit` automatically.
You do not need to run those commands yourself.

## Configuration

Settings are read when the server starts.
A background server keeps the environment it was started with, so after changing a setting run `sidescreen stop` and then `sidescreen start`.

Configuration is optional and uses environment variables.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SIDESCREEN_STATE_DIR` | `$XDG_STATE_HOME/sidescreen`, or `~/.local/state/sidescreen` | Where sidescreen stores responses, reviews, and transcript slices. |
| `SIDESCREEN_SUBAGENT` | `parent` | Who answers a question with no tag: `parent` (the harness that wrote the response, on its model), `claude`, or `codex`. |
| `SIDESCREEN_CLAUDE_BIN` | `claude` | Claude Code CLI command to use for side questions. |
| `SIDESCREEN_CODEX_BIN` | `codex` | Codex CLI command to use for `@codex` questions. |
| `SIDESCREEN_CLAUDE_MODEL` | The reviewed response's model | Model for Claude Code answers. Set it to override the model recorded for the response. |
| `SIDESCREEN_CODEX_MODEL` | Codex CLI default | Model for Codex answers. |
| `SIDESCREEN_DISPATCH_TIMEOUT_MS` | `300000` | Maximum time in milliseconds for one answer. |
| `SIDESCREEN_CONVENTIONS_FILES` | `~/.claude/CLAUDE.md`, `./CLAUDE.md`, `./AGENTS.md` | Instruction files passed to the sub-agent. Use your operating system's path separator between files. |
| `SIDESCREEN_MENUBAR` | `on` | macOS only. Set to `off` to keep `sidescreen start` from showing the menu bar icon. |
| `SIDESCREEN_MENUBAR_BIN` | The shipped script, through `osascript` | macOS only. Another program to run as the menu bar icon, with the same arguments. |

## Privacy and safety

- The browser server listens only on your computer's loopback address.
- Responses, review threads, transcript slices, and pending conclusions are stored locally in the state directory.
- Side questions answered by Claude Code run in its restricted mode with only the file-reading tools available, no MCP servers, and every permission prompt denied, and with your user and project settings ignored so sidescreen's own hooks never fire inside a sub-agent.
- Side questions answered by the Codex CLI run under its read-only sandbox.
- Claude Code receives only the conclusions you explicitly add to **Carry back**.
- Sidescreen saves the final message from each completed Claude Code response, not intermediate output produced while Claude is working.

Each sub-agent session is a real session of its CLI.
Claude Code lists them in `claude --resume` under the project, named `sidescreen: <your question>`, so you can tell them apart from your own sessions and ignore them.

Each CLI still uses its configured model service to answer questions.
Review the CLI's own configuration and data policies if your project contains sensitive information.

## Troubleshooting

### A response does not appear

Run `sidescreen init` in the project and restart Claude Code.
You can check the project hook without changing anything:

```sh
sidescreen setup hooks --project --dry-run
```

Both hooks should report `unchanged` when setup is current.

### A side question fails

For a Claude Code answer, confirm that `claude -p 'hello'` works in your terminal and is signed in.
For an `@codex` answer, confirm that `codex` works in your terminal and is signed in.
If a command has another name or location, set `SIDESCREEN_CLAUDE_BIN` or `SIDESCREEN_CODEX_BIN` before starting the server.
The error shown in the thread names the sub-agent and the setting to check.

For long-running questions, increase `SIDESCREEN_DISPATCH_TIMEOUT_MS` from its five-minute default.

### Port 7486 is already in use

Run `sidescreen status`.

- "sidescreen ... is running at": the server is up. `sidescreen start --open` opens your project on it.
- "in use by something other than sidescreen": another program holds the port. Start on another port and open the address it prints:

  ```sh
  sidescreen start --port 7487
  ```

- "reads <directory>, not <directory>": a server started with a different `SIDESCREEN_STATE_DIR` holds the port. Stop it with the same variable set, or use another port.

### The server does not start

`sidescreen start` names the log file when the server exits before answering, and prints its last lines.
The log is `server.log` in the state directory, `~/.local/state/sidescreen/server.log` by default.

### After upgrading or before uninstalling

A background server keeps running until it is stopped, even after the package is upgraded or removed.
After upgrading, `sidescreen start` and `sidescreen status` say when the running server is from the older version; run `sidescreen stop` and then `sidescreen start` to switch.
Run `sidescreen init` again in each project to refresh the skill it installed.
Before uninstalling, run `sidescreen stop`.

## Development

```sh
git clone https://github.com/johardi/sidescreen.git
cd sidescreen
npm install
npm link
npm run check
```

`npm link` is optional.
It makes the checkout's `sidescreen` command available on your `PATH`.

Two additional test modes are available:

```sh
SIDESCREEN_E2E_CLAUDE=1 npm test
UPDATE_SNAPSHOTS=1 npm test
```

The first runs the tests that use a real Claude Code CLI, the hook test and the restricted sub-agent test, and may use API credits.
The second updates the Markdown rendering snapshot.

Planning documents are in `openspec/`.

## License

MIT.

The icons in the browser interface are from [Font Awesome Free](https://fontawesome.com), used under the [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) license.
