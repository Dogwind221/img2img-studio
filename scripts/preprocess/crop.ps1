# Crop image by bounding box (pixel or normalized 0-1 coords)
# Usage: pwsh crop.ps1 -ImagePath <img> -OutputPath <out.png> [-X 0.1] [-Y 0.2] [-W 0.6] [-H 0.5] [-Pad 0]
param(
  [Parameter(Mandatory = $true)][string]$ImagePath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [double]$X = 0, [double]$Y = 0, [double]$W = 1, [double]$H = 1,
  [int]$Pad = 0
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Bitmap]::new($ImagePath)
try {
  $iw = $src.Width; $ih = $src.Height
  $toX = { param($v) if ($v -le 1.0) { [int][Math]::Floor($v * $iw) } else { [int]$v } }
  $toY = { param($v) if ($v -le 1.0) { [int][Math]::Floor($v * $ih) } else { [int]$v } }
  $x0 = [Math]::Max(0, (& $toX $X) - $Pad)
  $y0 = [Math]::Max(0, (& $toY $Y) - $Pad)
  $x1 = [Math]::Min($iw, (& $toX $X) + (& $toX $W) + $Pad)
  $y1 = [Math]::Min($ih, (& $toY $Y) + (& $toY $H) + $Pad)
  $cw = [Math]::Max(1, $x1 - $x0); $ch = [Math]::Max(1, $y1 - $y0)

  $rect = New-Object System.Drawing.Rectangle $x0, $y0, $cw, $ch
  $dst = $src.Clone($rect, $src.PixelFormat)
  $dir = Split-Path $OutputPath -Parent
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  if ($OutputPath -match "\.png$") { $dst.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png) }
  else { $dst.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Jpeg) }
  $dst.Dispose()
  Write-Output ("OK: " + $OutputPath + " (" + $x0 + "," + $y0 + ") " + $cw + "x" + $ch)
} finally { $src.Dispose() }
