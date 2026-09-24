#!/usr/bin/env bash
# One-shot provisioning. Run it once; after that GitHub Actions does the rest.
#
#   ./infra/provision.sh <resource-group> [location]
#
# Prints every value you need to paste into the deployment guide's settings step.
set -euo pipefail

RG="${1:?usage: provision.sh <resource-group> [location]}"
LOCATION="${2:-centralindia}"

echo "==> Creating resource group $RG in $LOCATION"
az group create --name "$RG" --location "$LOCATION" --output none

echo "==> Deploying infrastructure (this takes a few minutes, Cosmos is slow)"
DEPLOY=$(az deployment group create \
  --resource-group "$RG" \
  --template-file "$(dirname "$0")/main.bicep" \
  --query properties.outputs --output json)

SITE=$(echo "$DEPLOY" | python3 -c 'import json,sys; print(json.load(sys.stdin)["staticWebAppName"]["value"])')
HOST=$(echo "$DEPLOY" | python3 -c 'import json,sys; print(json.load(sys.stdin)["staticWebAppHostname"]["value"])')
COSMOS=$(echo "$DEPLOY" | python3 -c 'import json,sys; print(json.load(sys.stdin)["cosmosAccountName"]["value"])')
STORAGE=$(echo "$DEPLOY" | python3 -c 'import json,sys; print(json.load(sys.stdin)["storageAccountName"]["value"])')

echo "==> Reading connection strings"
COSMOS_CS=$(az cosmosdb keys list --name "$COSMOS" --resource-group "$RG" \
  --type connection-strings --query 'connectionStrings[0].connectionString' --output tsv)
STORAGE_CS=$(az storage account show-connection-string --name "$STORAGE" \
  --resource-group "$RG" --query connectionString --output tsv)
DEPLOY_TOKEN=$(az staticwebapp secrets list --name "$SITE" --resource-group "$RG" \
  --query 'properties.apiKey' --output tsv)

SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n')
BACKUP_SECRET=$(openssl rand -base64 32 | tr -d '\n')

echo "==> Applying application settings"
az staticwebapp appsettings set --name "$SITE" --resource-group "$RG" --setting-names \
  "COSMOS_CONNECTION_STRING=$COSMOS_CS" \
  "SESSION_SECRET=$SESSION_SECRET" \
  "BACKUP_SECRET=$BACKUP_SECRET" \
  "BACKUP_STORAGE_CONNECTION_STRING=$STORAGE_CS" \
  --output none

cat <<SUMMARY

--------------------------------------------------------------------
Provisioned.

  App URL          https://$HOST
  Static Web App   $SITE
  Cosmos account   $COSMOS
  Storage account  $STORAGE

Add these as GitHub repository secrets
(Settings -> Secrets and variables -> Actions):

  AZURE_STATIC_WEB_APPS_API_TOKEN
$DEPLOY_TOKEN

  PROEXPENSE_URL
https://$HOST

  BACKUP_SECRET
$BACKUP_SECRET

Application settings are already applied to the Static Web App.
Your first sign-in PIN is 000000 and the app will force you to change it.
--------------------------------------------------------------------
SUMMARY
