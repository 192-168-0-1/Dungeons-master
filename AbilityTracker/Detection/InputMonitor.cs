using System.Diagnostics;
using System.Runtime.InteropServices;
using Dungeons.ScreenCapture;

namespace AbilityTracker.Detection;

public sealed class InputMonitor : IDisposable
{
    private const int WhKeyboardLl = 13;
    private const int WhMouseLl = 14;
    private const int WmKeyDown = 0x0100;
    private const int WmSysKeyDown = 0x0104;
    private const int WmLButtonDown = 0x0201;
    private const int WmRButtonDown = 0x0204;
    private readonly HookProc keyboardProc;
    private readonly HookProc mouseProc;
    private IntPtr keyboardHook;
    private IntPtr mouseHook;
    private ProcessWindow? trackedWindow;

    public InputMonitor()
    {
        keyboardProc = KeyboardCallback;
        mouseProc = MouseCallback;
    }

    public event EventHandler<KeyInputEventArgs>? KeyPressed;
    public event EventHandler<MouseInputEventArgs>? MousePressed;

    public void Start(ProcessWindow window)
    {
        Stop();
        trackedWindow = window;
        using var process = Process.GetCurrentProcess();
        using var module = process.MainModule;
        var moduleHandle = GetModuleHandle(module?.ModuleName);
        keyboardHook = SetWindowsHookEx(WhKeyboardLl, keyboardProc, moduleHandle, 0);
        mouseHook = SetWindowsHookEx(WhMouseLl, mouseProc, moduleHandle, 0);
    }

    public void Stop()
    {
        if (keyboardHook != IntPtr.Zero) UnhookWindowsHookEx(keyboardHook);
        if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
        keyboardHook = mouseHook = IntPtr.Zero;
        trackedWindow = null;
    }

    private IntPtr KeyboardCallback(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0 && (wParam == (IntPtr)WmKeyDown || wParam == (IntPtr)WmSysKeyDown) && IsTrackedWindowForeground())
        {
            var data = Marshal.PtrToStructure<KeyboardData>(lParam);
            var key = (Keys)data.VirtualKey;
            if (!IsModifier(key))
                KeyPressed?.Invoke(this, new KeyInputEventArgs(KeyGesture.FromKey(key), DateTime.UtcNow));
        }
        return CallNextHookEx(keyboardHook, code, wParam, lParam);
    }

    private IntPtr MouseCallback(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0 && (wParam == (IntPtr)WmLButtonDown || wParam == (IntPtr)WmRButtonDown) && IsTrackedWindowForeground())
        {
            var data = Marshal.PtrToStructure<MouseData>(lParam);
            MousePressed?.Invoke(this, new MouseInputEventArgs(new Point(data.Point.X, data.Point.Y), DateTime.UtcNow));
        }
        return CallNextHookEx(mouseHook, code, wParam, lParam);
    }

    private bool IsTrackedWindowForeground()
    {
        if (trackedWindow is null || trackedWindow.HasExited) return false;
        var foreground = GetForegroundWindow();
        if (trackedWindow.Handle != IntPtr.Zero) return foreground == trackedWindow.Handle;
        if (foreground == IntPtr.Zero) return false;
        GetWindowThreadProcessId(foreground, out var processId);
        try { return Process.GetProcessById((int)processId).ProcessName.Equals("rs2client", StringComparison.OrdinalIgnoreCase); }
        catch { return false; }
    }

    private static bool IsModifier(Keys key) => key is Keys.ControlKey or Keys.LControlKey or Keys.RControlKey or
        Keys.ShiftKey or Keys.LShiftKey or Keys.RShiftKey or Keys.Menu or Keys.LMenu or Keys.RMenu;

    public void Dispose() => Stop();

    private delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int hook, HookProc callback, IntPtr module, uint threadId);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string? moduleName);
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(Keys key);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)]
    private struct MouseData { public NativePoint Point; public uint MouseDataValue; public uint Flags; public uint Time; public IntPtr ExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardData { public uint VirtualKey; public uint ScanCode; public uint Flags; public uint Time; public IntPtr ExtraInfo; }

    public static class KeyGesture
    {
        public static string FromKey(Keys key)
        {
            var parts = new List<string>();
            if (IsDown(Keys.ControlKey)) parts.Add("Ctrl");
            if (IsDown(Keys.Menu)) parts.Add("Alt");
            if (IsDown(Keys.ShiftKey)) parts.Add("Shift");
            parts.Add(key.ToString());
            return string.Join("+", parts);
        }

        public static string Normalize(string value)
        {
            return string.Join("+", value.Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(part => part.Equals("Control", StringComparison.OrdinalIgnoreCase) ? "Ctrl" :
                                part.Equals("Menu", StringComparison.OrdinalIgnoreCase) ? "Alt" : part));
        }

        private static bool IsDown(Keys key) => (GetAsyncKeyState(key) & 0x8000) != 0;
    }
}

public sealed class KeyInputEventArgs : EventArgs
{
    public KeyInputEventArgs(string gesture, DateTime timestamp) { Gesture = gesture; Timestamp = timestamp; }
    public string Gesture { get; }
    public DateTime Timestamp { get; }
}

public sealed class MouseInputEventArgs : EventArgs
{
    public MouseInputEventArgs(Point screenPoint, DateTime timestamp) { ScreenPoint = screenPoint; Timestamp = timestamp; }
    public Point ScreenPoint { get; }
    public DateTime Timestamp { get; }
}
