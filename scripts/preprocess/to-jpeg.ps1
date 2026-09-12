# Export one image as JPEG (delivery copy) with optional downscale.
# Handy when the PNG master is a few MB and the chat / a client needs a light file.
#
#   powershell -NoProfile -File to-jpeg.ps1 -ImagePath in.png -OutputPath out.jpg [-Quality 88] [-Width 1600]
#
# Notes: JPEG has no alpha channel — transparent areas flatten onto -Background
# (default black). Use it for delivery copies only; keep the PNG as the master.
param(
  [Parameter(Mandatory = $true)][string]$ImagePath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [int]$Quality = 88,
  [int]$Width = 0,
  [string]$Background = "black"
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$source = [System.Drawing.Bitmap]::new($ImagePath)
try {
  $target = $source
  if ($Width -gt 0 -and $source.Width -gt $Width) {
    $height = [int][Math]::Round($source.Height * $Width / $source.Width)
    $scaled = New-Object System.Drawing.Bitmap $Width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($scaled)
    try {
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.DrawImage($source, 0, 0, $Width, $height)
    } finally { $graphics.Dispose() }
    $target = $scaled
  }

  $flat = New-Object System.Drawing.Bitmap $target.Width, $target.Height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $flatGraphics = [System.Drawing.Graphics]::FromImage($flat)
  try {
    $fill = [System.Drawing.Color]::Black
    if ($Background -match '^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$') {
      $fill = [System.Drawing.Color]::FromArgb(
        [Convert]::ToInt32($Matches[1], 16), [Convert]::ToInt32($Matches[2], 16), [Convert]::ToInt32($Matches[3], 16))
    }
    $brush = New-Object System.Drawing.SolidBrush $fill
    try { $flatGraphics.FillRectangle($brush, 0, 0, $flat.Width, $flat.Height) } finally { $brush.Dispose() }
    $flatGraphics.DrawImage($target, 0, 0, $target.Width, $target.Height)
  } finally { $flatGraphics.Dispose() }

  $directory = Split-Path $OutputPath -Parent
  if ($directory -and -not (Test-Path $directory)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
  $parameters = New-Object System.Drawing.Imaging.EncoderParameters 1
  $parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
  try { $flat.Save($OutputPath, $codec, $parameters) } finally { $parameters.Dispose() }

  $size = [math]::Round((Get-Item $OutputPath).Length / 1KB, 1)
  Write-Output ("OK: {0} ({1}x{2}, q{3}, {4} KB)" -f $OutputPath, $flat.Width, $flat.Height, $Quality, $size)
  if ($target -ne $source) { $target.Dispose() }
  $flat.Dispose()
} finally { $source.Dispose() }
