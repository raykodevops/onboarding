param(
    [string]$TenantId = '50d1d247-aa75-4931-8ddf-3c2ee9421629',
    [string]$SubscriptionId = '',
    [string]$ResourceGroupName = 'OnboardingRunbookRG',
    [string]$Location = 'eastus2',
    [string]$StorageAccountName = 'onboardingrunbooksa' + (Get-Random -Minimum 1000 -Maximum 9999),
    [string]$StaticWebAppName = 'onboardingrunbook' + (Get-Random -Minimum 1000 -Maximum 9999),
    [string]$AppLocation = '/',
    [string]$ApiLocation = 'api',
    [string]$NotesContainer = 'onboarding-notes'
)

$AzExe = 'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd'

function Ensure-AzureCli {
    if (-not (Test-Path $AzExe)) {
        Write-Error 'Azure CLI not found at path $AzExe. Install it from https://aka.ms/installazurecliwindows and rerun this script.'
        exit 1
    }
}

function Login-Azure {
    Write-Host 'Logging into Azure...' -ForegroundColor Cyan
    & $AzExe login --tenant $TenantId | Out-Null
    if ($SubscriptionId) {
        & $AzExe account set --subscription $SubscriptionId | Out-Null
    }
    else {
        $SubscriptionId = & $AzExe account show --query id -o tsv
        Write-Host "Using subscription $SubscriptionId"
    }
}

function Create-Resources {
    Write-Host "Creating resource group '$ResourceGroupName' in '$Location'..." -ForegroundColor Cyan
    az group create --name $ResourceGroupName --location $Location | Out-Null

    Write-Host "Creating storage account '$StorageAccountName'..." -ForegroundColor Cyan
    & $AzExe storage account create --name $StorageAccountName --resource-group $ResourceGroupName --location $Location --sku Standard_LRS --kind StorageV2 --access-tier Hot | Out-Null

    Write-Host "Creating Azure Static Web App '$StaticWebAppName' on Free tier..." -ForegroundColor Cyan
    & $AzExe staticwebapp create --name $StaticWebAppName --resource-group $ResourceGroupName --location $Location --source . --app-location $AppLocation --api-location $ApiLocation --sku Free | Out-Null
}

function Configure-Settings {
    Write-Host 'Retrieving storage connection string...' -ForegroundColor Cyan
    $connectionString = & $AzExe storage account show-connection-string --name $StorageAccountName --resource-group $ResourceGroupName -o tsv

    Write-Host 'Configuring app settings for note storage...' -ForegroundColor Cyan
    & $AzExe staticwebapp appsettings set --name $StaticWebAppName --resource-group $ResourceGroupName --setting-names NOTES_STORAGE_CONNECTION_STRING="$connectionString" NOTES_CONTAINER=$NotesContainer | Out-Null

    Write-Host 'Important: Configure Azure AD authentication manually in the Static Web App resource.' -ForegroundColor Yellow
    Write-Host 'Use the Azure portal to set Azure AD provider and redirect URI.'
}

function Print-Summary {
    $webAppUrl = & $AzExe staticwebapp show --name $StaticWebAppName --resource-group $ResourceGroupName --query defaultHostname -o tsv
    Write-Host '---' -ForegroundColor Green
    Write-Host "Resource group: $ResourceGroupName"
    Write-Host "Static Web App: $StaticWebAppName"
    Write-Host "Static Web App URL: https://$webAppUrl"
    Write-Host "Storage account: $StorageAccountName"
    Write-Host "Storage container: $NotesContainer"
    Write-Host '---' -ForegroundColor Green
    Write-Host 'Next step: configure Azure AD in the Static Web App Authentication section.'
}

Ensure-AzureCli
Login-Azure
Create-Resources
Configure-Settings
Print-Summary
