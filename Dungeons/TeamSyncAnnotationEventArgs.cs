using System;
using System.Drawing;

namespace Dungeons
{
    public class TeamSyncAnnotationEventArgs : EventArgs
    {
        public TeamSyncAnnotationEventArgs(Point location, string text, string senderName)
        {
            Location = location;
            Text = text ?? string.Empty;
            SenderName = senderName ?? "Team mate";
        }

        public Point Location { get; }
        public string Text { get; }
        public string SenderName { get; }
    }
}
