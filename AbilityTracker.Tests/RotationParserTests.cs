using AbilityTracker.Domain;
using AbilityTracker.Import;

namespace AbilityTracker.Tests;

[TestClass]
public sealed class RotationParserTests
{
    private const string Example = """
        Phase 1
        (tc) + :bloat: + :vulnbomb: → :deathskulls: + :adrenrenewal: → :omniguard: :spec: → :soulsap: → :deathsparkorsoulreave: → :touchofdeath:
        Phase 2
        :livingdeath: → :touchofdeath: → :commandskeleton: → :fingerofdeath: → :necrobasic: → (tendrils) :volleyofsouls: → :divert:
        Phase 3
        :bloat: → :splitsoul: → :soulsap: → :deathskulls: → :commandzombie: + :dive: to :redbeam:
        Phase 4
        ⬥ Equip your clearheaded switch.
        Drop Down
        >50% adren: :omniguard: :spec: → :deathguard90: :eofspec: → :touchofdeath:
        <50% adren: :soulstrike: → :soulstrike: → :deathguard90: :eofspec: → :soulsap:
        Font 1
        :divert: → :prep: → :anticlearheaded: → :firstnecrohandwrap: :conjurearmy: :cinderbanes: → ( :soulsap: / :necrobasic: ) → :commandghost:
        """;

    [TestMethod]
    public void ParsesPhasesGroupsNotesAndBranches()
    {
        var document = new RotationParser().Parse(Example, "Telos");

        CollectionAssert.AreEqual(new[] { "Phase 1", "Phase 2", "Phase 3", "Phase 4", "Drop Down", "Font 1" },
            document.Sections.Select(section => section.Name).ToArray());
        var first = document.Sections[0].Entries[0].Step!;
        CollectionAssert.AreEquivalent(new[] { "bloat", "vulnbomb" }, first.AllTokens.ToArray());
        Assert.AreEqual("tc", first.Cue);
        Assert.AreEqual(2, document.Sections[4].Entries.Single().Branch!.Options.Count);
        Assert.IsTrue(document.Sections[3].Entries.Any(entry => entry.Kind == RotationEntryKind.Note));
    }

    [TestMethod]
    public void ParenthesizedSlashCreatesOptionalAlternativeRequirement()
    {
        var document = new RotationParser().Parse(":divert: → ( :soulsap: / :necrobasic: ) → :commandghost:");
        var step = document.Sections[0].Entries[1].Step!;

        Assert.IsTrue(step.IsOptional);
        Assert.IsTrue(step.Actions.Single().IsOptional);
        CollectionAssert.AreEqual(new[] { "soulsap", "necrobasic" }, step.Actions.Single().Alternatives);
    }

    [TestMethod]
    public void TokensInsideProseRemainNonBlockingNotes()
    {
        var document = new RotationParser().Parse("Phase 1\n⬥ Use :freedom: here if needed.\n:bloat: → :surge:");
        Assert.AreEqual(RotationEntryKind.Note, document.Sections[0].Entries[0].Kind);
        Assert.AreEqual(RotationEntryKind.Step, document.Sections[0].Entries[1].Kind);
        Assert.IsTrue(document.Tokens.ContainsKey("freedom"));
    }
}
