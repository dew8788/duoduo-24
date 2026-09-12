# 24-Game icon generator (Windows / System.Drawing)
# Usage: powershell -File tools/make-icons.ps1
# Output: dist/icon-180.png, dist/icon-192.png, dist/icon-512.png
# Matches the original game art: orange rounded square + darker orange
# starburst + white "24".  NOTE: keep this file ASCII-only -- Windows
# PowerShell 5.1 reads .ps1 as ANSI and mangles non-ASCII source.

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$dist = Join-Path $root 'assets'
if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }

function New-RoundedPath([int]$w, [int]$h, [int]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc(0, 0, $d, $d, 180, 90)
    $p.AddArc($w - $d, 0, $d, $d, 270, 90)
    $p.AddArc($w - $d, $h - $d, $d, $d, 0, 90)
    $p.AddArc(0, $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

# 28-point starburst polygon (14 spikes)
function New-Starburst([single]$cx, [single]$cy, [single]$outer, [single]$inner, [int]$spikes) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $pts = New-Object 'System.Collections.Generic.List[System.Drawing.PointF]'
    for ($i = 0; $i -lt $spikes * 2; $i++) {
        $ang = [Math]::PI * $i / $spikes - [Math]::PI / 2
        $rad = if ($i % 2 -eq 0) { $outer } else { $inner }
        $pts.Add((New-Object System.Drawing.PointF(
            ([single]($cx + $rad * [Math]::Cos($ang))),
            ([single]($cy + $rad * [Math]::Sin($ang))))))
    }
    $p.AddPolygon($pts.ToArray())
    $p.CloseFigure()
    return $p
}

function New-Icon([int]$size, [string]$outPath) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $bmp.SetResolution(144, 144)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # rounded square, orange gradient
    $pad = [int]($size * 0.02)
    $side = $size - $pad * 2
    $path = New-RoundedPath $side $side ([int]($size * 0.23))
    $rect = New-Object System.Drawing.Rectangle $pad, $pad, $side, $side
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 244, 122, 55),
        [System.Drawing.Color]::FromArgb(255, 212, 79, 26),
        [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
    $g.FillPath($bg, $path)

    # darker-orange starburst in the middle
    $cx = $size / 2.0
    $cy = $size / 2.0
    $star = New-Starburst $cx $cy ([single]($size * 0.385)) ([single]($size * 0.325)) 14
    $starBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 200, 70, 20))
    $g.FillPath($starBrush, $star)

    # white "24"
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $font = New-Object System.Drawing.Font('Arial', [float]($size * 0.38), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $textRect = New-Object System.Drawing.RectangleF 0, ([float]($size * -0.01)), ([float]$size), ([float]$size)
    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $g.DrawString('24', $font, $white, $textRect, $fmt)

    $g.Dispose()
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $bg.Dispose(); $starBrush.Dispose(); $font.Dispose(); $white.Dispose(); $fmt.Dispose()
    $star.Dispose(); $path.Dispose()
    Write-Output ("  icon-{0}.png" -f $size)
}

Write-Output 'Generating icons:'
New-Icon 512 (Join-Path $dist 'icon-512.png')
New-Icon 192 (Join-Path $dist 'icon-192.png')
New-Icon 180 (Join-Path $dist 'icon-180.png')
Write-Output 'Done.'
