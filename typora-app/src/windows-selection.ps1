param([string]$DocumentName = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ViaForeground {
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);
}
'@
    $selected = ''
    $windowHandle = 0
    $windowBounds = $null
    $handle = [ViaForeground]::GetForegroundWindow()
    [uint32]$processId = 0
    [void][ViaForeground]::GetWindowThreadProcessId($handle, [ref]$processId)
    $foregroundProcess = Get-Process -Id $processId -ErrorAction SilentlyContinue
    $targetProcess = $null
    if ($foregroundProcess -and $foregroundProcess.ProcessName -eq 'Typora' -and
        (!$DocumentName -or $foregroundProcess.MainWindowTitle.Contains($DocumentName))) {
        $targetProcess = $foregroundProcess
    } else {
        # A custom export command may briefly put its launcher in the foreground.
        # Fall back only when the document title identifies one Typora window.
        $matches = @(Get-Process Typora -ErrorAction SilentlyContinue | Where-Object {
            $_.MainWindowHandle -ne 0 -and (!$DocumentName -or $_.MainWindowTitle.Contains($DocumentName))
        })
        if ($matches.Count -eq 1) { $targetProcess = $matches[0] }
    }
    if ($targetProcess) {
        $mainHandle = $targetProcess.MainWindowHandle
        if ($mainHandle -eq 0) { $mainHandle = $handle }
        $windowHandle = $mainHandle.ToInt64()
        $rect = [ViaForeground+Rect]::new()
        if ([ViaForeground]::GetWindowRect($mainHandle, [ref]$rect)) {
            $windowBounds = @{ x = $rect.Left; y = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top }
        }
        try {
            $root = [System.Windows.Automation.AutomationElement]::FromHandle($mainHandle)
            $documents = $root.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::Document
                )
            )
            foreach ($element in $documents) {
                $pattern = $null
                if (-not $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) { continue }
                foreach ($range in $pattern.GetSelection()) {
                    $value = $range.GetText(2000).Trim()
                    if ($value.Length -gt $selected.Length) { $selected = $value }
                }
            }
        } catch { $selected = '' }
    }
    @{ text = $selected; windowHandle = $windowHandle; windowBounds = $windowBounds } | ConvertTo-Json -Compress
} catch {
    @{ text = ''; windowHandle = 0; windowBounds = $null } | ConvertTo-Json -Compress
}
