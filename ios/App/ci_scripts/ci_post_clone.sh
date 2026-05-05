#!/bin/sh
set -euxo pipefail

cd "$CI_PRIMARY_REPOSITORY_PATH"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

brew install node cocoapods || brew upgrade node cocoapods

node --version
npm --version
pod --version

npm ci

cd ios/App
pod install --repo-update
