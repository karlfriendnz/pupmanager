#!/bin/sh
set -euxo pipefail

cd "$CI_PRIMARY_REPOSITORY_PATH"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

brew install node cocoapods || brew upgrade node cocoapods

node --version
npm --version
pod --version

npm ci

# Copies webDir into ios/App/App/public, generates capacitor.config.json + config.xml,
# and runs `pod install` for Capacitor plugins.
npx cap sync ios
