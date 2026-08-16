# Cutout: remove near-solid background (white/black/flat color) -> transparent PNG.
# Works for flat-background product shots. Complex backgrounds need AI matting (vision-toolkit / designkit / ChatGPT web).
# Usage: pwsh cutout.ps1 -ImagePath <img> -OutputPath <out.png> [-Tolerance 30] [-Feather 2] [-Background auto|white|black|#RRGGBB]
param(
  [Parameter(Mandatory = $true)][string]$ImagePath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [int]$Tolerance = 30,
  [int]$Feather = 2,
  [string]$Background = "auto"
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Bitmap]::new($ImagePath)
try {
  $w = $src.Width; $h = $src.Height
  if ($Background -eq "white") { $bg = @([int]255,[int]255,[int]255) }
  elseif ($Background -eq "black") { $bg = @([int]0,[int]0,[int]0) }
  elseif ($Background -match "^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$") {
    $bg = @([int]([Convert]::ToInt32($Matches[1],16)), [int]([Convert]::ToInt32($Matches[2],16)), [int]([Convert]::ToInt32($Matches[3],16)))
  } else {
    $corners = @()
    foreach ($pt in @(@(5,5), @(($w-6),5), @(5,($h-6)), @(($w-6),($h-6)))) {
      $c = $src.GetPixel([Math]::Max(0,$pt[0]), [Math]::Max(0,$pt[1])); $corners += ,@([int]$c.R, [int]$c.G, [int]$c.B)
    }
    $rs = [int](($corners | ForEach-Object { $_[0] } | Sort-Object)[2])
    $gs = [int](($corners | ForEach-Object { $_[1] } | Sort-Object)[2])
    $bs = [int](($corners | ForEach-Object { $_[2] } | Sort-Object)[2])
    $bg = @($rs, $gs, $bs)
  }

  $dst = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $data = $dst.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, $dst.PixelFormat)
  try {
    $stride = $data.Stride
    $bytes = New-Object byte[] ($stride * $h)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
    $tol2 = $Tolerance * $Tolerance
    for ($y = 0; $y -lt $h; $y++) {
      for ($x = 0; $x -lt $w; $x++) {
        $idx = $y * $stride + $x * 4
        $b = $bytes[$idx]; $g = $bytes[$idx+1]; $r = $bytes[$idx+2]
        $d = [Math]::Pow($r - $bg[0], 2) + [Math]::Pow($g - $bg[1], 2) + [Math]::Pow($b - $bg[2], 2)
        if ($d -le $tol2) {
          $alpha = [int](255 * [Math]::Sqrt($d / $tol2))
          if ($alpha -gt 255) { $alpha = 255 }
          if ($alpha -lt 0) { $alpha = 0 }
          $bytes[$idx+3] = [byte]$alpha
        } else { $bytes[$idx+3] = 255 }
      }
    }
    [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
  } finally { $dst.UnlockBits($data) }

  $dir = Split-Path $OutputPath -Parent
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $dst.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $dst.Dispose()
  Write-Output ("OK: " + $OutputPath + " (bg=" + ($bg -join ',') + " tol=" + $Tolerance + ")")
} finally { $src.Dispose() }
