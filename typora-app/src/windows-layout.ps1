param(
    [ValidateSet('dock', 'restore', 'raise')][string]$Mode,
    [long]$Handle,
    [int]$X,
    [int]$Y,
    [int]$Width,
    [int]$Height,
    [int]$OriginalX = 0,
    [int]$OriginalY = 0,
    [int]$OriginalWidth = 0,
    [int]$OriginalHeight = 0,
    [string]$WasMaximized = 'false'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

try {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ViaWindowLayout {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out Rect rect);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr handle, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
}
'@
    $ptr = [IntPtr]::new($Handle)
    [uint32]$processId = 0
    [void][ViaWindowLayout]::GetWindowThreadProcessId($ptr, [ref]$processId)
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (!$process -or $process.ProcessName -ne 'Typora') { throw '目标窗口已不是 Typora' }
    $rect = [ViaWindowLayout+Rect]::new()
    if (![ViaWindowLayout]::GetWindowRect($ptr, [ref]$rect)) { throw '无法读取 Typora 窗口位置' }
    if ($Mode -eq 'raise') {
        # Bring Typora alongside Via without taking keyboard focus from Via.
        if ([ViaWindowLayout]::IsZoomed($ptr)) {
            @{ ok = $true; raised = $false } | ConvertTo-Json -Compress
        } else {
            $raised = [ViaWindowLayout]::SetWindowPos($ptr, [IntPtr]::Zero, 0, 0, 0, 0, 0x0013)
            @{ ok = $raised; raised = $raised } | ConvertTo-Json -Compress
        }
    } elseif ($Mode -eq 'dock') {
        $original = @{ x = $rect.Left; y = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top; maximized = [ViaWindowLayout]::IsZoomed($ptr) }
        if ($original.maximized) { [void][ViaWindowLayout]::ShowWindow($ptr, 9) }
        if (![ViaWindowLayout]::SetWindowPos($ptr, [IntPtr]::Zero, $X, $Y, $Width, $Height, 0x0014)) { throw 'Typora 窗口排布失败' }
        @{ ok = $true; original = $original } | ConvertTo-Json -Compress
    } else {
        $changed = [Math]::Abs($rect.Left - $X) -gt 10 -or [Math]::Abs($rect.Top - $Y) -gt 10 -or
            [Math]::Abs(($rect.Right - $rect.Left) - $Width) -gt 10 -or [Math]::Abs(($rect.Bottom - $rect.Top) - $Height) -gt 10
        if (!$changed) {
            if ($WasMaximized -eq 'true') { [void][ViaWindowLayout]::ShowWindow($ptr, 3) }
            else { [void][ViaWindowLayout]::SetWindowPos($ptr, [IntPtr]::Zero, $OriginalX, $OriginalY, $OriginalWidth, $OriginalHeight, 0x0014) }
        }
        @{ ok = $true; restored = !$changed } | ConvertTo-Json -Compress
    }
} catch {
    @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
