## MODIFIED Requirements

### Requirement: The installed copy is self-sufficient

The published package SHALL contain everything `init`, `start`, and `serve` need: the executable, the server and its browser assets, the shipped skill, and, for macOS, the menu bar item's script.
The published package SHALL NOT contain tests, test fixtures, planning artifacts, or editor and agent configuration.

#### Scenario: Setting up a project from an installed copy

- **WHEN** the user runs `sidescreen init` from a globally installed copy, with no checkout present
- **THEN** the hooks are registered with a command that points at the installed executable
- **AND** the shipped skill is installed into the project's skills directory from the installed copy

#### Scenario: Inspecting the package contents

- **WHEN** the package tarball is listed before publishing
- **THEN** it contains the executable, the source and browser assets, the skill, the macOS menu bar item's script, the manifest, the README, and the license
- **AND** it contains no file from the test or planning directories
