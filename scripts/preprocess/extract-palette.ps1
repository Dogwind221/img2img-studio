# Extract dominant colors: downscale -> RGB bucket histogram -> top-K buckets (avg color + coverage)
# Usage: pwsh extract-palette.ps1 -ImagePath <img> [-MaxColors 5] [-OutputJson]
param(
  [Parameter(Mandatory = $true)][string]$ImagePath,
  [int]$MaxColors = 5,
  [switch]$OutputJson
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$bmp = [System.Drawing.Bitmap]::new($ImagePath)
try {
  $scale = [Math]::Min(1.0, 200.0 / [Math]::Max($bmp.Width, $bmp.Height))
  $sw = [Math]::Max(1, [int]($bmp.Width * $scale))
  $sh = [Math]::Max(1, [int]($bmp.Height * $scale))
  $small = New-Object System.Drawing.Bitmap $sw, $sh
  $g = [System.Drawing.Graphics]::FromImage($small)
  $g.DrawImage($bmp, 0, 0, $sw, $sh)
  $g.Dispose()

  $bucket = @{}   # "r,g,b" -> count
  $step = [Math]::Max(1, [int](($sw * $sh) / 8000))
  for ($y = 0; $y -lt $sh; $y += $step) {
    for ($x = 0; $x -lt $sw; $x += $step) {
      $c = $small.GetPixel($x, $y)
      if ($c.A -lt 40) { continue }
      $r = [int]($c.R / 32); $g2 = [int]($c.G / 32); $b = [int]($c.B / 32)
      $key = "$r,$g2,$b"
      if ($bucket.ContainsKey($key)) { $bucket[$key]++ } else { $bucket[$key] = 1 }
    }
  }
  $small.Dispose()
  if ($bucket.Count -eq 0) { Write-Output '[]'; exit 0 }

  $top = $bucket.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First $MaxColors
  $total = 0.0
  foreach ($kv in $bucket.GetEnumerator()) { $total += $kv.Value }

  # Recompute exact avg color per selected bucket
  $out = @()
  foreach ($kv in $top) {
    $parts = $kv.Key -split ','
    $br = [int]$parts[0] * 32 + 16; $bg = [int]$parts[1] * 32 + 16; $bb = [int]$parts[2] * 32 + 16
    $hex = ("#{0:X2}{1:X2}{2:X2}" -f $br, $bg, $bb)
    $out += [PSCustomObject]@{
      hex = $hex
      rgb = "$br,$bg,$bb"
      coverage = [Math]::Round($kv.Value / $total, 4)
    }
  }
  if ($OutputJson) { Write-Output ($out | ConvertTo-Json -Compress) }
  else { Write-Output ($out | ConvertTo-Json) }
} finally { $bmp.Dispose() }
