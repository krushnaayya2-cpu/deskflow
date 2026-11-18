# Local Windows build: produces the .msi and setup .exe installers.
# Usage (PowerShell, from the repo root):   .\scripts\build.ps1
# Requires: Node.js 20+, Rust (rustup), and the Visual Studio C++ Build Tools.

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

foreach ($tool in "node", "npm", "cargo") {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Write-Error "$tool not found. Install Node.js (https://nodejs.org) and Rust (https://rustup.rs) first."
    }
}

Write-Host "==> Installing frontend dependencies" -ForegroundColor Cyan
npm ci

Write-Host "==> Running Rust tests" -ForegroundColor Cyan
Push-Location src-tauri
cargo test
Pop-Location

Write-Host "==> Building DeskFlow installers" -ForegroundColor Cyan
npx tauri build

$bundle = "src-tauri\target\release\bundle"
Write-Host ""
Write-Host "Done. Installers:" -ForegroundColor Green
Get-ChildItem "$bundle\msi\*.msi", "$bundle\nsis\*.exe" | ForEach-Object { "  " + $_.FullName }
