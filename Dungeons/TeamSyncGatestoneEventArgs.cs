using System;
using System.Drawing;

namespace Dungeons
{
    public class TeamSyncGatestoneEventArgs : EventArgs
    {
        public TeamSyncGatestoneEventArgs(string senderId, string senderName, int gatestoneIndex, Point location)
        {
            SenderId = senderId ?? string.Empty;
            SenderName = senderName ?? "Team mate";
            GatestoneIndex = gatestoneIndex;
            Location = location;
        }

        public string SenderId { get; }
        public string SenderName { get; }
        public int GatestoneIndex { get; }
        public Point Location { get; }
    }
}
