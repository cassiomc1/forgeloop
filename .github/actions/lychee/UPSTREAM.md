# Lychee action provenance

Source: `lycheeverse/lychee-action` commit `e7477775783ea5526144ba13e8db5eec57747ce8` (v2.9.0).

Local changes invoke `entrypoint.sh` with explicit `bash` instead of its login-shell shebang, and add a validated `linuxTarget` input (`gnu` by default, or `musl`). The project Docker runner selects the same pinned v0.24.2 musl release because its GNU binary requires unavailable GLIBC_2.38/2.39. The pinned release provides both targets. Checker arguments, failure handling and reporting are retained; entrypoint and both licenses remain upstream copies.
