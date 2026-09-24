// ProExpense infrastructure.
//
// Everything here is sized for one user and a couple of events a month:
//   - Cosmos DB with the free tier enabled and shared database throughput,
//     which keeps the whole thing inside the free 1000 RU/s allowance
//   - A Standard_LRS storage account for weekly JSON backups
//   - A Free-tier Static Web App serving the PWA and the managed Functions API
//
// Note: exactly one free-tier Cosmos account is allowed per subscription. If
// you already have one, set cosmosFreeTier to false — serverless billing for
// this workload is still cents per month.

targetScope = 'resourceGroup'

@description('Short name used as a prefix for every resource.')
param appName string = 'proexpense'

@description('Region for Cosmos DB and storage.')
param location string = resourceGroup().location

@description('Static Web Apps is available in a limited set of regions.')
@allowed(['westus2', 'centralus', 'eastus2', 'westeurope', 'eastasia'])
param staticSiteLocation string = 'centralus'

@description('Set false if this subscription already uses its one free-tier Cosmos account.')
param cosmosFreeTier bool = true

var suffix = uniqueString(resourceGroup().id)
var cosmosName = toLower('${appName}-cosmos-${suffix}')
var storageName = toLower(take('${appName}st${suffix}', 24))
var siteName = '${appName}-web-${suffix}'

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableFreeTier: cosmosFreeTier
    minimalTlsVersion: 'Tls12'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    backupPolicy: {
      type: 'Periodic'
      periodicModeProperties: {
        backupIntervalInMinutes: 1440
        backupRetentionIntervalInHours: 168
        backupStorageRedundancy: 'Local'
      }
    }
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: 'proexpense'
  properties: {
    resource: {
      id: 'proexpense'
    }
    // Shared throughput across both containers, at the minimum. The free tier
    // covers 1000 RU/s, so this costs nothing while it is enabled.
    options: {
      throughput: 400
    }
  }
}

resource eventsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: 'events'
  properties: {
    resource: {
      id: 'events'
      partitionKey: {
        paths: ['/id']
        kind: 'Hash'
      }
    }
  }
}

resource systemContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: 'system'
  properties: {
    resource: {
      id: 'system'
      partitionKey: {
        paths: ['/id']
        kind: 'Hash'
      }
    }
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource site 'Microsoft.Web/staticSites@2023-12-01' = {
  name: siteName
  location: staticSiteLocation
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    stagingEnvironmentPolicy: 'Disabled'
    allowConfigFileUpdates: true
  }
}

output staticWebAppName string = site.name
output staticWebAppHostname string = site.properties.defaultHostname
output cosmosAccountName string = cosmos.name
output storageAccountName string = storage.name
output resourceGroupName string = resourceGroup().name
