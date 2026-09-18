## MODIFIED Requirements

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
