# patch-card.ps1 — ставить міст до платіжного терміналу прямо на картку точки
# в кардрідері Windows-ПК (docs/raspberry-pi.md, «Термінал через малину»).
#
# Чому так: `wsl --mount` USB-кардрідерів не бере (обмеження WSL), а Docker
# фізичних дисків не бачить. Тож розділ кореня читаємо сирим у файл, патчимо
# його в Docker тим самим patch-image.sh, а назад на картку пишемо лише
# мегабайти, які змінились, і перечитуємо їх для перевірки. Розділ data
# (релізи, стан, ключ точки) не чіпаємо взагалі.
#
# Потрібні права адміністратора (сирий доступ до диска) і Docker Desktop.
#   powershell -ExecutionPolicy Bypass -File raspberry\pi\patch-card.ps1 -Disk 2
#   ... -Rollback   — повернути змінені мегабайти з копії оригіналу
#
# Розмітка — kyiv-01 (docs/raspberry-pi.md §5): корінь із сектора 3874816,
# 12582912 секторів. Скрипт звіряє її з таблицею розділів картки й відмовляє,
# якщо не збігається; що всередині саме корінь точки, перевіряє patch-image.sh.
param(
    [Parameter(Mandatory = $true)][int]$Disk,
    [long]$RootStart = 3874816,
    [long]$RootSectors = 12582912,
    [string]$Work = "$env:TEMP\extrovert-card",
    [switch]$Rollback
)
$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Log = Join-Path $Work 'patch-card.log'
New-Item -ItemType Directory -Force -Path $Work | Out-Null
# Лог — лише копія того, що видно у вікні. Файл може на мить заблокувати
# той, хто його читає, і тоді Add-Content падає; з ErrorActionPreference=Stop
# це обірвало б скрипт посеред запису на картку (05.10.2026 так загубився
# один рядок під час e2fsck). Тому збій запису в лог лише пропускається.
function Say($m) {
    $line = "{0:HH:mm:ss} {1}" -f (Get-Date), $m
    Write-Host $line
    try { Add-Content -Path $Log -Value $line -Encoding UTF8 -ErrorAction Stop } catch { }
}

Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public static class RawDisk {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr sa, uint disp, uint flags, IntPtr tmpl);
  [DllImport("msvcrt.dll", CallingConvention = CallingConvention.Cdecl)]
  static extern int memcmp(byte[] a, byte[] b, UIntPtr n);
  public static bool Same(byte[] a, byte[] b) { return memcmp(a, b, (UIntPtr)a.Length) == 0; }
}
"@

function Open-Disk([bool]$write) {
    $path = '\\.\PhysicalDrive' + $Disk
    # GENERIC_READ (| GENERIC_WRITE); спільний доступ R|W; OPEN_EXISTING.
    # На запис — WRITE_THROUGH, щоб дані дійшли до картки, а не лишились у кеші.
    if ($write) { $access = [uint32]3221225472; $flags = [uint32]2147483648 } else { $access = [uint32]2147483648; $flags = [uint32]128 }
    $h = [RawDisk]::CreateFile($path, $access, [uint32]3, [IntPtr]::Zero, [uint32]3, $flags, [IntPtr]::Zero)
    if ($h.IsInvalid) { throw ("не відкрився {0} (код {1}) — запускати від адміністратора" -f $path, [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
    $fa = if ($write) { [IO.FileAccess]::ReadWrite } else { [IO.FileAccess]::Read }
    # bufferSize 1 — без власного буфера FileStream: читаємо й пишемо рівно по мегабайту.
    New-Object IO.FileStream($h, $fa, 1)
}

function Changed-Chunks($pathA, $pathB, [long]$length, [int]$chunk) {
    $a = [IO.File]::OpenRead($pathA); $b = [IO.File]::OpenRead($pathB)
    $ba = New-Object byte[] $chunk; $bb = New-Object byte[] $chunk
    $list = New-Object System.Collections.Generic.List[long]
    for ($i = 0L; $i * $chunk -lt $length; $i++) {
        [void]$a.Read($ba, 0, $chunk); [void]$b.Read($bb, 0, $chunk)
        if (-not [RawDisk]::Same($ba, $bb)) { $list.Add($i) }
    }
    $a.Close(); $b.Close()
    return ,$list
}

try {
    Set-Content -Path $Log -Value '' -Encoding UTF8
    $offset = $RootStart * 512; $length = $RootSectors * 512; $chunk = 1MB
    $img = Join-Path $Work 'root.img'; $orig = Join-Path $Work 'root.orig.img'

    $part = Get-Partition -DiskNumber $Disk | Where-Object { $_.Offset -eq $offset -and $_.Size -eq $length }
    if (-not $part) { throw "на диску $Disk немає розділу з сектора $RootStart на $RootSectors секторів — це не картка kyiv-01?" }
    $d = Get-Disk -Number $Disk
    if ($d.BusType -ne 'USB') { throw "диск $Disk — $($d.BusType), а не USB: на системний диск скрипт не пише" }
    Say ("диск {0} ({1}), корінь — розділ {2}, {3} ГБ" -f $Disk, $d.FriendlyName, $part.PartitionNumber, [math]::Round($length / 1GB, 1))

    if ($Rollback) {
        if (-not (Test-Path $orig) -or -not (Test-Path $img)) { throw "немає $orig чи $img — відкочувати нічим" }
        $src = $orig
        $changed = Changed-Chunks $orig $img $length $chunk
    } else {
        # 1. Сирий корінь із картки у файл
        Say "читаю корінь із картки…"
        $dev = Open-Disk $false
        $out = [IO.File]::Create($img)
        $buf = New-Object byte[] $chunk
        [void]$dev.Seek($offset, [IO.SeekOrigin]::Begin)
        for ($done = 0L; $done -lt $length; $done += $chunk) {
            $n = $dev.Read($buf, 0, $chunk)
            if ($n -ne $chunk) { throw "коротке читання на байті $done ($n)" }
            $out.Write($buf, 0, $n)
            if ((($done / $chunk) % 512) -eq 0) { Say ("  {0:N1} / {1:N1} ГБ" -f ($done / 1GB), ($length / 1GB)) }
        }
        $out.Close(); $dev.Close()
        Copy-Item $img $orig -Force
        Say "копія оригіналу: $orig"

        # 2. Патч у Docker (Linux: e2fsck, loop-mount, patch-image.sh --root, e2fsck)
        Say "патчу в Docker…"
        $w = ($Work -replace '\\', '/'); $p = ($Here -replace '\\', '/')
        # Docker пише попередження в stderr; у Windows PowerShell 5.1 з ErrorActionPreference=Stop
        # це обірвало б скрипт, хоча сам Docker відпрацював. Результат судимо за кодом виходу.
        $ErrorActionPreference = 'Continue'
        & docker run --rm --privileged -v "${w}:/w" -v "${p}:/p:ro" debian:bookworm sh -c 'set -e; e2fsck -fn /w/root.img >/dev/null; mkdir /r; mount -o loop /w/root.img /r; sh /p/patch-image.sh --root /r; sync; umount /r; e2fsck -fn /w/root.img; echo e2fsck-ok' 2>&1 | ForEach-Object { Say "  $_" }
        $rc = $LASTEXITCODE; $ErrorActionPreference = 'Stop'
        if ($rc -ne 0) { throw "патч у Docker не вдався (код $rc) — картку не чіпали" }
        $src = $img
        $changed = Changed-Chunks $img $orig $length $chunk
    }

    # 3. Скільки мегабайтів змінилось
    Say "змінених мегабайтів: $($changed.Count)"
    if ($changed.Count -eq 0) { Say "писати нічого"; Say "ГОТОВО"; exit 0 }
    if ($changed.Count -gt 256) { throw "змін забагато ($($changed.Count) МБ) — щось не так, картку не чіпаю" }

    # 4. Запис лише змінених мегабайтів і перевірка читанням
    $f = [IO.File]::OpenRead($src); $buf = New-Object byte[] $chunk; $back = New-Object byte[] $chunk
    $dev = Open-Disk $true
    foreach ($i in $changed) {
        [void]$f.Seek($i * $chunk, [IO.SeekOrigin]::Begin); [void]$f.Read($buf, 0, $chunk)
        [void]$dev.Seek($offset + $i * $chunk, [IO.SeekOrigin]::Begin); $dev.Write($buf, 0, $chunk)
    }
    $dev.Flush(); $dev.Close()
    $dev = Open-Disk $false
    foreach ($i in $changed) {
        [void]$f.Seek($i * $chunk, [IO.SeekOrigin]::Begin); [void]$f.Read($buf, 0, $chunk)
        [void]$dev.Seek($offset + $i * $chunk, [IO.SeekOrigin]::Begin); [void]$dev.Read($back, 0, $chunk)
        if (-not [RawDisk]::Same($buf, $back)) { throw "перевірка не зійшлась на мегабайті $i" }
    }
    $dev.Close(); $f.Close()
    Say ("записано й перевірено: {0} МБ{1}" -f $changed.Count, $(if ($Rollback) { ' (відкат)' } else { '' }))
    Say "ГОТОВО"
} catch {
    Say ("✗ " + $_.Exception.Message)
    Say "ПОМИЛКА"
    exit 1
}
