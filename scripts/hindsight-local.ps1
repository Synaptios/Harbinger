#Requires -Version 7.5

param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8888
)

$ErrorActionPreference = 'Stop'
$repoDirectory = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $repoDirectory '.harbinger/hindsight'
New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null

$venv = Join-Path $runtimeDirectory 'venv'
$python = Join-Path $venv 'Scripts/python.exe'
if (!(Test-Path -LiteralPath $python)) {
    uv venv --python 3.12 $venv
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
uv pip install --quiet --python $python 'hindsight-api-slim[embedded-db,local-onnx]==1.2.2'
if ($LASTEXITCODE) { exit $LASTEXITCODE }

$tokenPath = Join-Path $runtimeDirectory 'api-key'
if (!(Test-Path -LiteralPath $tokenPath)) {
    $tokenBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    [IO.File]::WriteAllText($tokenPath, [Convert]::ToBase64String($tokenBytes))
}

$env:PG0_HOME = Join-Path $runtimeDirectory 'pg0'
$env:PG0_INSTALLATION_DIR = Join-Path $runtimeDirectory 'postgres'
$env:HF_HOME = Join-Path $runtimeDirectory 'models'
$env:HF_HUB_DISABLE_TELEMETRY = '1'
$env:PYTHON_DOTENV_DISABLED = '1'
$env:HINDSIGHT_API_DATABASE_URL = 'pg0://harbinger-onnx'
$env:HINDSIGHT_API_TENANT_EXTENSION = 'hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension'
$env:HINDSIGHT_API_TENANT_API_KEY = [IO.File]::ReadAllText($tokenPath).Trim()
$env:HINDSIGHT_API_MCP_ENABLED = 'false'
$env:HINDSIGHT_API_LLM_PROVIDER = 'none'
$env:HINDSIGHT_API_RETAIN_EXTRACTION_MODE = 'chunks'
$env:HINDSIGHT_API_ENABLE_OBSERVATIONS = 'false'
$env:HINDSIGHT_API_ENABLE_AUTO_CONSOLIDATION = 'false'
$env:HINDSIGHT_API_EMBEDDINGS_PROVIDER = 'onnx'
$env:HINDSIGHT_API_EMBEDDINGS_ONNX_MODEL_ID = 'Xenova/bge-small-en-v1.5'
$env:HINDSIGHT_API_EMBEDDINGS_ONNX_FILE = 'onnx/model_quantized.onnx'
$env:HINDSIGHT_API_EMBEDDINGS_ONNX_POOLING = 'cls'
$env:HINDSIGHT_API_EMBEDDINGS_ONNX_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '
$env:HINDSIGHT_API_EMBEDDINGS_ONNX_PASSAGE_PREFIX = ''
$env:HINDSIGHT_API_RERANKER_PROVIDER = 'rrf'

Push-Location -LiteralPath $runtimeDirectory
try {
    & (Join-Path $venv 'Scripts/hindsight-api.exe') --host 127.0.0.1 --port $Port --workers 1 --log-level warning
} finally {
    Pop-Location
}
exit $LASTEXITCODE
