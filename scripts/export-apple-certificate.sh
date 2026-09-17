#!/usr/bin/env bash
# Export a Developer ID Application .p12 as base64 for GitHub Actions.
# Usage:
#   ./scripts/export-apple-certificate.sh /path/to/certificate.p12
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/certificate.p12"
  exit 1
fi

P12="$1"
if [[ ! -f "$P12" ]]; then
  echo "File not found: $P12"
  exit 1
fi

OUT="$(mktemp -t apple-cert-base64)"
openssl base64 -A -in "$P12" -out "$OUT"

echo
echo "1. Copy the base64 string below into the GitHub secret APPLE_CERTIFICATE"
echo "2. Set APPLE_CERTIFICATE_PASSWORD to the password you used when exporting the .p12"
echo "3. Set KEYCHAIN_PASSWORD to any strong random password (CI-only keychain)"
echo "4. Set APPLE_ID to your Apple ID email"
echo "5. Set APPLE_PASSWORD to an app-specific password (appleid.apple.com → Sign-In and Security → App-Specific Passwords)"
echo "6. Set APPLE_TEAM_ID from developer.apple.com → Membership details"
echo
echo "----- begin APPLE_CERTIFICATE -----"
cat "$OUT"
echo
echo "----- end APPLE_CERTIFICATE -----"
rm -f "$OUT"
