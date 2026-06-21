#nullable enable
using System;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;

namespace Dungeons.ScreenCapture
{
    public sealed class ProcessWindow : IEquatable<ProcessWindow>
    {
        public ProcessWindow(Process? process) { Process = process; }

        public Process? Process { get; }
        public bool HasExited
        {
            get
            {
                try { return Process?.HasExited ?? false; }
                catch (InvalidOperationException) { return true; }
            }
        }

        public IntPtr Handle => Process?.MainWindowHandle ?? IntPtr.Zero;
        public string Title => Process?.MainWindowTitle ?? "Entire screen";
        public Size Size
        {
            get
            {
                if (Handle == IntPtr.Zero) return SystemInformation.VirtualScreen.Size;
                return CaptureNativeMethods.GetClientRect(Handle, out var rect)
                    ? new Size(rect.Right - rect.Left, rect.Bottom - rect.Top)
                    : Size.Empty;
            }
        }

        public static ProcessWindow[] FindByProcessName(string processName)
        {
            var processes = Process.GetProcessesByName(processName);
            var windows = new ProcessWindow[processes.Length];
            for (var i = 0; i < processes.Length; i++) windows[i] = new ProcessWindow(processes[i]);
            return windows;
        }

        public Bitmap? Capture() => Capture(new Rectangle(Point.Empty, Size));
        public Bitmap? Capture(bool useScreenCapture) => Capture(new Rectangle(Point.Empty, Size), useScreenCapture);
        public Bitmap? Capture(Rectangle region) => Capture(region, false);

        public Point ClientToScreen(Point point)
        {
            if (Handle == IntPtr.Zero)
                return new Point(SystemInformation.VirtualScreen.X + point.X, SystemInformation.VirtualScreen.Y + point.Y);
            var nativePoint = new CaptureNativeMethods.NativePoint { X = point.X, Y = point.Y };
            return CaptureNativeMethods.ClientToScreen(Handle, ref nativePoint)
                ? new Point(nativePoint.X, nativePoint.Y)
                : point;
        }

        public bool ContainsScreenPoint(Point point)
        {
            return new Rectangle(ClientToScreen(Point.Empty), Size).Contains(point);
        }

        public Bitmap? Capture(Rectangle region, bool useScreenCapture)
        {
            var size = region.Size;
            if (size.Width <= 0 || size.Height <= 0) return null;
            if (Handle == IntPtr.Zero) return CaptureEntireScreen(region);
            if (useScreenCapture) return CaptureFromScreen(region);

            var desktopDc = CaptureNativeMethods.GetDC(Handle);
            if (desktopDc == IntPtr.Zero) return null;
            var memoryDc = CaptureNativeMethods.CreateCompatibleDC(desktopDc);
            var nativeBitmap = CaptureNativeMethods.CreateCompatibleBitmap(desktopDc, size.Width, size.Height);
            if (memoryDc == IntPtr.Zero || nativeBitmap == IntPtr.Zero)
            {
                if (nativeBitmap != IntPtr.Zero) CaptureNativeMethods.DeleteObject(nativeBitmap);
                if (memoryDc != IntPtr.Zero) CaptureNativeMethods.DeleteDC(memoryDc);
                CaptureNativeMethods.ReleaseDC(Handle, desktopDc);
                return null;
            }

            var oldBitmap = CaptureNativeMethods.SelectObject(memoryDc, nativeBitmap);
            try
            {
                var success = CaptureNativeMethods.BitBlt(memoryDc, 0, 0, size.Width, size.Height, desktopDc,
                    region.X, region.Y, CaptureNativeMethods.Srccopy | CaptureNativeMethods.CaptureBlt);
                return success ? Image.FromHbitmap(nativeBitmap) : null;
            }
            finally
            {
                CaptureNativeMethods.SelectObject(memoryDc, oldBitmap);
                CaptureNativeMethods.DeleteObject(nativeBitmap);
                CaptureNativeMethods.DeleteDC(memoryDc);
                CaptureNativeMethods.ReleaseDC(Handle, desktopDc);
            }
        }

        private static Bitmap CaptureEntireScreen(Rectangle region)
        {
            var bitmap = new Bitmap(region.Width, region.Height);
            var source = new Point(SystemInformation.VirtualScreen.X + region.X, SystemInformation.VirtualScreen.Y + region.Y);
            using (var graphics = Graphics.FromImage(bitmap)) graphics.CopyFromScreen(source, Point.Empty, region.Size);
            return bitmap;
        }

        private Bitmap CaptureFromScreen(Rectangle region)
        {
            var bitmap = new Bitmap(region.Width, region.Height);
            using (var graphics = Graphics.FromImage(bitmap))
                graphics.CopyFromScreen(ClientToScreen(region.Location), Point.Empty, region.Size);
            return bitmap;
        }

        public bool Equals(ProcessWindow? other)
        {
            return !ReferenceEquals(other, null) && Process?.Id == other.Process?.Id;
        }

        public override bool Equals(object? obj) => Equals(obj as ProcessWindow);
        public override int GetHashCode() => Process?.Id ?? 0;
        public override string ToString()
        {
            var size = Size;
            return Process == null ? Title : $"[{size.Width}x{size.Height}] {Title}";
        }
    }
}
