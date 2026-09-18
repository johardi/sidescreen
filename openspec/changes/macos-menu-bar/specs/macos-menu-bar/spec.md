## Purpose

Gives the background server a presence on macOS: a menu bar item that shows whether the server is running and lets the user open, start, and stop it without a terminal.

## ADDED Requirements

### Requirement: A menu bar item accompanies the background server on macOS

On macOS, when the start command leaves a sidescreen server running on the command's store, whether it started that server or found it, the system SHALL launch a menu bar item for that server as a process detached from the command, unless the item is disabled through the environment.
At most one item SHALL run per state directory; a second launch SHALL leave the first in place and exit quietly.
Quitting the item SHALL NOT stop the server.
When the item's program cannot be found, the start command SHALL say so in one line on its error stream and SHALL still exit successfully.
On other operating systems, and when disabled, the start command SHALL NOT attempt to launch the item and SHALL say nothing about it.
The foreground serve command SHALL NOT launch the item.

#### Scenario: Starting on macOS

- **WHEN** the user runs the start command on macOS and a server is running afterwards
- **THEN** a sidescreen item appears in the menu bar
- **AND** the command has exited, and the item remains

#### Scenario: Starting again while the item is running

- **WHEN** the item is running and the user runs the start command again on the same store
- **THEN** the command reports the server as running and exits successfully
- **AND** exactly one item is in the menu bar afterwards

#### Scenario: Quitting the item

- **WHEN** the user chooses Quit in the item's menu
- **THEN** the item disappears and the server still answers at its address
- **AND** running the start command brings the item back

#### Scenario: The item's program is missing

- **WHEN** the start command runs on macOS from a checkout whose helper has not been built
- **THEN** the server is started or found as usual and the command exits successfully
- **AND** one line on the error stream says the menu bar item is unavailable and names the expected path

#### Scenario: Disabled through the environment

- **WHEN** `SIDESCREEN_MENUBAR` is `off` and the user runs the start command on macOS
- **THEN** no item is launched and the command's output does not mention it

#### Scenario: Another operating system

- **WHEN** the start command runs on Linux or Windows
- **THEN** no item is launched and the command's output does not mention it

### Requirement: The item shows the server's state and offers its controls

The item SHALL show, within a few seconds of any change, whether a sidescreen server answers on the item's port: its first menu entry SHALL read "SideScreen is running" when one does and "SideScreen is stopped" when none does, and the icon's tooltip SHALL add the port, and the server's version and process id when one does.
The item's menu SHALL offer "Open SideScreen", which opens the server's address in the default browser, "Start", "Stop", "Show log", which opens the server's log file, and "Quit", which quits the item.
Start SHALL be offered only when no server answers, and Open and Stop only when one does.
Start and Stop SHALL run the same commands the user would type, `sidescreen start` and `sidescreen stop` on the item's port, with the environment the item was launched with, so that the item and the terminal act on the same store and port.
While a command runs, the item SHALL say so and SHALL NOT offer the same action again until the command completes.
When a command fails, the item SHALL show the first line of the failure until the server's state next changes.

#### Scenario: The server is running

- **WHEN** a server answers on the item's port
- **THEN** the item's first entry reads "SideScreen is running" and the tooltip names the port, version, and process id
- **AND** Open SideScreen and Stop are offered and Start is not

#### Scenario: Stopping from the item

- **WHEN** the user chooses Stop
- **THEN** the item says it is stopping, the server's address stops answering, and within a few seconds the item reads "SideScreen is stopped"
- **AND** Start is offered and Open and Stop are not

#### Scenario: Starting from the item

- **WHEN** no server is running and the user chooses Start
- **THEN** the item says it is starting, and within a few seconds it reads "SideScreen is running" with the new process id in the tooltip
- **AND** the server reads the same store the item was launched for

#### Scenario: Stopping from the terminal

- **WHEN** the item shows the server running and the user runs the stop command in a terminal
- **THEN** within a few seconds the item reads "SideScreen is stopped"

#### Scenario: A command fails

- **WHEN** Start is chosen and the start command exits non-zero, for example because another program has taken the port
- **THEN** the item shows the first line of that command's error output
- **AND** Start is offered again

### Requirement: The item is shipped as a script run by macOS's own JavaScript interpreter

The published package SHALL contain the item as one JavaScript for Automation source file, and the system SHALL run it through `/usr/bin/osascript`, so that no compiled code of the project's own is executed for the item.
The script SHALL print its version when asked, and that version SHALL equal the package version it ships in.
When `SIDESCREEN_MENUBAR_BIN` names an executable, the system SHALL launch that executable in place of the interpreter and script, with the same arguments the script receives, so that a signed native build can be substituted without a change to the command line.

#### Scenario: Inspecting the package

- **WHEN** the package tarball is listed before publishing
- **THEN** it contains the item's script and no compiled item

#### Scenario: Checking the shipped script

- **WHEN** the script is run through the interpreter with the version flag
- **THEN** it prints the package version and exits successfully

#### Scenario: Publishing from another platform

- **WHEN** the package is published from Linux or Windows
- **THEN** nothing about the item has to be built, and the package is complete

#### Scenario: A program substituted for the item

- **WHEN** `SIDESCREEN_MENUBAR_BIN` names an executable and the user runs the start command on macOS
- **THEN** that executable is launched as the item, with the `--port`, `--state-dir`, `--node`, and `--bin` arguments the script would receive
