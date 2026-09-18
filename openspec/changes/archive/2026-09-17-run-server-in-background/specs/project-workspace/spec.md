## REMOVED Requirements

### Requirement: A second server reports the address in use

**Reason**: Superseded by `server-lifecycle`, where a sidescreen server already on the port is reported as running with a successful exit, and only an occupant that is not sidescreen is an error.
**Migration**: Run `sidescreen status` to see what holds the port. `sidescreen start` and `sidescreen serve` both report a running sidescreen server and exit successfully; a port held by another program still exits non-zero with a suggestion to use another port.
