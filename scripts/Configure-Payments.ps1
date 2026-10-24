param([string]$ProjectName = 'muhammetozeski-interlock-expeditions')
# Explicit owner operation. Values are supplied through this process environment, never source or arguments.
$ErrorActionPreference = 'Stop'
foreach ($name in @('CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_CLUB_PRICE')) {
    if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) { throw "Supply $name in the owner process environment before configuring payments." }
}
if ($env:STRIPE_SECRET_KEY -notmatch '^sk_live_[A-Za-z0-9]+$' -or $env:STRIPE_WEBHOOK_SECRET -notmatch '^whsec_[A-Za-z0-9]+$' -or $env:STRIPE_CLUB_PRICE -notmatch '^price_[A-Za-z0-9]+$') { throw 'Only actual live-mode Stripe configuration is accepted.' }
$price = Invoke-RestMethod -Uri "https://api.stripe.com/v1/prices/$env:STRIPE_CLUB_PRICE" -Headers @{ Authorization = "Bearer $env:STRIPE_SECRET_KEY"; 'Stripe-Version' = '2024-06-20' }
if (-not $price.active -or -not $price.livemode -or $price.type -ne 'recurring' -or $price.unit_amount -le 0 -or $price.recurring.interval -notin @('month','year')) { throw 'Choose an active live recurring monthly or yearly Club price.' }
$variables = @{}
foreach ($name in @('STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_CLUB_PRICE')) { $variables[$name] = @{ type = 'secret_text'; value = [Environment]::GetEnvironmentVariable($name, 'Process') } }
$payload = @{ deployment_configs = @{ production = @{ env_vars = $variables } } } | ConvertTo-Json -Depth 12 -Compress
$result = Invoke-RestMethod -Method Patch -Uri "https://api.cloudflare.com/client/v4/accounts/$env:CLOUDFLARE_ACCOUNT_ID/pages/projects/$ProjectName" -Headers @{ Authorization = "Bearer $env:CLOUDFLARE_API_TOKEN" } -ContentType 'application/json' -Body $payload
if (-not $result.success) { throw 'The provider configuration was not stored.' }
Write-Output 'Live payment variables stored without printing values. Publish a new deployment, configure the Stripe webhook and portal, then verify an actual provider event before selling Club capacity.'
