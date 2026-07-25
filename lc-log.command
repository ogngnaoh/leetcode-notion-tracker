#!/bin/zsh

printf '\033]0;LeetCode Tracker Bridge\007'

pause_before_close() {
  if [[ -t 0 ]]; then
    printf '\nPress any key to close this terminal window.'
    read -k 1
    printf '\n'
  fi
}

tracker_root="$(cd -- "$(dirname -- "$0")" && pwd -P)"
cd -- "$tracker_root" || exit 1

if [[ ! -x ./node_modules/.bin/tsx ]]; then
  print -u2 'Dependencies are not installed. Run npm install in the tracker repository.'
  pause_before_close
  exit 1
fi

print 'LeetCode Tracker'
print 'Starting the visible local bridge. Leave this window open while using the extension.'
print 'Press Ctrl-C or close this window to stop it.'
print

./node_modules/.bin/tsx src/launcher/start-bridge.ts
bridge_exit_code=$?

if (( bridge_exit_code == 0 )); then
  print 'Launcher finished.'
else
  print -u2 "The LeetCode Tracker bridge stopped with status ${bridge_exit_code}."
  pause_before_close
fi
exit "$bridge_exit_code"
