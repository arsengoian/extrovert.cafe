# write-card.ps1 — записує образ картки точки на SD-картку в кардрідері
# Windows-ПК і звіряє записане читанням (docs/raspberry-pi.md, «Запасна картка»).
#
#   powershell -ExecutionPolicy Bypass -File raspberry\pi\write-card.ps1 -Disk 3 -Image C:\...\backup.img
#
# Потрібні права адміністратора. Запобіжники, бо помилка в номері диска
# стирає чужий диск цілком:
#   * лише USB-диск і лише розміром від образу до 64 ГБ (зовнішній HDD на
#     терабайт сюди не пройде);
#   * старі розділи картки стираються (Clear-Disk), щоб Windows не тримав
#     змонтованих томів, у які сирий запис заборонено;
#   * перший мегабайт (MBR) пишеться останнім: поки його немає, Windows не
#     бачить розділів і не монтує FAT-розділи посеред запису;
#   * наприкінці все записане перечитується й звіряється з образом.
param(
    [Parameter(Mandatory = $true)][int]$Disk,
    [Parameter(Mandatory = $true)][string]$Image,
    [string]$Log = "$env:TEMP\extrovert-card\write-card.log"
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path (Split-Path $Log) | Out-Null
function Say($m) {
    $line = "{0:HH:mm:ss} {1}" -f (Get-Date), $m
    Write-Host $line
    try { Add-Content -Path $Log -Value $line -Encoding UTF8 -ErrorAction Stop } catch { }
}

Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public static class RawCard {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr sa, uint disp, uint flags, IntPtr tmpl);
  [DllImport("msvcrt.dll", CallingConvention = CallingConvention.Cdecl)]
  static extern int memcmp(byte[] a, byte[] b, UIntPtr n);
  public static bool Same(byte[] a, byte[] b, int n) { return memcmp(a, b, (UIntPtr)n) == 0; }
}
"@

function Open-Card([bool]$write) {
    $path = '\\.\PhysicalDrive' + $Disk
    if ($write) { $access = [uint32]3221225472; $flags = [uint32]2147483648 } else { $access = [uint32]2147483648; $flags = [uint32]128 }
    $h = [RawCard]::CreateFile($path, $access, [uint32]3, [IntPtr]::Zero, [uint32]3, $flags, [IntPtr]::Zero)
    if ($h.IsInvalid) { throw ("не відкрився {0} (код {1}) — запускати від адміністратора" -f $path, [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
    $fa = if ($write) { [IO.FileAccess]::ReadWrite } else { [IO.FileAccess]::Read }
    New-Object IO.FileStream($h, $fa, 1)
}

try {
    Set-Content -Path $Log -Value '' -Encoding UTF8
    $img = Get-Item $Image
    $size = $img.Length
    $d = Get-Disk -Number $Disk
    if ($d.BusType -ne 'USB') { throw "диск $Disk — $($d.BusType), а не USB" }
    if ($d.Size -lt $size) { throw ("картка {0:N0} байт менша за образ {1:N0}" -f $d.Size, $size) }
    if ($d.Size -gt 64GB) { throw ("диск {0} на {1:N0} ГБ — це не SD-картка, не пишу" -f $Disk, ($d.Size / 1GB)) }
    if ($size % 1MB -ne 0) { throw "розмір образу не кратний мегабайту" }
    Say ("картка: диск {0} ({1}), {2:N1} ГБ; образ {3:N1} ГБ" -f $Disk, $d.FriendlyName, ($d.Size / 1GB), ($size / 1GB))

    Say "стираю розмітку картки…"
    if ($d.PartitionStyle -ne 'RAW') { Clear-Disk -Number $Disk -RemoveData -RemoveOEM -Confirm:$false }

    $chunk = 4MB
    $buf = New-Object byte[] $chunk
    $src = [IO.File]::OpenRead($img.FullName)
    $dev = Open-Card $true
    # Усе, крім першого мегабайта
    [void]$src.Seek(1MB, [IO.SeekOrigin]::Begin); [void]$dev.Seek(1MB, [IO.SeekOrigin]::Begin)
    $next = 1GB
    for ($pos = 1MB; $pos -lt $size; $pos += $n) {
        $n = [int][math]::Min([long]$chunk, $size - $pos)
        if ($src.Read($buf, 0, $n) -ne $n) { throw "коротке читання образу на $pos" }
        $dev.Write($buf, 0, $n)
        if ($pos -ge $next) { Say ("  записано {0:N1} / {1:N1} ГБ" -f ($pos / 1GB), ($size / 1GB)); $next += 1GB }
    }
    # Перший мегабайт — останнім
    $head = New-Object byte[] 1MB
    [void]$src.Seek(0, [IO.SeekOrigin]::Begin); [void]$src.Read($head, 0, 1MB)
    [void]$dev.Seek(0, [IO.SeekOrigin]::Begin); $dev.Write($head, 0, 1MB)
    $dev.Flush(); $dev.Close()
    Say "записано, звіряю читанням…"

    $dev = Open-Card $false
    [void]$src.Seek(0, [IO.SeekOrigin]::Begin)
    $back = New-Object byte[] $chunk
    $next = 1GB
    for ($pos = 0L; $pos -lt $size; $pos += $n) {
        $n = [int][math]::Min([long]$chunk, $size - $pos)
        [void]$src.Read($buf, 0, $n)
        if ($dev.Read($back, 0, $n) -ne $n) { throw "коротке читання картки на $pos" }
        if (-not [RawCard]::Same($buf, $back, $n)) { throw "розбіжність на байті $pos — картка бракована або запис не дійшов" }
        if ($pos -ge $next) { Say ("  звірено {0:N1} / {1:N1} ГБ" -f ($pos / 1GB), ($size / 1GB)); $next += 1GB }
    }
    $dev.Close(); $src.Close()
    Say "картка записана й звірена"
    Say "ГОТОВО"
} catch {
    Say ("✗ " + $_.Exception.Message)
    Say "ПОМИЛКА"
    exit 1
}
