param([switch]$NoRestore)
# Build command for local verification and CI. Uses .NET 10 and copies only compiled public web assets.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceProject = Join-Path $projectRoot 'src/InterlockExpeditions.Portal/InterlockExpeditions.Portal.csproj'
$publishRoot = Join-Path $projectRoot 'publish/Portal'
$publishArguments = @('publish', $sourceProject, '-c', 'Release', '-o', $publishRoot, '--nologo')
if ($NoRestore) { $publishArguments += '--no-restore' }
dotnet @publishArguments
if ($LASTEXITCODE -ne 0) { throw 'The portal publication failed.' }
$publicRoot = Join-Path $projectRoot 'public'
New-Item -ItemType Directory -Path $publicRoot -Force | Out-Null
Copy-Item -Path (Join-Path $publishRoot 'wwwroot/*') -Destination $publicRoot -Recurse -Force
Write-Output 'Compiled the independent browser portal into public.'
