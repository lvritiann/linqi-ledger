<#
.SYNOPSIS
  临期台账中转云函数 linqi-relay 的一键部署与健康检查脚本。

.DESCRIPTION
  前置条件：本机安装 tccli（pip install tccli）并完成 tccli configure。
  令牌来源优先级：环境变量 KDOCS_TOKEN > 交接文档「AirScript 令牌」行。
  KDOCS_URL 来源优先级：环境变量 KDOCS_URL > 交接文档「webhook 完整地址」行。
  脚本不会把令牌写入任何文件，也不会在控制台打印令牌值。

.EXAMPLE
  # 只读探测：只调 ListFunctions / ListTriggers，不创建或修改云资源
  .\deploy-linqi-relay.ps1 -DryRun

.EXAMPLE
  # 正式部署：令牌由用户在会话中设置为环境变量，脚本不落盘
  $env:KDOCS_TOKEN = '<由用户自行设置，勿写入文件>'
  .\deploy-linqi-relay.ps1
#>
[CmdletBinding()]
param(
  [string]$Region = 'ap-guangzhou',
  [string]$FunctionName = 'linqi-relay',
  [string]$ZipPath = (Join-Path $PSScriptRoot 'linqi-relay.zip'),
  [string]$HandoffDoc = 'D:\加油站综合考核系统\docs\项目交接文档.md',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Step([string]$msg) { Write-Host "[步骤] $msg" -ForegroundColor Cyan }
function Ok([string]$msg)   { Write-Host "[通过] $msg" -ForegroundColor Green }
function Warn([string]$msg) { Write-Host "[警告] $msg" -ForegroundColor Yellow }

function Invoke-Tccli {
  param([Parameter(Mandatory = $true)][string[]]$TccliArgs)
  $out = & tccli @TccliArgs
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    throw ("tccli 调用失败，退出码 {0}：{1}`n原始输出：{2}" -f $code, ($TccliArgs -join ' '), ($out -join "`n"))
  }
  return ($out -join "`n")
}

function Get-MarkedValue {
  param([string]$Path, [string]$Marker)
  if (-not (Test-Path -LiteralPath $Path)) { throw "交接文档不存在：$Path" }
  $line = Get-Content -LiteralPath $Path -Encoding UTF8 |
    Where-Object { $_.Contains($Marker) } | Select-Object -First 1
  if (-not $line) { throw "交接文档未找到标记行：$Marker" }
  $m = [regex]::Match($line, '`([^`]+)`')
  if (-not $m.Success) { throw "标记行内未找到反引号包裹的值：$Marker" }
  return $m.Groups[1].Value
}

function Get-FunctionUrl {
  param([string]$Raw)
  $m = [regex]::Match($Raw, 'https://[A-Za-z0-9][A-Za-z0-9._-]*\.tencentscf\.com')
  if ($m.Success) { return $m.Value }
  return ''
}

# ---------- 0. 前置检查 ----------
if (-not (Get-Command tccli -ErrorAction SilentlyContinue)) {
  throw '未检测到 tccli。请先安装：pip install tccli，再执行 tccli configure 配置 SecretId/SecretKey。'
}
if (-not (Test-Path -LiteralPath $ZipPath)) { throw "部署包不存在：$ZipPath" }

Step '校验部署包结构（zip 根目录必须只有 index.js）'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try { $names = @($zip.Entries | ForEach-Object { $_.FullName }) } finally { $zip.Dispose() }
if ($names.Count -ne 1 -or $names[0] -ne 'index.js') {
  throw "部署包结构异常，期望仅根目录 index.js，实际：$($names -join ', ')"
}
Ok '部署包结构正确'

# ---------- 1. 只读探测（DryRun 到此为止）----------
Step "只读探测 $Region 地域函数列表（同时验证凭据）"
$funcRaw = Invoke-Tccli @('scf', 'ListFunctions', '--region', $Region)
$exists = $false
try {
  $obj = $funcRaw | ConvertFrom-Json
  $list = $obj.Response.Functions
  if ($null -eq $list) { $list = $obj.Response.FunctionList }
  if ($null -ne $list) {
    $exists = @($list | Where-Object { $_.FunctionName -eq $FunctionName }).Count -gt 0
  }
} catch {
  Warn "ListFunctions 解析失败，改用文本匹配：$($_.Exception.Message)"
  $exists = $funcRaw.Contains('"FunctionName":"' + $FunctionName + '"') -or
            $funcRaw.Contains('"FunctionName": "' + $FunctionName + '"')
}
Ok ("函数 {0}：{1}" -f $FunctionName, $(if ($exists) { '已存在，将执行更新' } else { '不存在，将执行创建' }))

if ($DryRun) {
  Step 'DryRun 模式：仅探测，不创建/修改任何云资源'
  $trig = Invoke-Tccli @('scf', 'ListTriggers', '--region', $Region, '--FunctionName', $FunctionName)
  $u = Get-FunctionUrl $trig
  if ($u) { Ok "现有函数 URL：$u" } else { Warn '当前没有函数 URL 触发器' }
  return
}

# ---------- 2. 读取令牌与 webhook（不在控制台展示值）----------
Step '读取 KDOCS_TOKEN 与 KDOCS_URL（值不展示）'
$kdocsToken = $env:KDOCS_TOKEN
if ([string]::IsNullOrWhiteSpace($kdocsToken)) {
  $kdocsToken = Get-MarkedValue -Path $HandoffDoc -Marker '| **AirScript 令牌** |'
  Ok '令牌来源：交接文档（未展示）'
} else {
  Ok '令牌来源：环境变量 KDOCS_TOKEN（未展示）'
}
$kdocsUrl = $env:KDOCS_URL
if ([string]::IsNullOrWhiteSpace($kdocsUrl)) {
  $kdocsUrl = Get-MarkedValue -Path $HandoffDoc -Marker '| **webhook 完整地址** |'
  Ok 'KDOCS_URL 来源：交接文档（未展示）'
} else {
  Ok 'KDOCS_URL 来源：环境变量 KDOCS_URL（未展示）'
}
if ([string]::IsNullOrWhiteSpace($kdocsToken) -or [string]::IsNullOrWhiteSpace($kdocsUrl)) {
  throw '令牌或 KDOCS_URL 为空，终止部署'
}

# ---------- 3. 创建或更新函数 ----------
$envJson = @{ Variables = @(
  @{ Key = 'KDOCS_URL';      Value = $kdocsUrl },
  @{ Key = 'KDOCS_TOKEN';    Value = $kdocsToken },
  @{ Key = 'ASYNC_POLL_SEC'; Value = '110' },
  @{ Key = 'TIMEOUT_SEC';    Value = '20' },
  @{ Key = 'ALLOW_ORIGIN';   Value = '*' }
) } | ConvertTo-Json -Compress -Depth 6
$zipB64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($ZipPath))

if (-not $exists) {
  Step '创建云函数'
  $codeJson = @{ ZipFile = $zipB64 } | ConvertTo-Json -Compress
  Invoke-Tccli @('scf', 'CreateFunction', '--region', $Region, '--FunctionName', $FunctionName,
    '--Runtime', 'Nodejs24.11', '--Handler', 'index.main_handler', '--Code', $codeJson,
    '--Timeout', '120', '--MemorySize', '128', '--Environment', $envJson) | Out-Null
  Ok '函数已创建'
} else {
  Step '更新函数代码与配置（保留既有函数 URL）'
  Invoke-Tccli @('scf', 'UpdateFunctionCode', '--region', $Region, '--FunctionName', $FunctionName,
    '--ZipFile', $zipB64) | Out-Null
  Invoke-Tccli @('scf', 'UpdateFunctionConfiguration', '--region', $Region, '--FunctionName', $FunctionName,
    '--Handler', 'index.main_handler', '--Timeout', '120', '--MemorySize', '128',
    '--Environment', $envJson) | Out-Null
  Ok '函数代码与配置已更新'
}

# ---------- 4. 函数 URL ----------
Step '检查/创建函数 URL（别名 $LATEST、公网、开放授权、CORS 关）'
$trig = Invoke-Tccli @('scf', 'ListTriggers', '--region', $Region, '--FunctionName', $FunctionName)
$url = Get-FunctionUrl $trig
if (-not $url) {
  $triggerDesc = @{ AuthType = 'NONE'; NetConfig = @{ EnableIntranet = $false; EnableExtranet = $true } } |
    ConvertTo-Json -Compress -Depth 5
  Invoke-Tccli @('scf', 'CreateTrigger', '--region', $Region, '--FunctionName', $FunctionName,
    '--TriggerName', 'linqi_relay_url', '--Type', 'http', '--TriggerDesc', $triggerDesc,
    '--Enable', 'OPEN', '--Qualifier', '$LATEST', '--Namespace', 'default') | Out-Null
  for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 3
    $trig = Invoke-Tccli @('scf', 'ListTriggers', '--region', $Region, '--FunctionName', $FunctionName)
    $url = Get-FunctionUrl $trig
    if ($url) { break }
  }
}
if (-not $url) { throw '未能从 ListTriggers 获取函数 URL，请到控制台「函数 URL」页确认' }
Ok "函数 URL：$url"

# ---------- 5. 健康检查 ----------
Step 'GET 健康检查（version / hasTarget / hasToken）'
$healthOk = $false
for ($i = 0; $i -lt 5; $i++) {
  try {
    $r = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 20
    $verOk = ($r.version -eq '2.0-async')
    $tOk = ($r.hasTarget -eq $true) -or ($r.hasTarget -eq 'true')
    $kOk = ($r.hasToken -eq $true) -or ($r.hasToken -eq 'true')
    if ($verOk -and $tOk -and $kOk) {
      $healthOk = $true
      Ok ("健康检查通过：version={0} hasTarget={1} hasToken={2} pollSec={3}" -f `
        $r.version, $r.hasTarget, $r.hasToken, $r.pollSec)
      break
    }
    Warn ("返回内容不符合预期：version={0} hasTarget={1} hasToken={2}" -f `
      $r.version, $r.hasTarget, $r.hasToken)
  } catch {
    Warn ("第 {0} 次健康检查失败：{1}" -f ($i + 1), $_.Exception.Message)
  }
  Start-Sleep -Seconds 5
}
if (-not $healthOk) { throw '健康检查未通过。请先到控制台排查，不要修改前端 config.js' }

Write-Host ''
Ok '部署完成。请把函数 URL 填入 D:\非油临期管理\js\config.js 的 report.url：'
Write-Host "  $url" -ForegroundColor White
Ok "report.token 必须保持 ''（留空）。随后 commit/push config.js 即可上线。"
