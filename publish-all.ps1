[CmdletBinding()]
param(
  [switch]$NoPause
)

$ErrorActionPreference = "Stop"
$exitCode = 0
$root = $PSScriptRoot
$repoMeta = Join-Path $env:TEMP "codex-fukuyaku-kanri-repo"
$remoteUrl = "https://github.com/yosshy12/fukuyaku-kanri.git"

function Resolve-Executable {
  param(
    [Parameter(Mandatory = $true)][string]$CommandName,
    [Parameter(Mandatory = $true)][string[]]$Candidates
  )

  $command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  foreach ($candidate in $Candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  throw "$CommandName was not found."
}

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Executable failed with exit code $LASTEXITCODE."
  }
}

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  $baseArguments = @("--git-dir=$repoMeta", "--work-tree=$root")
  Invoke-External -Executable $script:gitExe -Arguments ($baseArguments + $Arguments)
}

function Prepare-GitRepository {
  New-Item -ItemType Directory -Force -Path $repoMeta | Out-Null

  if (-not (Test-Path -LiteralPath (Join-Path $repoMeta "HEAD"))) {
    Invoke-External -Executable $script:gitExe -Arguments @(
      "--git-dir=$repoMeta",
      "--work-tree=$root",
      "init",
      "-b",
      "main"
    )
  }

  Invoke-Git config user.name "yosshy12"
  Invoke-Git config user.email "129061116+yosshy12@users.noreply.github.com"
  Invoke-Git config credential.helper manager
  Invoke-Git config http.sslBackend openssl

  $remotes = & $script:gitExe "--git-dir=$repoMeta" "--work-tree=$root" remote
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect Git remotes."
  }
  if ($remotes -contains "origin") {
    Invoke-Git remote set-url origin $remoteUrl
  } else {
    Invoke-Git remote add origin $remoteUrl
  }

  Write-Host "Fetching the current GitHub version..."
  Invoke-Git fetch origin main
  Invoke-Git update-ref refs/heads/main refs/remotes/origin/main
  Invoke-Git symbolic-ref HEAD refs/heads/main
  Invoke-Git read-tree refs/remotes/origin/main
}

function Test-AppsScriptChanges {
  $paths = @("apps-script", ".clasp-personal.json", ".clasp-mother.json")
  $arguments = @("--git-dir=$repoMeta", "--work-tree=$root", "status", "--porcelain", "--") + $paths
  $changes = & $script:gitExe @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect Apps Script changes."
  }
  return [bool]$changes
}

function Publish-AppsScriptProject {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$ProjectFile,
    [Parameter(Mandatory = $true)][string]$DeploymentId
  )

  Write-Host ""
  Write-Host "Updating Apps Script: $Label"
  Invoke-External -Executable $script:claspExe -Arguments @(
    "--project",
    (Join-Path $root $ProjectFile),
    "push",
    "--force"
  )

  $description = "Automatic update " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
  Invoke-External -Executable $script:claspExe -Arguments @(
    "--project",
    (Join-Path $root $ProjectFile),
    "create-deployment",
    "--deploymentId",
    $DeploymentId,
    "--description",
    $description
  )
}

function Publish-GitHub {
  Write-Host ""
  Write-Host "Uploading the app to GitHub..."
  Invoke-Git add --all -- .

  & $script:gitExe "--git-dir=$repoMeta" "--work-tree=$root" diff --cached --quiet
  if ($LASTEXITCODE -eq 1) {
    Invoke-Git commit -m "Update medication management app"
  } elseif ($LASTEXITCODE -ne 0) {
    throw "Could not inspect staged GitHub changes."
  } else {
    Write-Host "GitHub already has the current files."
  }

  Invoke-Git push -u origin main
}

try {
  Set-Location -LiteralPath $root

  $script:gitExe = Resolve-Executable -CommandName "git.exe" -Candidates @(
    "C:\Program Files\Git\cmd\git.exe",
    "C:\Users\black\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe"
  )
  $script:claspExe = Resolve-Executable -CommandName "clasp.cmd" -Candidates @(
    (Join-Path $env:APPDATA "npm\clasp.cmd")
  )

  Prepare-GitRepository

  if (Test-AppsScriptChanges) {
    Invoke-External -Executable $script:claspExe -Arguments @("show-authorized-user", "--json")
    Publish-AppsScriptProject `
      -Label "personal" `
      -ProjectFile ".clasp-personal.json" `
      -DeploymentId "AKfycbxoiWjpphycSCKNHmdYeF_Lg8Rkf8g4CEU7cf6w1n9Ng_FcRJa37RDCG6mjR4EcFrd-jQ"
    Publish-AppsScriptProject `
      -Label "mother" `
      -ProjectFile ".clasp-mother.json" `
      -DeploymentId "AKfycbwMi9a69bPThyai7cEnryVBRztxh4dYlHywIQLlEnZVZZ4YClgcxtzxjBLvA684Ic04dQ"
  } else {
    Write-Host "Apps Script has no changes. Deployment was skipped."
  }

  Publish-GitHub

  Write-Host ""
  Write-Host "SUCCESS: GitHub Pages and both Apps Script apps are up to date."
} catch {
  Write-Host ""
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Leave this window open and tell Codex what is displayed."
  $exitCode = 1
} finally {
  Set-Location -LiteralPath $root
  if (-not $NoPause) {
    Write-Host ""
    Read-Host "Press Enter to close"
  }
}

exit $exitCode
