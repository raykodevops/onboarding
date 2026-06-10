# Azure Onboarding Runbook App

This repository contains a low-cost authenticated Azure Static Web App with an Azure Functions backend for notes sync.

## What this includes

- `index.html` — authenticated onboarding webpage with plan import and note editing
- `styles.css` — dark-themed UI styles
- `app.js` — client-side logic for authentication, plan tabs, and note sync
- `api/notes/index.js` — Azure Function endpoint for authenticated note storage
- `staticwebapp.config.json` — route and login protection settings for Azure Static Web Apps
- `90_Day_Plan_Azure_Infrastructure_Manager.md` — your onboarding plan source file

## Architecture

- Static frontend hosted in Azure Static Web Apps
- Azure AD authentication via Static Web Apps built-in provider
- `GET /api/notes` and `POST /api/notes` to read/write notes
- Notes stored in Azure Blob Storage using user-specific JSON blobs

## Deployment steps

### Option 1: Create resources with PowerShell / Azure CLI

If you do not already have Azure CLI installed, install it first:

```powershell
winget install --id Microsoft.AzureCLI -e
```

Then run the provided deployment script from the `Code` folder:

```powershell
cd "C:\Users\rayko\OneDrive\Rayko_M\OneDrive\Documents\Code"
.\deploy-azure.ps1
```

This script will:
- create a resource group
- create a storage account
- create a Free-tier Azure Static Web App
- configure the Static Web App app setting `NOTES_STORAGE_CONNECTION_STRING`

You may still need to configure Azure AD authentication in the portal after the script runs.

### 1. Create Azure Static Web App

1. Open the Azure Portal and create a new **Static Web App**.
2. Choose the **Free** tier.
3. Set the app location to `/`, API location to `api`, and app artifact location to `/`.
4. Choose your repository or skip GitHub deployment for manual deployment.

### 2. Configure Azure AD authentication

1. In your tenant `raykomhotmail303.onmicrosoft.com`, go to **Azure Active Directory > App registrations**.
2. Create a new registration for this app.
3. Add a redirect URI: `https://<YOUR-SWA-NAME>.azurestaticapps.net/.auth/login/aad/callback`
4. Copy the `Application (client) ID`.
5. In the Static Web App's **Authentication** settings, add Azure Active Directory and use the app registration.
6. Set users to allow your tenant or specific users.

### 3. Configure storage for notes

1. Create an Azure Storage Account.
2. Create a new container, or let the function create one automatically.
3. In the Static Web App configuration, add an application setting:
   - `NOTES_STORAGE_CONNECTION_STRING` = your storage account connection string
4. (Optional) also set `NOTES_CONTAINER` to a custom container name; default is `onboarding-notes`.

### 4. Deploy the app

If using GitHub, the deployment pipeline will push your site automatically. Otherwise, upload the files manually to your Static Web App.

### 5. Test authentication and notes

1. Open your Static Web App URL.
2. Log in with Azure AD.
3. Load the plan from `90_Day_Plan_Azure_Infrastructure_Manager.md`.
4. Add notes and click **Save notes**.
5. Use **Load notes** to retrieve stored notes.

## Local development

If you want to preview locally, install the Azure Static Web Apps CLI:

```bash
npm install -g @azure/static-web-apps-cli
swa start . --api api
```

Then browse to the local URL shown by the CLI.

## Notes

- Authentication is handled by Azure Static Web Apps and Azure AD.
- Notes are stored per user in Azure Blob Storage.
- The app protects all front-end and API routes to authenticated users.

## Next steps

- Deploy it in Azure Static Web Apps.
- Configure the Azure AD app registration.
- Add your `NOTES_STORAGE_CONNECTION_STRING` setting.
- Optionally, customize the UI or add support for shared team notes.
