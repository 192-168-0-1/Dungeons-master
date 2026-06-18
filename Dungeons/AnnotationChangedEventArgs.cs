using System;
using System.Drawing;

namespace Dungeons
{
    public class AnnotationChangedEventArgs : EventArgs
    {
        public AnnotationChangedEventArgs(Point location, string text)
        {
            Location = location;
            Text = text ?? string.Empty;
        }

        public Point Location { get; }
        public string Text { get; }
    }
}
