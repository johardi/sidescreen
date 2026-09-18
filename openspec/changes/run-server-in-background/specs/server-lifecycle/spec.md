## Purpose

Defines how the browser server is started as a process of its own, found again through its address by any later session, identified, stopped, and inspected, so that one server serves every session that writes to the same store.

## ADDED Requirements

### Requirement: The server can be started as a detached process

The system SHALL provide a start command that launches the server as a process independent of the calling shell and its process group, and SHALL return once the server answers at its address, printing that address and the current directory's project address.
The server SHALL keep running after the shell that ran the command has exited and after the Claude Code session that ran it has ended.
The server's own output SHALL be written to a log file in the state directory, and the start command SHALL name that file when the server fails to come up.
The start command SHALL refuse an ephemeral port (port 0), because a detached server must be reachable at a known address.

#### Scenario: Starting from a session

- **WHEN** the user runs the start command and no server is on the port
- **THEN** the command prints the server address and this directory's project address and exits successfully within a few seconds
- **AND** the server answers at that address after the command has returned

#### Scenario: The starter goes away

- **WHEN** the process group that ran the start command is terminated after the command has returned
- **THEN** the server still answers at its address

#### Scenario: The server fails to come up

- **WHEN** the launched server exits before answering, for a reason other than losing the port to another sidescreen server
- **THEN** the command reports the failure, names the log file, and exits non-zero

#### Scenario: Port zero

- **WHEN** the user runs the start command with port 0
- **THEN** the command explains that a detached server needs a fixed port and exits non-zero

### Requirement: One server per address

The system SHALL run at most one server per address.
Before launching, the start command SHALL ask the address whether a sidescreen server already answers there.
When one does and it reads the same store, the command SHALL report that the server is already running at that address and SHALL exit successfully without launching another process.
When the address is held by something that is not a sidescreen server, the command SHALL say so, suggest another port, and exit non-zero.
When a sidescreen server on the address reads a different store than the command would, the command SHALL name both stores and exit non-zero, because turns written to this store would not appear there.
When two start commands race for the same address, exactly one server SHALL remain and both commands SHALL report it as running.
The foreground serve command SHALL follow the same rules when the port is taken.

#### Scenario: A second session starts the server

- **WHEN** a server is already running on the default port and another session runs the start command
- **THEN** the command prints that a server is already running at that address and exits successfully
- **AND** no second server process is started

#### Scenario: Two sessions start at the same instant

- **WHEN** two start commands run concurrently against the same free port
- **THEN** one server process is running afterwards
- **AND** both commands exit successfully naming the same address

#### Scenario: Another program holds the port

- **WHEN** the port is held by a program that is not sidescreen and the user runs the start command
- **THEN** the command says the address is in use by something other than sidescreen, suggests another port, and exits non-zero

#### Scenario: A server reads a different store

- **WHEN** a sidescreen server on the port was started with a different state directory than the command's
- **THEN** the command names both state directories and exits non-zero

#### Scenario: Foreground serve on a taken port

- **WHEN** a sidescreen server is on the port and the user runs the foreground serve command
- **THEN** the command prints that a server is already running at that address and exits successfully

### Requirement: The server identifies itself

The server SHALL answer a health request with the product name, its version, its process id, and the state directory it reads, so that a command or another program can tell a sidescreen server from any other occupant of the port.
The health request SHALL be subject to the same loopback-only rules as every other request.

#### Scenario: Asking a running server

- **WHEN** a client requests the health endpoint of a running server
- **THEN** the answer names sidescreen, the version, the process id, and the state directory

### Requirement: A running server can be stopped and inspected

The system SHALL provide a stop command that asks the sidescreen server on the address to shut down cleanly and waits until the address is free.
Stopping when no server answers SHALL succeed and say that nothing was running.
When the address is held by something that is not sidescreen, the stop command SHALL leave it alone, say so, and exit non-zero.
When the server has not left the address within a bounded wait, the stop command SHALL report the process id and exit non-zero rather than force-kill it.
The system SHALL provide a status command that prints one line saying whether a sidescreen server answers at the address, with its version and process id, and SHALL exit successfully when one does and non-zero when none does.

#### Scenario: Stopping the running server

- **WHEN** a server is running and the user runs the stop command
- **THEN** the server shuts down, the address is free, and the command exits successfully

#### Scenario: Stopping when nothing runs

- **WHEN** no server answers on the port and the user runs the stop command
- **THEN** the command says nothing was running and exits successfully

#### Scenario: Status of a running server

- **WHEN** a server is running and the user runs the status command
- **THEN** one line names the address, version, and process id, and the command exits successfully

#### Scenario: Status with no server

- **WHEN** no server answers and the user runs the status command
- **THEN** one line says no server is running at the address, and the command exits non-zero

### Requirement: The project opens whether the server was started or found

When the start command is run with the open-browser option, it SHALL open the current directory's project page whether it started the server or found one already running.

#### Scenario: Opening from a second session

- **WHEN** a server is already running and the user runs the start command with the open-browser option from another project directory
- **THEN** that directory's project page opens in the browser and the command exits successfully

### Requirement: A server from another version is called out

When the running server's version differs from the command's own version, the start and status commands SHALL name both versions and say that stopping and starting again switches to the installed version.

#### Scenario: Starting after an upgrade

- **WHEN** a server from an older install is running and the user runs the start command from a newer install
- **THEN** the command reports the server as running, names both versions, and says how to switch
- **AND** it exits successfully, because the running server is usable

### Requirement: The shipped skill starts the server detached

The skill installed into a project SHALL direct the agent to open the review surface with the start command and the open-browser option, SHALL state that a report of a server already running is success and that the command is not to be repeated in the same session, and SHALL name the stop command.

#### Scenario: The agent is asked to open the review surface

- **WHEN** the user asks the agent to open sidescreen
- **THEN** the skill leads the agent to run the start command with the open-browser option once
- **AND** the skill tells the agent that an "already running" report is success, so it does not run the command again
