# DungeonsRelay

Small relay service for Dungeons team sync. It accepts WebSocket connections on:

```text
/team-sync?room=ROOMCODE
```

Clients in the same room receive each other's team sync messages. The relay does not parse dungeon data and does not store state.

## Local test

From the solution directory:

```powershell
dotnet run --project DungeonsRelay\DungeonsRelay.csproj
```

Then use this relay URL in Dungeons:

```text
ws://localhost:36596/team-sync
```

## Hosting

Host this project as a small .NET 8 web app. The public URL should be used in Dungeons as:

```text
wss://your-domain.example/team-sync
```

If the host provides a port through `ASPNETCORE_URLS` or `PORT`, configure the app to listen on that port.

## Render

The solution root contains:

```text
DungeonsRelay.Dockerfile
render.yaml
```

On Render, create a Web Service from this repository and use Docker. The service URL will look like:

```text
https://dungeons-relay.onrender.com
```

Use this relay URL in Dungeons:

```text
wss://dungeons-relay.onrender.com/team-sync
```
