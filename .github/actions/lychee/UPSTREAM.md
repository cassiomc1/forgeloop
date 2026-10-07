# Lychee action provenance

Source: `lycheeverse/lychee-action` commit `e7477775783ea5526144ba13e8db5eec57747ce8` (v2.9.0).

The sole upstream code change invokes `entrypoint.sh` with explicit `bash` instead of executing its login-shell shebang. Login startup on the Docker runner replaces PATH after the action installs its binary and exports GITHUB_PATH. Inputs, installation, checker arguments, failure handling and reporting are retained. Both upstream licenses are included.
