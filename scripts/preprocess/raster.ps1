# Raster operations for the image editor hand-off (Windows System.Drawing, zero deps).
#
#   info              : print "{width}x{height}" of an image
#   resize            : fit the source into -Width x -Height with -Mode cover|contain|stretch
#   binarize          : force a brush mask to pure black/white (provider mask input)
#   mask-alpha        : convert a white-on-black mask into the OpenAI mask form
#                       (transparent = the region to edit)
#   mask-from-markers : draw one filled circle per marker as a mask (marker -> region edit)
#   markers           : stamp numbered pins onto the image (guidance image for the model)
#   overlay-mask      : paint the masked region red on the image (prompt-only fallback)
#
# Usage:
#   pwsh raster.ps1 -Op resize -ImagePath in.png -OutputPath out.png -Width 1024 -Height 1024 -Mode cover
#   pwsh raster.ps1 -Op mask-from-markers -OutputPath mask.png -Width 900 -Height 900 -MarkersFile m.json
param(
  [Parameter(Mandatory = $true)][string]$Op,
  [string]$ImagePath,
  [string]$OutputPath,
  [string]$MaskPath,
  [string]$MarkersFile,
  [int]$Width = 0,
  [int]$Height = 0,
  [ValidateSet('cover', 'contain', 'stretch')][string]$Mode = 'cover',
  [int]$Threshold = 128,
  [double]$Radius = 0.03,
  [double]$Alpha = 0.45
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-OutBitmap([int]$w, [int]$h) {
  return New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}

function Ensure-Parent([string]$path) {
  $dir = Split-Path $path -Parent
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
}

function Save-Png($bitmap, [string]$path) {
  Ensure-Parent $path
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Open-Image([string]$path) {
  $bitmap = [System.Drawing.Bitmap]::new($path)
  return $bitmap
}

function Get-Markers {
  if (-not $MarkersFile -or -not (Test-Path $MarkersFile)) { return @() }
  $raw = Get-Content $MarkersFile -Raw | ConvertFrom-Json
  if ($null -eq $raw) { return @() }
  # 支持 [{id,x,y,text}] 或 {markers:[...]}
  if ($raw.PSObject.Properties.Name -contains 'markers') { return @($raw.markers) }
  return @($raw)
}

function Get-Graphics($bitmap) {
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  return $g
}

switch ($Op) {
  'info' {
    $src = Open-Image $ImagePath
    try { Write-Output ("{0}x{1}" -f $src.Width, $src.Height) } finally { $src.Dispose() }
  }

  'resize' {
    if ($Width -le 0 -or $Height -le 0) { throw 'resize 需要 -Width/-Height' }
    $src = Open-Image $ImagePath
    try {
      $out = New-OutBitmap $Width $Height
      $g = Get-Graphics $out
      try {
        if ($Mode -eq 'stretch') {
          $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $Width, $Height))
        }
        else {
          $scale = if ($Mode -eq 'cover') {
            [Math]::Max($Width / $src.Width, $Height / $src.Height)
          }
          else {
            [Math]::Min($Width / $src.Width, $Height / $src.Height)
          }
          $dw = [int][Math]::Round($src.Width * $scale)
          $dh = [int][Math]::Round($src.Height * $scale)
          $dx = [int][Math]::Round(($Width - $dw) / 2)
          $dy = [int][Math]::Round(($Height - $dh) / 2)
          $g.DrawImage($src, (New-Object System.Drawing.Rectangle $dx, $dy, $dw, $dh))
        }
      }
      finally { $g.Dispose() }
      Save-Png $out $OutputPath
      $out.Dispose()
    }
    finally { $src.Dispose() }
    Write-Output ("OK: resize {0}x{1} {2} -> {3}" -f $Width, $Height, $Mode, $OutputPath)
  }

  'binarize' {
    $src = Open-Image $ImagePath
    try {
      $w = $src.Width; $h = $src.Height
      $out = New-OutBitmap $w $h
      $g = [System.Drawing.Graphics]::FromImage($out)
      try { $g.DrawImage($src, 0, 0, $w, $h) } finally { $g.Dispose() }
      $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
      $data = $out.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, $out.PixelFormat)
      try {
        $stride = $data.Stride
        $bytes = New-Object byte[] ($stride * $h)
        [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
        for ($y = 0; $y -lt $h; $y++) {
          for ($x = 0; $x -lt $w; $x++) {
            $i = $y * $stride + $x * 4
            $lum = (0.299 * $bytes[$i + 2] + 0.587 * $bytes[$i + 1] + 0.114 * $bytes[$i])
            if ($lum -ge $Threshold) { $bytes[$i] = 255; $bytes[$i + 1] = 255; $bytes[$i + 2] = 255 }
            else { $bytes[$i] = 0; $bytes[$i + 1] = 0; $bytes[$i + 2] = 0 }
            $bytes[$i + 3] = 255
          }
        }
        [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
      }
      finally { $out.UnlockBits($data) }
      Save-Png $out $OutputPath
      $out.Dispose()
    }
    finally { $src.Dispose() }
    Write-Output ("OK: binarize -> {0}" -f $OutputPath)
  }

  'mask-alpha' {
    $src = Open-Image $ImagePath
    try {
      $w = $src.Width; $h = $src.Height
      $out = New-OutBitmap $w $h
      $g = [System.Drawing.Graphics]::FromImage($out)
      try { $g.DrawImage($src, 0, 0, $w, $h) } finally { $g.Dispose() }
      $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
      $data = $out.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, $out.PixelFormat)
      try {
        $stride = $data.Stride
        $bytes = New-Object byte[] ($stride * $h)
        [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
        for ($y = 0; $y -lt $h; $y++) {
          for ($x = 0; $x -lt $w; $x++) {
            $i = $y * $stride + $x * 4
            $lum = (0.299 * $bytes[$i + 2] + 0.587 * $bytes[$i + 1] + 0.114 * $bytes[$i])
            # OpenAI 语义：alpha=0（全透明）处才被重绘 → 白笔触变透明
            $bytes[$i + 3] = [byte](255 - $lum)
            $bytes[$i] = 0; $bytes[$i + 1] = 0; $bytes[$i + 2] = 0
          }
        }
        [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
      }
      finally { $out.UnlockBits($data) }
      Save-Png $out $OutputPath
      $out.Dispose()
    }
    finally { $src.Dispose() }
    Write-Output ("OK: mask-alpha -> {0}" -f $OutputPath)
  }

  'mask-from-markers' {
    if ($Width -le 0 -or $Height -le 0) { throw 'mask-from-markers 需要 -Width/-Height' }
    $markers = Get-Markers
    $out = New-OutBitmap $Width $Height
    $g = Get-Graphics $out
    $black = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::Black)
    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    try {
      $g.FillRectangle($black, 0, 0, $Width, $Height)
      $r = [int][Math]::Max(8, [Math]::Min($Width, $Height) * $Radius)
      foreach ($m in $markers) {
        $cx = [int][Math]::Round([double]$m.x * $Width)
        $cy = [int][Math]::Round([double]$m.y * $Height)
        $g.FillEllipse($white, ($cx - $r), ($cy - $r), (2 * $r), (2 * $r))
      }
    }
    finally { $g.Dispose(); $black.Dispose(); $white.Dispose() }
    Save-Png $out $OutputPath
    $out.Dispose()
    Write-Output ("OK: mask-from-markers ({0} 个标记, r={1}px) -> {2}" -f $markers.Count, [int][Math]::Max(8, [Math]::Min($Width, $Height) * $Radius), $OutputPath)
  }

  'markers' {
    $src = Open-Image $ImagePath
    try {
      $w = $src.Width; $h = $src.Height
      $out = New-OutBitmap $w $h
      $g = Get-Graphics $out
      try {
        $g.DrawImage($src, 0, 0, $w, $h)
        $markers = Get-Markers
        $r = [float][Math]::Max(11, [Math]::Min($w, $h) * 0.026)
        $fill = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(235, 255, 59, 48))
        $edge = New-Object System.Drawing.Pen ([System.Drawing.Color]::White, [float][Math]::Max(2, $r * 0.2))
        $font = New-Object System.Drawing.Font 'Segoe UI', ([float][Math]::Max(11, $r * 1.1)), ([System.Drawing.FontStyle]::Bold)
        $text = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
        $fmt = New-Object System.Drawing.StringFormat
        $fmt.Alignment = [System.Drawing.StringAlignment]::Center
        $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
        try {
          foreach ($m in $markers) {
            $cx = [float]([double]$m.x * $w)
            $cy = [float]([double]$m.y * $h)
            $g.FillEllipse($fill, ($cx - $r), ($cy - $r), (2 * $r), (2 * $r))
            $g.DrawEllipse($edge, ($cx - $r), ($cy - $r), (2 * $r), (2 * $r))
            $box = New-Object System.Drawing.RectangleF ($cx - $r), ($cy - $r), (2 * $r), (2 * $r)
            $g.DrawString([string]$m.id, $font, $text, $box, $fmt)
          }
        }
        finally { $fill.Dispose(); $edge.Dispose(); $font.Dispose(); $text.Dispose(); $fmt.Dispose() }
      }
      finally { $g.Dispose() }
      Save-Png $out $OutputPath
      $out.Dispose()
    }
    finally { $src.Dispose() }
    Write-Output ("OK: markers -> {0}" -f $OutputPath)
  }

  'overlay-mask' {
    $src = Open-Image $ImagePath
    $mask = Open-Image $MaskPath
    try {
      $w = $src.Width; $h = $src.Height
      $out = New-OutBitmap $w $h
      $g = Get-Graphics $out
      try {
        $g.DrawImage($src, 0, 0, $w, $h)
        # 白 → 红(1,0,0)，黑 → 全透明；Alpha 控制红色浓淡
        $cm = New-Object System.Drawing.Imaging.ColorMatrix
        $cm.Matrix00 = 1.0
        $cm.Matrix03 = [float]$Alpha
        $cm.Matrix33 = 0.0
        $attrs = New-Object System.Drawing.Imaging.ImageAttributes
        $attrs.SetColorMatrix($cm)
        $dest = New-Object System.Drawing.Rectangle 0, 0, $w, $h
        try {
          $g.DrawImage($mask, $dest, 0, 0, $mask.Width, $mask.Height, [System.Drawing.GraphicsUnit]::Pixel, $attrs)
        }
        finally { $attrs.Dispose() }
      }
      finally { $g.Dispose() }
      Save-Png $out $OutputPath
      $out.Dispose()
    }
    finally { $src.Dispose(); $mask.Dispose() }
    Write-Output ("OK: overlay-mask -> {0}" -f $OutputPath)
  }

  default { throw "未知 -Op: $Op（支持 info/resize/binarize/mask-alpha/mask-from-markers/markers/overlay-mask）" }
}
