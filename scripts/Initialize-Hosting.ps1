param(
    [string]$ProjectName = 'muhammetozeski-interlock-expeditions',
    [string]$DatabaseName = 'interlock-expeditions',
    [string]$Repository = 'muhammetozeski/InterlockExpeditions'
)
# Owner-run setup: create this product's free Pages/D1 resources, bind its database and set deployment credentials.
# Run once before the first publication; rerun only to restore missing resource configuration or apply a schema addition.
# Required process variables: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Credentials are never written to source.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $env:CLOUDFLARE_API_TOKEN -or -not $env:CLOUDFLARE_ACCOUNT_ID) { throw 'Set the two Cloudflare process credentials before running this owner setup.' }
$cloudHeaders = @{ Authorization = "Bearer $env:CLOUDFLARE_API_TOKEN" }
$accountRoot = "https://api.cloudflare.com/client/v4/accounts/$env:CLOUDFLARE_ACCOUNT_ID"
function Invoke-Cloud {
    param([string]$Path, [string]$Method = 'GET', [object]$Body)
    $parameters = @{ Uri = "$accountRoot/$Path"; Method = $Method; Headers = $cloudHeaders }
    if ($null -ne $Body) { $parameters.ContentType = 'application/json'; $parameters.Body = $Body | ConvertTo-Json -Depth 30 -Compress }
    $response = Invoke-RestMethod @parameters
    if (-not $response.success) { throw 'Cloudflare rejected this resource operation.' }
    return $response.result
}
$metadataPath = Join-Path $projectRoot 'hosting.json'
if (Test-Path -LiteralPath $metadataPath) {
    $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
    if ($metadata.project -ne $ProjectName -or $metadata.accountId -ne $env:CLOUDFLARE_ACCOUNT_ID) { throw 'Existing hosting metadata belongs to a different target. Preserve it and choose its actual configuration.' }
    $databaseId = $metadata.databaseId
} else {
    $createdDatabase = Invoke-Cloud -Path 'd1/database' -Method 'POST' -Body @{ name = $DatabaseName }
    $databaseId = $createdDatabase.uuid
    @{ project = $ProjectName; databaseName = $DatabaseName; databaseId = $databaseId; accountId = $env:CLOUDFLARE_ACCOUNT_ID } | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding utf8
}
$database = Invoke-Cloud -Path "d1/database/$databaseId"
if ($database.name -ne $DatabaseName) { throw 'The existing D1 identifier does not match this product database.' }
$pages = $null
try { $pages = Invoke-Cloud -Path "pages/projects/$ProjectName" } catch { if ($_.Exception.Response.StatusCode -ne 404) { throw } }
if ($null -eq $pages) {
    $salt = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $pages = Invoke-Cloud -Path 'pages/projects' -Method 'POST' -Body @{ name = $ProjectName; production_branch = 'main'; build_config = @{ destination_dir = 'public' }; deployment_configs = @{ production = @{ compatibility_date = '2026-10-01'; d1_databases = @{ DB = @{ id = $databaseId } }; env_vars = @{ PRIVATE_SALT = @{ type = 'secret_text'; value = $salt } } } } }
} else {
    # Patch only the intended binding. Never replay redacted secret values from a Pages GET response.
    $null = Invoke-Cloud -Path "pages/projects/$ProjectName" -Method 'PATCH' -Body @{ deployment_configs = @{ production = @{ d1_databases = @{ DB = @{ id = $databaseId } } } } }
}
$schema = Get-Content -LiteralPath (Join-Path $projectRoot 'schema/001-core.sql') -Raw
$null = Invoke-Cloud -Path "d1/database/$databaseId/query" -Method 'POST' -Body @{ sql = $schema }
@"
name = "$ProjectName"
compatibility_date = "2026-10-01"
pages_build_output_dir = "public"

[[d1_databases]]
binding = "DB"
database_name = "$DatabaseName"
database_id = "$databaseId"
"@ | Set-Content -LiteralPath (Join-Path $projectRoot 'wrangler.toml') -Encoding utf8
$env:CLOUDFLARE_API_TOKEN | gh secret set CLOUDFLARE_API_TOKEN --repo $Repository
$env:CLOUDFLARE_ACCOUNT_ID | gh secret set CLOUDFLARE_ACCOUNT_ID --repo $Repository
if ($LASTEXITCODE -ne 0) { throw 'The repository deployment credential could not be configured.' }
Write-Output "Hosting initialized for $ProjectName. Database binding and schema are present; no publication is claimed until a deployment succeeds."
