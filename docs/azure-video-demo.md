# Aura with your own Azure subscription

The recording should show a real Azure OpenAI model building a small app in Aura,
followed by an upload to a dedicated Azure Static Web App in your tenant.
Local CLI installation and authentication can be completed before recording.

## Completed recording · 19 November 2026

The Danish recording shows a live Azure OpenAI build and publishing from Aura to
a dedicated non-production Static Web App. Key entry is off camera. The video
discloses the cuts to the waiting time. The deployed homepage matched the saved
version, and search, capacity and projector filters, empty state and reset were
checked in Chrome. The recording used an isolated Aura profile and macOS Keychain.

The new **Azure Container Apps** publishing option is described in
[azure-container-apps.md](azure-container-apps.md). Container Apps is not part of
this Static Web Apps recording.

## Settings in Aura

| Setting | Value |
| --- | --- |
| AI provider | Azure OpenAI / Microsoft Foundry |
| Server address | Your Azure OpenAI resource's HTTPS endpoint |
| Deployment name | Your model deployment name in Azure |
| API format | Responses |
| Hosting subscription | Your non-production subscription |
| Static Web App | Your dedicated demo app |
| Publish mode / directory | Static files / `public` |
| Publish environment | `harness-test` (Azure may normalise to `harnesstest`) |

Retrieve the AI resource key from **Keys and Endpoint** in Azure and enter it
directly in Aura before filming. Aura stores the key locally with OS encryption.

## Local commands

From this repository:

```sh
node scripts/azure-demo.cjs check
node scripts/azure-demo.cjs start
```

The launcher supplies absolute paths for Azure CLI and the local SWA CLI to Aura.
It uses normal Aura settings and does not reset existing connections or projects.
The check command lists cached subscriptions without retrieving credentials.
For a different Azure CLI location, set `HARNESS_AZ_PATH`.

For the optional command-line checks, create `.cache/azure-demo-config.json`
with your own non-production resource details. Git ignores this directory. Add
the section for the check you intend to run and fill it with resource names and
subscription IDs.

```json
{
  "openai": {
    "subscription": "<subscription-id>",
    "group": "<openai-resource-group>",
    "resource": "<openai-resource-name>",
    "deployment": "<model-deployment-name>"
  },
  "staticWebApp": {
    "subscription": "<subscription-id>",
    "group": "<static-web-app-resource-group>",
    "project": "<static-web-app-name>"
  }
}
```

`node scripts/azure-demo.cjs verify-ai` makes a small, billable Responses API
call. It obtains the endpoint and key of the selected Azure resource and keeps
the key in memory. `node scripts/azure-demo.cjs verify-hosting` replaces the
configured app's test environment with a synthetic test page and verifies the
served content. Point it at a dedicated test app. The receipt is stored in
`.cache/azure-demo-hosting-receipt.json`.

To reinstall the local hosting tool on another checkout:

```sh
npm install --prefix .cache/azure-demo-tools --no-save --package-lock=false @azure/static-web-apps-cli@2.1.0
```

## Azure requirements before recording

1. Sign in to Azure CLI with `az login --tenant <tenant-id>` and complete
   authentication in your browser.
2. Confirm the exact tenant and subscription. Pass `--subscription <id>` to
   preparation commands rather than changing the machine's default subscription.
3. Use your resource endpoint and deployment name with the Responses format.
4. Enter that resource's API key directly in Aura's credential window. Keep it
   out of chat, source files, terminal arguments and the video. If the resource
   disables API keys or requires a private network, resolve that with the Azure
   administrator; a browser login alone does not supply an API key to Aura.
5. Select the dedicated Static Web App created above. Aura selects an existing
   Static Web App; its current wizard does not provision one.
6. Use only fictional app data. The demo URL can be publicly reachable. The
   Azure OpenAI key belongs in Aura and is never part of the published frontend.

Model usage follows your Azure subscription's billing. Confirm model pricing, quotas,
hosting plan and applicable policies before provisioning or rehearsing.

## Suggested app and prompt

Create a new, separate project, then use this prompt in Aura:

> Byg en lille dansk mødelokalefinder til en demonstrationsvideo. Brug kun
> opdigtede data: seks mødelokaler med navn, antal pladser, bygning og udstyr.
> Vis overskuelige kort, søgning, filter for minimum antal pladser og projektor,
> en tydelig tom tilstand og en nulstil-knap. Lav et pænt responsivt design med
> almindelig HTML, CSS og JavaScript uden eksterne afhængigheder. Læg alle
> webfiler i public/, med public/index.html som indgang. Ingen login, database,
> booking, eksterne API-kald eller hemmeligheder. Data skal være indbygget i
> appen. Den skal kunne udgives direkte på Azure Static Web Apps. Byg appen nu,
> og bed om de nødvendige filgodkendelser.

This uses AI to build the app. The deployed room finder itself does not call AI.

## Recording sequence

1. Show Aura's setup and choose **Azure OpenAI / Microsoft Foundry**. Show the
   endpoint and deployment name if appropriate for the audience. Enter the key off camera, then show
   the successful connection check and selected model.
2. Submit the prompt, approve file changes, and show the resulting preview.
3. Try the capacity filter, projector filter, empty state and reset.
4. Ask for one visible change, such as a new heading, and show it taking effect.
5. Save a version in Aura. Publishing requires a clean, saved Git version;
   files that only exist as unsaved changes are not uploaded.
6. Enable **Deling og udgivelse** under **Indstillinger → Funktioner** if needed.
   Open the publishing flow, choose Azure, select your non-production
   subscription and the dedicated Static Web App, and choose static files in
   `public`.
7. Review the version, destination and file list, then publish. Aura uploads to
   the named `harness-test` environment; SWA may report it as `harnesstest`.
   Use the URL returned for that environment, not the production hostname.
8. Wait for the completed result, open the returned link in Chrome, reload and
   repeat a filter interaction. Show the same resource in your Azure portal.

Before filming, rehearse the actual model build and deployment end to end.
Keep a generated project as a recovery copy, but distinguish any cut or reused
result from a fresh live generation. The built-in **Prøv et eksempel** mode uses
fixed responses and is not evidence of a live Azure OpenAI build.

## Official references

- [Azure OpenAI Responses API](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/responses)
- [Install Static Web Apps CLI](https://learn.microsoft.com/en-us/azure/static-web-apps/static-web-apps-cli-install)
- [Deploy with SWA CLI](https://learn.microsoft.com/en-us/azure/static-web-apps/static-web-apps-cli-deploy)
- [Static Web Apps plans](https://learn.microsoft.com/en-us/azure/static-web-apps/plans)
