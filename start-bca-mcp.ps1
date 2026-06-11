# ============================================================
# BCA Salesforce MCP - Startup Script
# Double-click this after every reboot to get Claude connected
# Location: C:\Users\JamesBianchi\bca-salesforce-mcp\start-bca-mcp.ps1
# ============================================================

$ProjectDir = "C:\Users\JamesBianchi\bca-salesforce-mcp"
$NgrokApi   = "http://127.0.0.1:4040/api/tunnels"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BCA Salesforce MCP - Starting Up" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host ">> Starting Node server..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList `
  "-NoExit", "-Command", `
  "cd '$ProjectDir'; node server.js" `
  -WindowStyle Normal

Start-Sleep -Seconds 3

Write-Host ">> Starting ngrok tunnel..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList `
  "-NoExit", "-Command", `
  "ngrok http 3000" `
  -WindowStyle Normal

Write-Host ">> Waiting for ngrok tunnel to establish..." -ForegroundColor Yellow
$NgrokUrl = $null
$Attempts = 0

while (-not $NgrokUrl -and $Attempts -lt 15) {
    Start-Sleep -Seconds 2
    $Attempts++
    try {
        $Tunnels  = Invoke-RestMethod -Uri $NgrokApi -ErrorAction Stop
        $NgrokUrl = ($Tunnels.tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1).public_url
    } catch {}
}

if (-not $NgrokUrl) {
    Write-Host "ERROR: Could not get ngrok URL." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

$MpcEndpoint = "$NgrokUrl/sse"
$MpcEndpoint | Set-Clipboard

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  SUCCESS - Both servers are running!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  MCP URL (copied to clipboard): $MpcEndpoint" -ForegroundColor White
Write-Host ""
Write-Host "  In Claude: Customize -> Connectors -> edit bca-salesforce -> Paste -> Save" -ForegroundColor Yellow
Write-Host ""
Read-Host "Press Enter to close this window (servers keep running)"