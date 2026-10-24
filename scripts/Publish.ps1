param([switch]$NoRestore, [string]$BasePath = '/', [string]$Destination, [string]$Output)
# Build command for local verification and CI. Uses .NET 10 and copies only compiled public web assets.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceProject = Join-Path $projectRoot 'src/InterlockExpeditions.Portal/InterlockExpeditions.Portal.csproj'
if (!$BasePath.StartsWith('/') -or !$BasePath.EndsWith('/') -or $BasePath.Contains('//') -or $BasePath.Split('/').Where({ $_ -and ($_.ToCharArray().Where({ ![char]::IsAsciiLetterOrDigit($_) -and $_ -ne '-' -and $_ -ne '_' }).Count -gt 0) }).Count -gt 0) { throw 'BasePath must be / or an absolute slash-terminated application path.' }
if ($BasePath -ne '/' -and !$Destination) { throw 'A mounted build requires an explicit Destination; the standalone public directory is preserved.' }
$publishRoot = if ($Output) { [IO.Path]::GetFullPath($Output) } else { Join-Path $projectRoot 'publish/Portal' }
$publishArguments = @('publish', $sourceProject, '-c', 'Release', '-o', $publishRoot, '--nologo')
if ($NoRestore) { $publishArguments += '--no-restore' }
dotnet @publishArguments
if ($LASTEXITCODE -ne 0) { throw 'The portal publication failed.' }
$publicRoot = if ($Destination) { [IO.Path]::GetFullPath($Destination) } else { Join-Path $projectRoot 'public' }
New-Item -ItemType Directory -Path $publicRoot -Force | Out-Null
Copy-Item -Path (Join-Path $publishRoot 'wwwroot/*') -Destination $publicRoot -Recurse -Force
$entry = Join-Path $publicRoot 'index.html'
[IO.File]::WriteAllText($entry, [IO.File]::ReadAllText($entry).Replace('<base href="/">', '<base href="' + $BasePath + '">'))
$redirects = @()
if ($BasePath -ne '/') { $redirects += $BasePath.TrimEnd('/') + ' ' + $BasePath + ' 301' }
foreach ($route in @('host','account','help','privacy','membership','control/:roomId','room/:roomId')) { $redirects += $BasePath + $route + ' ' + $BasePath + 'index.html 200' }
[IO.File]::WriteAllLines((Join-Path $publicRoot '_redirects'), $redirects)
$headers = Get-Content -LiteralPath (Join-Path $projectRoot 'public/_headers')
$scopedHeaders = foreach ($line in $headers) { if ($line.StartsWith('/')) { $BasePath + $line.TrimStart('/') } else { $line } }
[IO.File]::WriteAllLines((Join-Path $publicRoot '_headers'), $scopedHeaders)
Write-Output "Compiled the browser portal for $BasePath into $publicRoot."
