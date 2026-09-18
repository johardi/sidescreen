# package-distribution Specification

## Purpose

Defines how the tool is obtained and identified once it is published: installing it from the npm registry by name yields the `sidescreen` command with everything setup needs, so a user never has to clone the repository to use it.

## Requirements

### Requirement: The tool is installable by name from the npm registry

The package SHALL be published to the npm registry under the unscoped name `sidescreen`, and a global install of that package SHALL place a `sidescreen` command on the user's PATH.
The package SHALL declare the minimum Node.js version it runs on, so a package manager can warn when the runtime is older.
The documentation SHALL present a global install followed by `sidescreen init` as the route to setting up a project, and SHALL state that running setup through a temporary install such as `npx` is not recommended, because the hooks it registers point at a location that can be removed.

#### Scenario: Installing globally

- **WHEN** the user runs the package manager's global install with the name `sidescreen`
- **THEN** the `sidescreen` command is available in a new shell
- **AND** `sidescreen --help` prints the usage text and exits successfully

#### Scenario: Following the documented quick start

- **WHEN** a user follows the README quick start
- **THEN** the steps are a global install, `sidescreen init` in the project, and `sidescreen start --open`
- **AND** no step requires cloning the repository, linking a checkout, or keeping a terminal open

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

### Requirement: The tool reports the package version

The command SHALL print, for `--version`, exactly the version declared in the installed package manifest, and SHALL show the same version at the head of its usage text.

#### Scenario: Checking the version

- **WHEN** the user runs `sidescreen --version`
- **THEN** the output is the version string from the installed package manifest and nothing else
- **AND** the exit status is zero

### Requirement: The package declares its license and authorship

The package manifest SHALL declare the MIT license, the author's name and email, the source repository, the homepage, and where to report issues.
A `LICENSE` file carrying the MIT license text SHALL ship inside the package.

#### Scenario: Reading the published metadata

- **WHEN** the package's metadata is inspected on the registry or in the tarball
- **THEN** the license is MIT, the author is named with an email address, and the repository, homepage, and issue tracker point at the project's GitHub repository
- **AND** the tarball contains the `LICENSE` file at its root

### Requirement: Publishing is guarded by the project's checks

Publishing SHALL run lint, typecheck, and the test suite first, and SHALL abort before anything is uploaded when any of them fails.

#### Scenario: A failing check blocks publishing

- **WHEN** publishing is attempted while lint, typecheck, or a test fails
- **THEN** the publish stops with the failure reported
- **AND** nothing is uploaded to the registry

#### Scenario: All checks pass

- **WHEN** publishing is attempted and lint, typecheck, and tests all pass
- **THEN** the package is uploaded under the name and version in the manifest
