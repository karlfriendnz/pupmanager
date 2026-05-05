#!/bin/sh
set -euo pipefail

cd "$CI_PRIMARY_REPOSITORY_PATH"

if ! command -v node >/dev/null 2>&1; then
  brew install node
fi

if ! command -v pod >/dev/null 2>&1; then
  brew install cocoapods
fi

npm ci

cd ios/App
pod install
