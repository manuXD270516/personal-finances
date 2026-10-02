#!/bin/sh
# Reproduces the CRLF failure via git autocrlf=true (the owner's global setting) and shows .gitattributes fixing it.
# Run from Git Bash: sh crlf/run-crlf-experiment.sh <scratch-dir>
set -u
export MSYS_NO_PATHCONV=1   # Git Bash would rewrite /entrypoint.sh to C:/Program Files/Git/entrypoint.sh
HERE=$(cd "$(dirname "$0")" && pwd)
W=${1:?scratch dir}
rm -rf "$W" && mkdir -p "$W"
for variant in no-gitattributes with-gitattributes; do
  echo "================ $variant ================"
  R="$W/origin-$variant"; C="$W/clone-$variant"
  git init -q "$R" && cp "$HERE/entrypoint.sh" "$HERE/Dockerfile" "$R/"
  if [ "$variant" = with-gitattributes ]; then printf '* text=auto eol=lf\n*.sh text eol=lf\n*.{cmd,bat,ps1} text eol=crlf\n' > "$R/.gitattributes"; fi
  git -C "$R" add -A && git -C "$R" -c user.name=spike -c user.email=spike@local -c core.autocrlf=true commit -qm init
  git -c core.autocrlf=true clone -q "$R" "$C"
  echo "CRLF line endings in checked-out entrypoint.sh: $(node -p "require('fs').readFileSync(process.argv[1],'latin1').split(String.fromCharCode(13)).length-1" "$C/entrypoint.sh")"
  docker build -q -t "pf-spike-08/crlf-$variant:local" "$C" >/dev/null
  echo "--- docker run (exec-form ENTRYPOINT /entrypoint.sh):"
  docker run --rm "pf-spike-08/crlf-$variant:local"; echo "exit=$?"
  echo "--- docker run --entrypoint sh (sh /entrypoint.sh):"
  docker run --rm --entrypoint sh "pf-spike-08/crlf-$variant:local" /entrypoint.sh echo hi; echo "exit=$?"
done
