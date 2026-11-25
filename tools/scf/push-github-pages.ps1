<#
.SYNOPSIS
  将 linqi-ledger 本地提交推送到 GitHub Pages 仓库。

.DESCRIPTION
  PAT 只从环境变量 GITHUB_PAT 读取，通过临时 credential helper 传递，
  不写入 .git/config，不写入任何脚本或提交物。
  显式使用 HTTP/1.1，规避代理环境下 HTTP/2 大包推送被中断（SIGTERM）的问题。
  若连续失败，按部署方案改用 mcp__github push_files 逐文件同步兜底。

.EXAMPLE
  $env:GITHUB_PAT = '<由用户自行设置，勿写入文件>'
  .\push-github-pages.ps1 -DryRun   # 只看待推送提交
  .\push-github-pages.ps1           # 正式推送
#>
[CmdletBinding()]
param(
  [string]$RepoPath = 'D:\非油临期管理',
  [string]$RemoteUrl = 'https://github.com/lvritiann/linqi-ledger.git',
  [string]$Branch = 'main',
  [int]$Retries = 3,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$pat = $env:GITHUB_PAT
if ([string]::IsNullOrWhiteSpace($pat)) { throw '请先设置环境变量 GITHUB_PAT（不要写入任何文件）' }

# 单引号保证 $GITHUB_PAT 是字面量，由 git 调用的 shell 在运行时展开
$helper = '!f() { echo username=x-access-token; echo password=$GITHUB_PAT; }; f'

Push-Location -LiteralPath $RepoPath
try {
  $dirty = git status --porcelain
  if ($dirty) { throw "工作区不干净，请先提交或暂存：`n$dirty" }

  $pending = git log --oneline ("{0}..{1}" -f ("origin/" + $Branch), $Branch)
  if ($DryRun) {
    Write-Host "[预览] 待推送提交：`n$pending"
    return
  }
  if (-not $pending) { Write-Host '[提示] 没有待推送提交'; return }

  $ok = $false
  for ($i = 1; $i -le $Retries; $i++) {
    Write-Host ("[推送] 第 {0}/{1} 次（HTTP/1.1）..." -f $i, $Retries)
    & git -c http.version=HTTP/1.1 -c "credential.helper=$helper" push $RemoteUrl ("{0}:{1}" -f $Branch, $Branch)
    if ($LASTEXITCODE -eq 0) { $ok = $true; break }
    Write-Warning ("推送失败，退出码 {0}" -f $LASTEXITCODE)
  }
  if (-not $ok) { throw '推送失败。兜底：改用 mcp__github push_files 逐文件同步（见部署方案第 4 节）' }
  Write-Host '[通过] 推送完成'
} finally {
  Pop-Location
}
