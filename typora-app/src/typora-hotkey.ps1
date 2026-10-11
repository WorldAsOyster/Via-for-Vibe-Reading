param(
    [Parameter(Mandatory = $true)][long]$Handle,
    [Parameter(Mandatory = $true)][string]$DocumentName,
    [Parameter(Mandatory = $true)][int]$ParentProcessId,
    [string]$Shortcut = 'Ctrl+Q',
    [switch]$TestWindow
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -AssemblyName UIAutomationClient
Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Automation.Text;

public static class ViaTyporaHotkey {
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYUP = 0x0105;
    private const int VK_CONTROL = 0x11;
    private const int VK_SHIFT = 0x10;
    private const int VK_MENU = 0x12;

    private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    private static HookProc callback = OnKey;
    private static IntPtr hook;
    private static IntPtr target;
    private static string documentName;
    private static bool shortcutDown;
    private static int shortcutKey;
    private static bool shortcutCtrl;
    private static bool shortcutAlt;
    private static bool shortcutShift;

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int x;
        public int y;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc proc, IntPtr module, uint threadId);
    [DllImport("user32.dll")]
    private static extern bool UnhookWindowsHookEx(IntPtr handle);
    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr handle, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr handle);
    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")]
    private static extern int GetWindowText(IntPtr handle, StringBuilder text, int capacity);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr handle, out Rect rect);
    [DllImport("user32.dll")]
    private static extern int GetMessage(out MSG message, IntPtr handle, uint min, uint max);
    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG message);
    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref MSG message);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto)]
    private static extern IntPtr GetModuleHandle(string moduleName);

    private static bool KeyIsDown(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }

    private static bool IsMatchingTyporaWindow() {
        if (!IsWindow(target) || GetForegroundWindow() != target) return false;
        var title = new StringBuilder(1024);
        GetWindowText(target, title, title.Capacity);
        return title.ToString().Contains(documentName);
    }

    private static void CaptureSelection() {
        string selected = "";
        try {
            var root = AutomationElement.FromHandle(target);
            var documents = root.FindAll(TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document));
            foreach (AutomationElement element in documents) {
                object pattern;
                if (!element.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) continue;
                foreach (TextPatternRange range in ((TextPattern)pattern).GetSelection()) {
                    string value = range.GetText(2000).Trim();
                    if (value.Length > selected.Length) selected = value;
                }
            }
        } catch { selected = ""; }
        Rect rect;
        if (!GetWindowRect(target, out rect)) rect = new Rect();
        string encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(selected));
        Console.WriteLine("HOTKEY\t" + encoded + "\t" + rect.Left + "\t" + rect.Top +
            "\t" + (rect.Right - rect.Left) + "\t" + (rect.Bottom - rect.Top));
        Console.Out.Flush();
    }

    private static IntPtr OnKey(int code, IntPtr message, IntPtr data) {
        if (code >= 0) {
            int kind = message.ToInt32();
            int key = Marshal.ReadInt32(data);
            if (key == shortcutKey && (kind == WM_KEYUP || kind == WM_SYSKEYUP)) {
                bool intercepted = shortcutDown;
                shortcutDown = false;
                if (intercepted) return (IntPtr)1;
            }
            if (key == shortcutKey && (kind == WM_KEYDOWN || kind == WM_SYSKEYDOWN) &&
                KeyIsDown(VK_CONTROL) == shortcutCtrl && KeyIsDown(VK_SHIFT) == shortcutShift && KeyIsDown(VK_MENU) == shortcutAlt &&
                IsMatchingTyporaWindow()) {
                if (!shortcutDown) {
                    shortcutDown = true;
                    var capture = new Thread(CaptureSelection);
                    capture.IsBackground = true;
                    capture.SetApartmentState(ApartmentState.STA);
                    capture.Start();
                }
                return (IntPtr)1;
            }
        }
        return CallNextHookEx(hook, code, message, data);
    }

    public static void Run(long handle, string name, int parentProcessId, bool testWindow, string shortcut) {
        target = new IntPtr(handle);
        documentName = name;
        if (!System.Text.RegularExpressions.Regex.IsMatch(shortcut ?? "", @"^(Ctrl\+)?(Alt\+)?(Shift\+)?[A-Z]$") ||
            (!shortcut.StartsWith("Ctrl+") && !shortcut.StartsWith("Alt+")))
            throw new Exception("Invalid Typora shortcut");
        shortcutKey = shortcut[shortcut.Length - 1];
        shortcutCtrl = shortcut.Contains("Ctrl+");
        shortcutAlt = shortcut.Contains("Alt+");
        shortcutShift = shortcut.Contains("Shift+");
        if (!IsWindow(target)) throw new Exception("Typora window is no longer available");
        uint processId;
        GetWindowThreadProcessId(target, out processId);
        if (!testWindow && !Process.GetProcessById((int)processId).ProcessName.Equals("Typora", StringComparison.OrdinalIgnoreCase))
            throw new Exception("Target is not a Typora window");
        var module = GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName);
        hook = SetWindowsHookEx(WH_KEYBOARD_LL, callback, module, 0);
        if (hook == IntPtr.Zero) throw new Exception("Keyboard hook could not be installed");
        var parentWatcher = new Thread(() => {
            while (true) {
                Thread.Sleep(1000);
                try {
                    if (Process.GetProcessById(parentProcessId).HasExited) Environment.Exit(0);
                } catch { Environment.Exit(0); }
            }
        });
        parentWatcher.IsBackground = true;
        parentWatcher.Start();
        Console.WriteLine("READY");
        Console.Out.Flush();
        MSG message;
        while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }
        UnhookWindowsHookEx(hook);
    }
}
'@

try {
    [ViaTyporaHotkey]::Run($Handle, $DocumentName, $ParentProcessId, [bool]$TestWindow, $Shortcut)
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
