FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY DungeonsRelay/DungeonsRelay.csproj DungeonsRelay/
RUN dotnet restore DungeonsRelay/DungeonsRelay.csproj

COPY DungeonsRelay/ DungeonsRelay/
RUN dotnet publish DungeonsRelay/DungeonsRelay.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app

COPY --from=build /app/publish .

EXPOSE 36596
ENTRYPOINT ["dotnet", "DungeonsRelay.dll"]
